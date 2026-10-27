/**
 * Lokální výřez kusů oblečení z fotky – bez OpenAI, zdarma, na tomto počítači.
 *
 * 1. SegFormer „clothes“ rozdělí fotku na části (vršek, kalhoty, sukně, boty, taška…).
 * 2. Každý kus z analýzy dostane masku podle své kategorie.
 * 3. Když je ve vršku víc kusů (bunda přes tričko), oddělí je SAM podle bodů
 *    vybraných z barev, které vrátila analýza.
 * 4. Výsledek je průhledné PNG z původních pixelů (nic se nepřekresluje).
 *
 * Modely se stáhnou z Hugging Face při prvním použití do server/.models (není v gitu).
 */
import { AutoProcessor, env, pipeline, RawImage, SamModel } from '@huggingface/transformers';
import sharp from 'sharp';
import { fileURLToPath } from 'node:url';

env.cacheDir = fileURLToPath(new URL('./.models', import.meta.url));

const SEGFORMER_ID = process.env.SEGMENTATION_MODEL ?? 'Xenova/segformer_b2_clothes';
const SAM_ID = process.env.SAM_MODEL ?? 'Xenova/slimsam-77-uniform';
const MAX_SIDE = 1200;

/** Kategorie aplikace → popisky SegFormeru. */
const LABELS = {
  top: ['Upper-clothes', 'Dress'],
  outerwear: ['Upper-clothes', 'Dress'],
  bottom: ['Pants', 'Skirt'],
  shoes: ['Left-shoe', 'Right-shoe'],
  accessory: ['Hat', 'Bag', 'Scarf', 'Belt', 'Sunglasses'],
  any: [],
};
const ZONE = { top: 'upper', outerwear: 'upper', bottom: 'lower', shoes: 'feet', accessory: 'accessory', any: 'any' };
const BODY = new Set(['Background', 'Hair', 'Face', 'Left-arm', 'Right-arm', 'Left-leg', 'Right-leg']);

/** Barvy aplikace (štítky z analýzy) → RGB pro rozdělení vrstev. */
const COLOR_RGB = {
  Černá: [30, 32, 36],
  Šedá: [150, 152, 156],
  Bílá: [240, 240, 240],
  Béžová: [205, 185, 155],
  Hnědá: [120, 82, 54],
  Zelená: [70, 120, 80],
  Modrá: [60, 100, 170],
  Červená: [180, 60, 45],
};

let segformerPromise;
let samPromise;
const segformer = () => (segformerPromise ??= pipeline('image-segmentation', SEGFORMER_ID, { dtype: 'fp32' }));
const sam = () =>
  (samPromise ??= Promise.all([SamModel.from_pretrained(SAM_ID, { dtype: 'fp32' }), AutoProcessor.from_pretrained(SAM_ID)]));

/** Načte modely dopředu, aby první fotka nečekala na stažení. */
export function warmUp() {
  return Promise.all([segformer(), sam()]);
}

/**
 * Celý výřez najednou (segment + cutGarments).
 * @param {Buffer} input  obrázek (JPG/PNG/WebP)
 * @param {{ category: string, primaryColor: string | null }[]} garments  kusy z analýzy
 * @returns {Promise<{ image: string | null, warning: string | null }[]>}  PNG jako data URL pro každý kus
 */
export async function extractGarments(input, garments) {
  return cutGarments(await segment(input), garments);
}

/**
 * První fáze (jen SegFormer) – dá se pustit současně s analýzou OpenAI.
 * @param {Buffer} input
 */
export async function segment(input) {
  const { data: rgb, info } = await sharp(input)
    .rotate()
    .resize({ width: MAX_SIDE, height: MAX_SIDE, fit: 'inside', withoutEnlargement: true })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const W = info.width;
  const H = info.height;
  const image = new RawImage(new Uint8ClampedArray(rgb), W, H, 3);

  const parts = await segformer().then((seg) => seg(image));
  const masks = new Map(parts.map((p) => [p.label, toMask(p.mask, W, H)]));
  return { rgb, W, H, image, masks };
}

/**
 * Druhá fáze – masky pro kusy z analýzy. Kategorie „any“ = cokoli, co není tělo ani pozadí
 * (použije se, když analýza selže a kus se vyplňuje ručně).
 */
