/**
 * Kreslení kusu přes „formičku“ (docs/rozhodnuti.md, 30. 10. 2026) – pro vršky, bundy a spodky.
 *
 * Místo celého avatara (kůže, ruce, šedé tílko) dostane AI figurínu: výřez avatara v zóně kusu,
 * přebarvený na jednu barvu, na pozadí jiné barvy. Výřez kusu z výsledku je pak jednoduchý –
 * „všechno, co nemá barvu figuríny ani pozadí“ (chroma key, jako zelené plátno ve filmu).
 *
 * Proč figurína bez anatomie: realistickou postavu v barvě podobné pleti OpenAI blokuje jako nahotu.
 * Proč výstup v ploše celého avatara: menší rozměry OpenAI odmítá.
 */
import sharp from 'sharp';
import { H, W, edit } from './avatar.mjs';

/** Kategorie, které se kreslí přes formičku. */
export const FORM_CATEGORIES = new Set(['top', 'outerwear', 'bottom']);

/** Klíčové barvy – figurína a pozadí dostanou ty, které jsou nejdál od barev kusu. */
const TINTS = {
  zelená: [40, 190, 80],
  purpurová: [215, 40, 190],
  modrá: [40, 100, 230],
};

const chroma = ([r, g, b]) => {
  const s = r + g + b + 1;
  return [r / s, g / s, b / s];
};
const cdist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/**
 * Tvar figuríny pro kategorii (jednou na tělo a kategorii; volající si ho drží v cache).
 * @param seg segmentace těla avatara (s obličejem)
 * @param region zóna kusu (zoneRegion) – určuje výřez
 */
export async function formShape(seg, region, category) {
  const { masks } = seg;
  const person = new Uint8Array(W * H);
  const bg = masks.get('Background');
  for (let i = 0; i < person.length; i++) person[i] = bg && bg[i] ? 0 : 1;
  const armsAt = (i) => masks.get('Left-arm')?.[i] || masks.get('Right-arm')?.[i];
  const hips = masks.get('Pants');
  let waistY = H;
  for (let i = 0; i < W * H; i++) if (hips && hips[i]) { waistY = Math.floor(i / W); break; }

  if (category === 'bottom') {
    // Kalhoty: holé nohy figuríny = úzké nohavice (AI se drží tvaru), proto nohy rozšířené o běžnou vůli.
    const legs = new Uint8Array(W * H);
    for (let i = waistY * W; i < W * H; i++) legs[i] = person[i] && !armsAt(i) ? 1 : 0;
    const wide = await blurMask(legs, 9);
    for (let i = waistY * W; i < W * H; i++) if (wide[i] > 40 && !armsAt(i)) person[i] = 1;
  } else {
    // Vršky a bundy: nohy pod pasem spojené do bloku (krejčovská panna – bez anatomie kvůli moderaci).
    for (let y = waistY; y < H; y++) {
      let a = -1, b = -1;
      for (let x = 0; x < W; x++) if (person[y * W + x] && !armsAt(y * W + x)) { if (a < 0) a = x; b = x; }
      if (a >= 0) for (let x = a; x <= b; x++) person[y * W + x] = 1;
    }
  }

  // výřez = obdélník kolem zóny, strany dělitelné 16
  let x0 = W, y0 = H, x1 = 0, y1 = 0;
  for (let i = 0; i < region.length; i++) {
    if (!region[i]) continue;
    const x = i % W, y = (i - x) / W;
    x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
  }
  const pad = 16;
  x0 = Math.max(0, x0 - pad);
  y0 = Math.max(0, y0 - pad);
  let cw = Math.min(W - x0, Math.ceil((x1 - x0 + pad) / 16) * 16);
  let ch = Math.min(H - y0, Math.ceil((y1 - y0 + pad) / 16) * 16);
  cw -= cw % 16;
  ch -= ch % 16;
  // jen jemný objem k okraji, žádná anatomie
  const shade = (await blurMask(person, 10)).map((v) => 120 + Math.round((v / 255) * 110));
  return { person, shade, x0, y0, cw, ch };
}

