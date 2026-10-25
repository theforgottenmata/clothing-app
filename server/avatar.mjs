/**
 * Pomůcky pro knihovnu těl avatara (tools/avatar-library.mjs) a později pro oblečení na avatara.
 *
 * - edit(): jedno volání OpenAI úpravy obrázku, výstup vždy 688×1024
 * - masky z SegFormeru: postava, oblast hlavy
 * - mergeInside(): vygenerované pixely jen uvnitř masky, jinde původní obrázek
 * - withTransparent(): průhledná verze (vše kromě pozadí)
 * - bodyMap(): obdélníky hlavy a zón těla pro skládání obličeje a oblečení
 */
import sharp from 'sharp';
import { segment } from './segmentation.mjs';

export const W = 688;
export const H = 1024;
const MODEL = () => process.env.OPENAI_IMAGE_MODEL ?? 'gpt-image-2.5-sunburst';
const QUALITY = () => process.env.OPENAI_IMAGE_QUALITY ?? 'medium';
const API = () => process.env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1';
const TIMEOUT_MS = 180_000;
/** Ceník za 1M tokenů (developers.openai.com/api/docs/pricing, říjen 2026). */
const PRICE = { imageIn: 8, textIn: 5, imageOut: 30 };

export class AvatarError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/** Jedno volání úpravy obrázku; vrací PNG 688×1024 a cenu v USD. */
export async function edit(images, prompt, mask, quality = QUALITY()) {
  if (!process.env.OPENAI_API_KEY) throw new AvatarError(503, 'Chybí OPENAI_API_KEY v souboru .env.');
  const started = Date.now();
  const toPng = (b) => sharp(b).resize(W, H, { fit: 'fill' }).png().toBuffer();
  let res;
  try {
    res = await fetch(`${API()}/images/edits`, {
      method: 'POST',
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { authorization: `Bearer ${process.env.OPENAI_API_KEY}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        model: MODEL(),
        prompt,
        images: await Promise.all(images.map(async (b) => ({ image_url: dataUrl(await toPng(b)) }))),
        size: `${W}x${H}`,
        quality,
        output_format: 'png',
        ...(mask ? { mask: { image_url: dataUrl(mask) } } : {}),
      }),
    });
  } catch (error) {
    if (error?.name === 'TimeoutError') throw new AvatarError(504, 'Generování trvalo příliš dlouho. Zkus to znovu.');
    throw new AvatarError(502, `Nepodařilo se spojit s OpenAI (${error?.cause?.code ?? error?.message ?? 'neznámá chyba'}).`);
  }
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    const code = json?.error?.code ?? 'unknown_error';
    const reason = json?.error?.message ?? `HTTP ${res.status}`;
    throw new AvatarError(res.status, `OpenAI odmítla generování (${code}): ${reason}`);
  }
  const usd = cost(json.usage);
  console.log(`  OpenAI: ${((Date.now() - started) / 1000).toFixed(1)} s · cca $${usd.toFixed(3)} (${(usd * czk()).toFixed(2)} Kč)`);
  const out = Buffer.from(json.data[0].b64_json, 'base64');
  return { png: await sharp(out).resize(W, H, { fit: 'fill' }).removeAlpha().png().toBuffer(), usd };
}

export const czk = () => Number(process.env.USD_CZK ?? 23);

function cost(usage = {}) {
  const imgIn = usage.input_tokens_details?.image_tokens ?? 0;
  const txtIn = usage.input_tokens_details?.text_tokens ?? (usage.input_tokens ?? 0) - imgIn;
  return (imgIn * PRICE.imageIn + txtIn * PRICE.textIn + (usage.output_tokens ?? 0) * PRICE.imageOut) / 1e6;
}

/** Oblast hlavy (vlasy + obličej, s rezervou nahoru a do stran), nikdy pod ramena. */
export function headRegion({ W: w, H: h, masks }) {
  const head = new Uint8Array(w * h);
  let minX = w, maxX = 0, minY = h, maxY = 0;
  for (const label of ['Hair', 'Face', 'Sunglasses', 'Hat']) {
    const m = masks.get(label);
    if (!m) continue;
    for (let i = 0; i < m.length; i++) {
      if (!m[i]) continue;
      head[i] = 1;
      const x = i % w;
      const y = Math.floor(i / w);
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  let shoulders = maxY;
  const upper = masks.get('Upper-clothes');
  if (upper) {
    for (let i = 0; i < upper.length; i++) {
      if (upper[i]) {
        shoulders = Math.floor(i / w);
        break;
      }
    }
  }
  if (maxX === 0) {
    // Holá hlava bez obličeje – SegFormer ji nemusí poznat. Bereme postavu nad rameny.
    const bg = masks.get('Background');
    for (let y = 0; y < shoulders; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (bg && bg[i]) continue;
        head[i] = 1;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
    if (maxX === 0) throw new AvatarError(422, 'Na avatarovi se nepodařilo najít hlavu.');
  }
  const pad = Math.round((maxX - minX) * 0.35);
  const region = new Uint8Array(w * h);
  for (let y = 0; y < Math.min(h, shoulders); y++) {
    for (let x = Math.max(0, minX - pad); x <= Math.min(w - 1, maxX + pad); x++) {
      if (y < minY + (maxY - minY) * 0.6 || head[y * w + x]) region[y * w + x] = 1;
    }
  }
  return region;
}

/** Postava (vše kromě pozadí), rozšířená o `grow` px – prostor pro širší postavu. */
export function personRegion({ W: w, H: h, masks }, grow = 0) {
  const bg = masks.get('Background');
  let m = new Uint8Array(w * h);
  for (let i = 0; i < m.length; i++) m[i] = bg && bg[i] ? 0 : 1;
  if (grow > 0) m = dilate(m, w, h, grow);
  return m;
}

export function subtract(a, b) {
  const out = new Uint8Array(a.length);
  for (let i = 0; i < a.length; i++) out[i] = a[i] && !b[i] ? 1 : 0;
  return out;
}

/** Maska pro OpenAI: průhledné = smí se měnit. */
export function toOpenAiMask(region) {
  const rgba = Buffer.alloc(W * H * 4, 255);
  for (let i = 0; i < W * H; i++) rgba[i * 4 + 3] = region[i] ? 0 : 255;
  return sharp(rgba, { raw: { width: W, height: H, channels: 4 } }).png().toBuffer();
}

/** Vygenerované pixely uvnitř oblasti (měkký okraj), všude jinde původní obrázek. */
export async function mergeInside(base, generated, region, feather = 3) {
  const a = await sharp(Buffer.from(region.map((v) => v * 255)), { raw: { width: W, height: H, channels: 1 } })
    .blur(feather)
    .extractChannel(0)
    .raw()
    .toBuffer();
  const b = await sharp(base).resize(W, H).removeAlpha().raw().toBuffer();
  const g = await sharp(generated).resize(W, H).removeAlpha().raw().toBuffer();
  const out = Buffer.alloc(W * H * 3);
  for (let i = 0; i < W * H; i++) {
    const t = a[i] / 255;
    for (let c = 0; c < 3; c++) out[i * 3 + c] = Math.round(g[i * 3 + c] * t + b[i * 3 + c] * (1 - t));
  }
  return sharp(out, { raw: { width: W, height: H, channels: 3 } }).png().toBuffer();
}

/** Průhledná verze (vše kromě pozadí podle SegFormeru, s jemným okrajem). */
export async function withTransparent(png, segmented) {
  const { masks } = segmented ?? (await segment(png));
  const bg = masks.get('Background');
  const alpha = Buffer.alloc(W * H, 255);
  if (bg) for (let i = 0; i < W * H; i++) alpha[i] = bg[i] ? 0 : 255;
  const soft = await sharp(alpha, { raw: { width: W, height: H, channels: 1 } }).blur(1).extractChannel(0).raw().toBuffer();
  const rgb = await sharp(png).removeAlpha().raw().toBuffer();
  const rgba = Buffer.alloc(W * H * 4);
  for (let i = 0; i < W * H; i++) {
    rgba[i * 4] = rgb[i * 3];
    rgba[i * 4 + 1] = rgb[i * 3 + 1];
    rgba[i * 4 + 2] = rgb[i * 3 + 2];
    rgba[i * 4 + 3] = soft[i];
  }
  return sharp(rgba, { raw: { width: W, height: H, channels: 4 } }).png().toBuffer();
}

/** Obdélníky hlavy a zón těla v prostoru 688×1024 – pro díly obličeje a umístění oblečení. */
export function bodyMap(segmented) {
  const { W: w, masks } = segmented;
  const box = (labels) => {
    let minX = Infinity, minY = Infinity, maxX = -1, maxY = -1;
    for (const l of labels) {
      const m = masks.get(l);
      if (!m) continue;
      for (let i = 0; i < m.length; i++) {
        if (!m[i]) continue;
        const x = i % w;
        const y = Math.floor(i / w);
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
    return maxX < 0 ? null : { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
  };
  return {
    head: box(['Hair', 'Face']),
    face: box(['Face']),
    torso: box(['Upper-clothes']),
    hips: box(['Pants', 'Skirt']),
    arms: box(['Left-arm', 'Right-arm']),
    legs: box(['Left-leg', 'Right-leg']),
    feet: box(['Left-shoe', 'Right-shoe']),
    body: box([...masks.keys()].filter((l) => l !== 'Background')),
  };
}

/**
 * Průhledná vrstva z rozdílu „upravený vs. původní“ uvnitř oblasti (obličej, později oblečení).
 * Práh je součet rozdílů R+G+B; malé ostrůvky šumu se zahodí.
 */
export async function diffLayer(base, edited, region, threshold = 36, solid = null) {
  const b = await sharp(base).resize(W, H).removeAlpha().raw().toBuffer();
  const e = await sharp(edited).resize(W, H).removeAlpha().raw().toBuffer();
  const m = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) {
    if (!region[i]) continue;
    // `solid` = oblast, která se bere celá (např. obličej + vlasy), aby ve vrstvě nebyly díry.
    if (solid && solid[i]) {
      m[i] = 1;
      continue;
    }
    const d = Math.abs(b[i * 3] - e[i * 3]) + Math.abs(b[i * 3 + 1] - e[i * 3 + 1]) + Math.abs(b[i * 3 + 2] - e[i * 3 + 2]);
    if (d > threshold) m[i] = 1;
  }
  const alpha = await sharp(Buffer.from(m.map((v) => v * 255)), { raw: { width: W, height: H, channels: 1 } })
    .blur(0.8)
    .extractChannel(0)
    .raw()
    .toBuffer();
  const rgba = Buffer.alloc(W * H * 4);
  for (let i = 0; i < W * H; i++) {
    rgba[i * 4] = e[i * 3];
    rgba[i * 4 + 1] = e[i * 3 + 1];
    rgba[i * 4 + 2] = e[i * 3 + 2];
    rgba[i * 4 + 3] = alpha[i];
  }
  return sharp(rgba, { raw: { width: W, height: H, channels: 4 } }).png().toBuffer();
}

/** Cílové odstíny pleti (průměrná barva kůže, RGB). Střední = původní těla z AI. */
export const SKIN_TONES = {
  light: [238, 198, 170],
  tan: [178, 122, 86],
  dark: [112, 70, 46],
};

/**
 * Jak moc je pixel kůže (0–1): teplý tón (R ≥ G ≥ B), ne tmavý (vlasy, obočí, duhovka),
 * ne bílý ani šedý (bělmo, tílko, pozadí). Smíšené pixely na obrysu dostanou část váhy podle sytosti,
 * takže nevzniká světlý ani tmavý lem.
 */
function skinWeight(r, g, b) {
  const lum = (r + g + b) / 3;
  const sat = Math.max(r, g, b) - Math.min(r, g, b);
  if (r < g - 2 || g < b - 14 || lum < 60) return 0;
  return Math.max(0, Math.min(1, (sat - 8) / 18));
}

/**
 * Přebarví kůži na jiný odstín (lokálně, zdarma): násobení barvy zachová stínování.
 * `skinMask` omezuje změnu na části těla s kůží (ruce, nohy, obličej, krk); null = celý obrázek (vrstva obličeje).
 * Vrací PNG ve stejném formátu (RGB nebo RGBA).
 */
export async function recolorSkin(png, ratio, skinMask = null) {
  const { data, info } = await sharp(png).raw().toBuffer({ resolveWithObject: true });
  const ch = info.channels;
  const out = Buffer.from(data);
  for (let i = 0; i < info.width * info.height; i++) {
    if (skinMask && !skinMask[i]) continue;
    const p = i * ch;
    if (ch === 4 && !data[p + 3]) continue;
    let w = skinWeight(data[p], data[p + 1], data[p + 2]);
    if (!w) continue;
    // Smíšené pixely na obrysu (část kůže, část pozadí/tílka) – slabší změna, jinak vzniká lem.
    if (w < 1) w = w * w;
    for (let c = 0; c < 3; c++) {
      // Zesvětlení se k jasným pixelům tlumí, aby se nepřepálily do bílé.
      const r = ratio[c] > 1 ? 1 + (ratio[c] - 1) * (1 - data[p + c] / 255) * 1.6 : ratio[c];
      out[p + c] = Math.max(0, Math.min(255, Math.round(data[p + c] * (1 - w + w * Math.max(ratio[c] > 1 ? 1 : 0, r)))));
    }
  }
  return sharp(out, { raw: { width: info.width, height: info.height, channels: ch } }).png().toBuffer();
}

/** Maska kůže ze SegFormeru (obličej/krk, ruce, nohy), mírně rozšířená, aby zahrnula obrys. */
export function skinRegion({ W: w, H: h, masks }) {
  const m = new Uint8Array(w * h);
  for (const label of ['Face', 'Left-arm', 'Right-arm', 'Left-leg', 'Right-leg']) {
    const part = masks.get(label);
    if (part) for (let i = 0; i < m.length; i++) m[i] |= part[i];
  }
  return dilate(m, w, h, 1);
}

/** Průměrná barva kůže (váhovaná) – pro výpočet poměru ke cílovému odstínu. */
export async function meanSkin(png, skinMask) {
  const { data, info } = await sharp(png).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const sum = [0, 0, 0];
  let n = 0;
  for (let i = 0; i < info.width * info.height; i++) {
    if (!skinMask[i]) continue;
    const p = i * 3;
    const w = skinWeight(data[p], data[p + 1], data[p + 2]);
    if (w < 1) continue;
    sum[0] += data[p];
    sum[1] += data[p + 1];
    sum[2] += data[p + 2];
    n++;
  }
  return sum.map((v) => v / Math.max(1, n));
}

/** Obličej + vlasy podle SegFormeru, mírně rozšířené – celistvá část vrstvy obličeje. */
export function faceSolid({ W: w, H: h, masks }, grow = 2) {
  const m = new Uint8Array(w * h);
  for (const label of ['Face', 'Hair', 'Sunglasses']) {
    const part = masks.get(label);
    if (part) for (let i = 0; i < m.length; i++) m[i] |= part[i];
  }
  return grow ? dilate(m, w, h, grow) : m;
}

function dilate(m, w, h, r) {
  // Dvouprůchodová dilatace čtvercem (řádky, pak sloupce) – rychlá i pro větší r.
  const tmp = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    let last = -Infinity;
    for (let x = 0; x < w; x++) {
      if (m[y * w + x]) last = x;
      if (x - last <= r) tmp[y * w + x] = 1;
    }
    last = Infinity;
    for (let x = w - 1; x >= 0; x--) {
      if (m[y * w + x]) last = x;
      if (last - x <= r) tmp[y * w + x] = 1;
    }
  }
  const out = new Uint8Array(w * h);
  for (let x = 0; x < w; x++) {
    let last = -Infinity;
    for (let y = 0; y < h; y++) {
      if (tmp[y * w + x]) last = y;
      if (y - last <= r) out[y * w + x] = 1;
    }
    last = Infinity;
    for (let y = h - 1; y >= 0; y--) {
      if (tmp[y * w + x]) last = y;
      if (last - y <= r) out[y * w + x] = 1;
    }
  }
  return out;
}

function dataUrl(buffer) {
  return `data:image/png;base64,${buffer.toString('base64')}`;
}