export async function cutGarments({ rgb, W, H, image, masks }, garments, { product: productHint = false } = {}) {
  const union = (labels) => {
    const m = new Uint8Array(W * H);
    for (const l of labels) {
      const part = masks.get(l);
      if (part) for (let i = 0; i < m.length; i++) m[i] |= part[i];
    }
    return m;
  };
  /** Vše, co není pozadí ani tělo – záchrana, když kategorie nesedí (např. kus na zemi). */
  const anyClothes = union([...masks.keys()].filter((l) => !BODY.has(l)));

  // Kusy podle zóny – víc kusů ve stejné zóně se dělí podle barvy.
  const byZone = new Map();
  garments.forEach((g, index) => {
    const zone = ZONE[g.category] ?? 'upper';
    if (!byZone.has(zone)) byZone.set(zone, []);
    byZone.get(zone).push({ ...g, index });
  });

  const results = garments.map(() => ({ image: null, warning: null }));
  // Produktová fotka (kus bez člověka): SegFormer je trénovaný na lidech, samotnou botu nebo kalhoty
  // rozseká na kousky (béžovou botu bere jako nohu apod.). Vezmeme vše, co není pozadí.
  const product =
    productHint ||
    (count(union(['Face'])) < 0.002 * W * H && count(union(['Left-arm', 'Right-arm', 'Left-leg', 'Right-leg'])) < 0.05 * W * H);
  if (product && byZone.size === 1) {
    const [group] = byZone.values();
    if (group.length === 1) {
      // Jednobarevné pozadí (e-shop) → vše, co se liší od okraje fotky; vzorované (podlaha, deka) → co SegFormer nevidí jako pozadí.
      const fg = foreground(rgb, W, H, masks.get('Background')) ?? anyNotBackground(masks, W, H);
      const mask = clean(fillHoles(fg, W, H), W, H);
      if (count(mask) >= 0.01 * W * H) {
        results[group[0].index].image = await cutout(rgb, mask, W, H);
        if (touchesEdge(mask, W, H)) results[group[0].index].warning = 'Kus je na fotce useknutý okrajem. Pro celý kus nahraj fotku, kde je vidět celý.';
        return results;
      }
    }
  }
  for (const [, group] of byZone) {
    let zoneMask = union(LABELS[group[0].category] ?? []);
    if (count(zoneMask) < 0.01 * W * H) zoneMask = anyClothes;
    if (count(zoneMask) < 0.01 * W * H) {
      for (const g of group) results[g.index].warning = 'Kus se na fotce nepodařilo najít.';
      continue;
    }

    const split = group.length > 1 ? await splitLayers(image, rgb, zoneMask, group, W, H) : [zoneMask];
    for (let k = 0; k < group.length; k++) {
      const g = group[k];
      const mask = clean(split[k], W, H);
      const area = count(mask);
      if (area < 0.004 * W * H) {
        results[g.index].warning = 'Kus je na fotce skoro celý zakrytý. Doporučuju nahrát jeho samostatnou fotku.';
        continue;
      }
      results[g.index].image = await cutout(rgb, mask, W, H);
      if (group.length > 1 && area < 0.35 * count(zoneMask)) {
        results[g.index].warning = 'Kus je částečně zakrytý jiným kusem. Pro lepší výsledek nahraj jeho samostatnou fotku.';
      } else if (touchesEdge(mask, W, H)) {
        results[g.index].warning = 'Kus je na fotce useknutý okrajem. Pro celý kus nahraj fotku, kde je vidět celý.';
      }
    }
  }
  return results;
}