/** Vybere klíčové barvy podle barev kusu (šedé / bílé / černé barvy kusu klíči nevadí). */
export function pickTints(palette) {
  const colorful = (palette ?? []).filter((p) => Math.max(...p) - Math.min(...p) > 30);
  const ranked = Object.entries(TINTS)
    .map(([name, rgb]) => ({ name, rgb, d: Math.min(1, ...colorful.map((p) => cdist(chroma(p), chroma(rgb)))) }))
    .sort((a, b) => b.d - a.d);
  return { fig: ranked[0], back: ranked[1] };
}

/** Obrázek formy (výřez cw×ch). */
export async function formImage(shape, tints) {
  const { person, shade, x0, y0, cw, ch } = shape;
  const rgb = Buffer.alloc(cw * ch * 3);
  for (let y = 0; y < ch; y++)
    for (let x = 0; x < cw; x++) {
      const i = (y0 + y) * W + (x0 + x);
      const o = (y * cw + x) * 3;
      const l = person[i] ? shade[i] / 255 + 0.1 : 1;
      const c = person[i] ? tints.fig.rgb : tints.back.rgb;
      for (let k = 0; k < 3; k++) rgb[o + k] = Math.min(255, Math.round(c[k] * l));
    }
  return sharp(rgb, { raw: { width: cw, height: ch, channels: 3 } }).png().toBuffer();
}

/** Pokyn pro AI. */
export function formPrompt(tints, { category, bottomLength = 'long', name = null, subtype = null }) {
  const what = [name, subtype].filter(Boolean).join(' – ');
  const kind =
    category === 'bottom'
      ? bottomLength === 'short'
        ? 'They are short bottoms (shorts): the hem ends above the knees, the legs below stay the plain mannequin colour.'
        : 'They are long bottoms (trousers, joggers): from the waist down to the ankles.'
      : category === 'outerwear'
        ? 'It is an outer layer (jacket or coat), worn the same way as in the photo.'
        : 'It is a top (t-shirt, shirt, sweatshirt or sweater).';
  return [
    `The first image is a plain ${tints.fig.name} dress form (a featureless tailor's mannequin, solid colour) on a plain ${tints.back.name} background. This is a clothing product visualisation.`,
    `Dress the mannequin in the clothing item from the second image${what ? ` (${what})` : ''}, worn naturally and fitted to this body shape and pose, with soft realistic folds,`,
    'in a clean 3D cartoon style (Pixar-like) with soft lighting. Keep the colour, pattern, logos and details of the item faithful to the second image.',
    "Keep the item's own cut and width: loose, wide or oversized items stay loose and wide around the mannequin, do not make them tight or skinny.",
    kind,
    `Do not change the mannequin pose, arms or proportions; parts of the mannequin not covered by the item stay exactly the same plain ${tints.fig.name} colour,`,
    `and the background stays exactly the same flat ${tints.back.name} colour. Do not add hands, skin, a face or any other clothing.`,
  ].join(' ');
}

/** Jedno volání AI na formě. Vrací výstup ve velikosti výřezu. */
export async function drawOnForm(form, garment, prompt, shape, quality) {
  const { cw, ch } = shape;
  // OpenAI malé rozměry odmítá → stejný poměr stran, plocha jako celý avatar, pak zpět na výřez
  const k = Math.sqrt((W * H) / (cw * ch));
  const big = { w: Math.round((cw * k) / 16) * 16, h: Math.round((ch * k) / 16) * 16 };
  try {
    const out = await edit([form, garment], prompt, null, quality, big);
    return { png: await sharp(out.png).resize(cw, ch, { fit: 'fill' }).png().toBuffer(), usd: out.usd };
  } catch (error) {
    if (/moderation_blocked/.test(error.message)) {
      error.message = 'Bezpečnostní filtr OpenAI tenhle kus odmítl nakreslit. Zkus to znovu, případně jinou fotku kusu.';
    }
    throw error;
  }
}

/**
 * Vrstva kusu a maska mazání z výstupu AI (oboje PNG 688×1024 v prostoru avatara).
 * - vrstva = vše, co nemá barvu figuríny ani pozadí,
 * - maska mazání = figurína, kterou AI nechala prázdnou těsně vedle kusu (kus užší než tělo) – avatar se tam schová.
 */