/** Rozdělí zónu (např. vršek) na jednotlivé kusy: barevné shluky → body pro SAM → maska každého kusu. */
async function splitLayers(image, rgb, zoneMask, group, W, H) {
  const centers = group.map((g) => [...(COLOR_RGB[g.primaryColor] ?? [128, 128, 128])]);
  const idx = [];
  for (let i = 0; i < W * H; i++) if (zoneMask[i]) idx.push(i);
  const assign = new Uint8Array(idx.length);
  for (let iter = 0; iter < 8; iter++) {
    const sum = centers.map(() => [0, 0, 0, 0]);
    for (let j = 0; j < idx.length; j++) {
      const p = idx[j] * 3;
      let best = 0;
      let bestD = Infinity;
      for (let k = 0; k < centers.length; k++) {
        const c = centers[k];
        const d = (rgb[p] - c[0]) ** 2 + (rgb[p + 1] - c[1]) ** 2 + (rgb[p + 2] - c[2]) ** 2;
        if (d < bestD) (bestD = d), (best = k);
      }
      assign[j] = best;
      const s = sum[best];
      s[0] += rgb[p];
      s[1] += rgb[p + 1];
      s[2] += rgb[p + 2];
      s[3]++;
    }
    sum.forEach((s, k) => s[3] && (centers[k] = [s[0] / s[3], s[1] / s[3], s[2] / s[3]]));
  }
  const clusters = group.map((_, k) => {
    const m = new Uint8Array(W * H);
    for (let j = 0; j < idx.length; j++) if (assign[j] === k) m[idx[j]] = 1;
    return erode(m, W, H, 6);
  });

  const [model, processor] = await sam();
  // Obraz se zakóduje jen jednou, pro každý kus se pak liší jen body.
  const base = await processor(image);
  const embeddings = await model.get_image_embeddings(base);
  const results = [];
  for (let k = 0; k < group.length; k++) results.push(await maskFor(k));
  return results;

  async function maskFor(k) {
    const positive = spreadPoints(clusters[k], W, H, 4);
    if (!positive.length) return new Uint8Array(W * H);
    const negative = clusters.flatMap((m, o) => (o === k ? [] : spreadPoints(m, W, H, 2)));
    const points = [...positive, ...negative];
    const labels = [...positive.map(() => 1), ...negative.map(() => 0)];
    const inputs = await processor(image, { input_points: [points], input_labels: [labels] });
    const out = await model({ ...embeddings, input_points: inputs.input_points, input_labels: inputs.input_labels });
    const [masks] = await processor.post_process_masks(out.pred_masks, inputs.original_sizes, inputs.reshaped_input_sizes);
    const scores = Array.from(out.iou_scores.data);
    const best = scores.indexOf(Math.max(...scores));
    const m = new Uint8Array(W * H);
    const data = masks.data;
    // SAM může přetéct do pozadí – omezíme ho na zónu z SegFormeru.
    for (let i = 0; i < W * H; i++) m[i] = data[best * W * H + i] && zoneMask[i] ? 1 : 0;
    return m;
  }
}

/** Body rozložené po masce (farthest-point sampling), aby SAM dostal celý kus, ne jeden roh. */
function spreadPoints(mask, W, H, n) {
  const pts = [];
  for (let i = 0; i < W * H; i += 7) if (mask[i]) pts.push([i % W, Math.floor(i / W)]);
  if (!pts.length) return [];
  const cx = pts.reduce((s, p) => s + p[0], 0) / pts.length;
  const cy = pts.reduce((s, p) => s + p[1], 0) / pts.length;
  let first = pts[0];
  let bestD = Infinity;
  for (const p of pts) {
    const d = (p[0] - cx) ** 2 + (p[1] - cy) ** 2;
    if (d < bestD) (bestD = d), (first = p);
  }
  const chosen = [first];
  const dist = pts.map((p) => (p[0] - first[0]) ** 2 + (p[1] - first[1]) ** 2);
  while (chosen.length < n) {
    let far = 0;
    for (let j = 1; j < pts.length; j++) if (dist[j] > dist[far]) far = j;
    if (dist[far] === 0) break;
    const p = pts[far];
    chosen.push(p);
    for (let j = 0; j < pts.length; j++) dist[j] = Math.min(dist[j], (pts[j][0] - p[0]) ** 2 + (pts[j][1] - p[1]) ** 2);
  }
  return chosen;
}

/** Kus useknutý okrajem fotky (např. tričko, ze kterého je vidět jen spodek). */
function touchesEdge(m, W, H) {
  let top = 0, bottom = 0, left = 0, right = 0;
  for (let x = 0; x < W; x++) (top += m[x]), (bottom += m[(H - 1) * W + x]);
  for (let y = 0; y < H; y++) (left += m[y * W]), (right += m[y * W + W - 1]);
  return top > 0.15 * W || bottom > 0.15 * W || left > 0.15 * H || right > 0.15 * H;
}

function toMask(raw, W, H) {
  const m = new Uint8Array(W * H);
  const d = raw.data;
  if (raw.width === W && raw.height === H) {
    for (let i = 0; i < m.length; i++) m[i] = d[i] > 127 ? 1 : 0;
  } else {
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++)
        m[y * W + x] = d[Math.floor((y * raw.height) / H) * raw.width + Math.floor((x * raw.width) / W)] > 127 ? 1 : 0;
  }
  return m;
}

function count(m) {
  let n = 0;
  for (let i = 0; i < m.length; i++) n += m[i];
  return n;
}

function erode(m, W, H, r) {
  let cur = m;
  for (let k = 0; k < r; k++) {
    const next = new Uint8Array(W * H);
    for (let y = 1; y < H - 1; y++)
      for (let x = 1; x < W - 1; x++) {
        const i = y * W + x;
        next[i] = cur[i] & cur[i - 1] & cur[i + 1] & cur[i - W] & cur[i + W];
      }
    cur = next;
  }
  return cur;
}

/** Ponechá souvislé oblasti větší než 3 % největší (zahodí drobné ostrůvky). */
/** Popředí produktové fotky: liší se od barvy okraje fotky (pozadí), nebo ho SegFormer nevidí jako pozadí. */
function foreground(rgb, W, H, bgMask) {
  const border = [];
  for (let x = 0; x < W; x += 4) border.push(x, (H - 1) * W + x);
  for (let y = 0; y < H; y += 4) border.push(y * W, y * W + W - 1);
  const med = [0, 1, 2].map((c) => {
    const v = border.map((i) => rgb[i * 3 + c]).sort((a, b) => a - b);
    return v[v.length >> 1];
  });
  // Pozadí není jednolité (podlaha, postel…) → barvou se oddělit nedá.
  const dev = border.map((i) => Math.abs(rgb[i * 3] - med[0]) + Math.abs(rgb[i * 3 + 1] - med[1]) + Math.abs(rgb[i * 3 + 2] - med[2]));
  dev.sort((a, b) => a - b);
  if (dev[Math.floor(dev.length * 0.8)] > 30) return null;
  const m = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) {
    const p = i * 3;
    const d = Math.abs(rgb[p] - med[0]) + Math.abs(rgb[p + 1] - med[1]) + Math.abs(rgb[p + 2] - med[2]);
    m[i] = d > 36 || (bgMask && !bgMask[i] && d > 24) ? 1 : 0;
  }
  return m;
}

function anyNotBackground(masks, W, H) {
  const bg = masks.get('Background');
  const m = new Uint8Array(W * H);
  for (let i = 0; i < m.length; i++) m[i] = bg && bg[i] ? 0 : 1;
  return m;
}

/** Vyplní díry (vše, co není spojené s okrajem fotky). */
function fillHoles(m, W, H) {
  const out = new Uint8Array(W * H).fill(1);
  const stack = [];
  for (let x = 0; x < W; x++) stack.push(x, (H - 1) * W + x);
  for (let y = 0; y < H; y++) stack.push(y * W, y * W + W - 1);
  while (stack.length) {
    const c = stack.pop();
    if (!out[c] || m[c]) continue;
    out[c] = 0;
    const x = c % W;
    if (x > 0) stack.push(c - 1);
    if (x < W - 1) stack.push(c + 1);
    if (c >= W) stack.push(c - W);
    if (c < W * (H - 1)) stack.push(c + W);
  }
  return out;
}

function clean(m, W, H) {
  const label = new Int32Array(W * H);
  const sizes = [0];
  const stack = [];
  for (let i = 0; i < W * H; i++) {
    if (!m[i] || label[i]) continue;
    const id = sizes.length;
    let size = 0;
    stack.push(i);
    label[i] = id;
    while (stack.length) {
      const j = stack.pop();
      size++;
      const x = j % W;
      for (const n of [x > 0 ? j - 1 : -1, x < W - 1 ? j + 1 : -1, j - W, j + W]) {
        if (n >= 0 && n < W * H && m[n] && !label[n]) {
          label[n] = id;
          stack.push(n);
        }
      }
    }
    sizes.push(size);
  }
  const max = Math.max(0, ...sizes);
  const out = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) out[i] = label[i] && sizes[label[i]] >= 0.03 * max ? 1 : 0;
  return out;
}

/** Průhledné PNG oříznuté na kus, s jemně změkčeným okrajem. */
async function cutout(rgb, mask, W, H) {
  let minX = W, minY = H, maxX = -1, maxY = -1;
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++)
      if (mask[y * W + x]) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
  const alpha = await sharp(Buffer.from(mask.map((v) => v * 255)), { raw: { width: W, height: H, channels: 1 } })
    .blur(0.8)
    .extractChannel(0)
    .raw()
    .toBuffer();
  const rgba = Buffer.alloc(W * H * 4);
  for (let i = 0; i < W * H; i++) {
    rgba[i * 4] = rgb[i * 3];
    rgba[i * 4 + 1] = rgb[i * 3 + 1];
    rgba[i * 4 + 2] = rgb[i * 3 + 2];
    rgba[i * 4 + 3] = alpha[i];
  }
  const pad = 6;
  const left = Math.max(0, minX - pad);
  const top = Math.max(0, minY - pad);
  const png = await sharp(rgba, { raw: { width: W, height: H, channels: 4 } })
    .extract({ left, top, width: Math.min(W, maxX + pad + 1) - left, height: Math.min(H, maxY + pad + 1) - top })
    .png()
    .toBuffer();
  return `data:image/png;base64,${png.toString('base64')}`;
}