export async function cutFromForm(aiPng, shape, tints) {
  const { person, x0, y0, cw, ch } = shape;
  const d = await sharp(aiPng).removeAlpha().raw().toBuffer();
  const cf = chroma(tints.fig.rgb);
  const cb = chroma(tints.back.rgb);
  const isKey = (p, c, thr) => Math.max(...p) - Math.min(...p) > 40 && cdist(chroma(p), c) < thr;
  let m = new Uint8Array(cw * ch);
  for (let i = 0; i < cw * ch; i++) {
    const p = [d[i * 3], d[i * 3 + 1], d[i * 3 + 2]];
    m[i] = isKey(p, cf, 0.09) || isKey(p, cb, 0.07) ? 0 : 1;
  }
  m = clean(m, cw, ch);
  const soft = await sharp(Buffer.from(m.map((v) => v * 255)), { raw: { width: cw, height: ch, channels: 1 } })
    .blur(0.7)
    .extractChannel(0)
    .raw()
    .toBuffer();

  const layer = Buffer.alloc(W * H * 4);
  const erase = Buffer.alloc(W * H * 4, 255);
  for (let i = 0; i < W * H; i++) erase[i * 4 + 3] = 0;
  const near = dilate(m, cw, ch, 12);
  for (let y = 0; y < ch; y++)
    for (let x = 0; x < cw; x++) {
      const k = y * cw + x;
      const o = ((y0 + y) * W + (x0 + x)) * 4;
      if (soft[k] > 10) {
        layer[o] = d[k * 3];
        layer[o + 1] = d[k * 3 + 1];
        layer[o + 2] = d[k * 3 + 2];
        layer[o + 3] = soft[k];
      }
      const p = [d[k * 3], d[k * 3 + 1], d[k * 3 + 2]];
      if (person[(y0 + y) * W + (x0 + x)] && !m[k] && near[k] && isKey(p, cb, 0.07)) erase[o + 3] = 255;
    }
  const toPng = (buf) => sharp(buf, { raw: { width: W, height: H, channels: 4 } }).png().toBuffer();
  return { layer: await toPng(layer), erase: await sharp(await toPng(erase)).blur(1).png().toBuffer() };
}

function blurMask(mask, sigma) {
  return sharp(Buffer.from(mask.map((v) => v * 255)), { raw: { width: W, height: H, channels: 1 } })
    .blur(sigma)
    .extractChannel(0)
    .raw()
    .toBuffer();
}

/** Úklid masky: otevření, jen větší oblasti. */
function clean(m, w, h) {
  const op = morph(morph(m, w, h, true, 2), w, h, false, 2);
  const seen = new Uint8Array(w * h);
  const keep = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) {
    if (!op[i] || seen[i]) continue;
    const comp = [i];
    const st = [i];
    seen[i] = 1;
    while (st.length) {
      const c = st.pop();
      const x = c % w;
      for (const n of [x > 0 ? c - 1 : -1, x < w - 1 ? c + 1 : -1, c - w, c + w]) {
        if (n < 0 || n >= w * h || seen[n] || !op[n]) continue;
        seen[n] = 1;
        st.push(n);
        comp.push(n);
      }
    }
    if (comp.length > 1500) for (const c of comp) keep[c] = 1;
  }
  return keep;
}

function dilate(m, w, h, r) {
  return morph(m, w, h, false, r);
}

function morph(src, w, h, erode, r) {
  const pass = (from, horiz) => {
    const to = new Uint8Array(w * h);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        let v = erode ? 1 : 0;
        for (let k = -r; k <= r; k++) {
          const xx = horiz ? x + k : x;
          const yy = horiz ? y : y + k;
          const s = xx < 0 || yy < 0 || xx >= w || yy >= h ? 0 : from[yy * w + xx];
          if (erode && !s) { v = 0; break; }
          if (!erode && s) { v = 1; break; }
        }
        to[y * w + x] = v;
      }
    return to;
  };
  return pass(pass(src, true), false);
}
