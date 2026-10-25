/**
 * Tvorba vlastního avatara přes OpenAI (úprava obrázku).
 *
 * - Tělo (pohlaví, postava, pleť) vzniká úpravou výchozího avatara → stejná póza, výřez 688×1024 a pozadí.
 * - Hlava (účes, vlasy, oči, vousy, brýle) se mění jen v masce hlavy; mimo masku se vrátí původní pixely,
 *   takže tělo zůstane stejné a oblečení na něm dál sedí.
 * - Průhledná verze pro plátno se dopočítá lokálně (SegFormer: vše kromě pozadí).
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { avatarBodyPrompt, avatarHeadPrompt } from './prompts.mjs';
import { segment } from './segmentation.mjs';

const W = 688;
const H = 1024;
const BASE = fileURLToPath(new URL('../design-assets/avatar/avatar.png', import.meta.url));
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

/** Nové tělo z výchozího avatara. */
export async function createBody(options, { quality } = {}) {
  const png = await edit([readFileSync(BASE)], avatarBodyPrompt(options), undefined, quality);
  return withTransparent(png);
}

/** Nová hlava na existujícím těle (base = neprůhledný PNG avatara). */
export async function changeHead(base, options, { quality } = {}) {
  const mask = await headMask(base);
  const generated = await edit([base], avatarHeadPrompt(options), mask.png, quality);
  const merged = await mergeInside(base, generated, mask.alpha);
  return withTransparent(merged);
}

export async function defaultAvatar() {
  return readFileSync(BASE);
}

/** Jedno volání úpravy obrázku; vrací PNG 688×1024. */
export async function edit(images, prompt, mask, quality = QUALITY()) {
  if (!process.env.OPENAI_API_KEY) throw new AvatarError(503, 'Chybí OPENAI_API_KEY v souboru .env.');
  const started = Date.now();
  let res;
  try {
    res = await fetch(`${API()}/images/edits`, {
      method: 'POST',
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { authorization: `Bearer ${process.env.OPENAI_API_KEY}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        model: MODEL(),
        prompt,
        images: images.map((b) => ({ image_url: dataUrl(b) })),
        size: `${W}x${H}`,
        quality,
        output_format: 'png',
        ...(mask ? { mask: { image_url: dataUrl(mask) } } : {}),
      }),
    });
  } catch (error) {
    if (error?.name === 'TimeoutError') throw new AvatarError(504, 'Generování trvalo příliš dlouho. Zkus to znovu.');
    throw new AvatarError(502, 'Nepodařilo se spojit s OpenAI.');
  }
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    const code = json?.error?.code ?? 'unknown_error';
    console.error('OpenAI image edit failed:', res.status, code, json?.error?.message ?? '');
    if (code === 'insufficient_quota' || code === 'credit_balance_exhausted') {
      throw new AvatarError(402, 'Na OpenAI API účtu nejsou dostupné kredity.');
    }
    if (code === 'moderation_blocked') throw new AvatarError(422, 'OpenAI tenhle požadavek odmítla. Zkus jiné volby.');
    throw new AvatarError(502, 'Generování obrázku se nepodařilo. Zkus to znovu.');
  }
  logCost(json.usage, Date.now() - started);
  const out = Buffer.from(json.data[0].b64_json, 'base64');
  return sharp(out).resize(W, H, { fit: 'fill' }).removeAlpha().png().toBuffer();
}

function logCost(usage = {}, ms) {
  const imgIn = usage.input_tokens_details?.image_tokens ?? 0;
  const txtIn = usage.input_tokens_details?.text_tokens ?? (usage.input_tokens ?? 0) - imgIn;
  const out = usage.output_tokens ?? 0;
  const usd = (imgIn * PRICE.imageIn + txtIn * PRICE.textIn + out * PRICE.imageOut) / 1e6;
  const czk = usd * Number(process.env.USD_CZK ?? 23);
  console.log(`OpenAI obrázek: ${(ms / 1000).toFixed(1)} s · ${imgIn} obr. + ${txtIn} text → ${out} výstup · cca $${usd.toFixed(3)} (${czk.toFixed(2)} Kč)`);
}

/** Maska hlavy: vlasy + obličej, rozšířená nahoru a do stran (jiný účes), nikdy ne pod ramena. */
export async function headMask(buffer) {
  const { W: w, H: h, masks } = await segment(buffer);
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
  if (maxX === 0) throw new AvatarError(422, 'Na avatarovi se nepodařilo najít hlavu.');
  const upper = masks.get('Upper-clothes');
  let shoulders = maxY;
  if (upper) {
    for (let i = 0; i < upper.length; i++) {
      if (upper[i]) {
        shoulders = Math.floor(i / w);
        break;
      }
    }
  }
  const pad = Math.round((maxX - minX) * 0.35);
  const alpha = new Uint8Array(w * h);
  for (let y = 0; y < Math.min(h, shoulders); y++) {
    for (let x = Math.max(0, minX - pad); x <= Math.min(w - 1, maxX + pad); x++) {
      if (y < minY + (maxY - minY) * 0.6 || head[y * w + x]) alpha[y * w + x] = 1;
    }
  }
  // OpenAI maska: průhledné = smí se měnit.
  const rgba = Buffer.alloc(w * h * 4, 255);
  for (let i = 0; i < w * h; i++) rgba[i * 4 + 3] = alpha[i] ? 0 : 255;
  return { alpha, png: await sharp(rgba, { raw: { width: w, height: h, channels: 4 } }).png().toBuffer() };
}

/** Generovaná hlava uvnitř masky (měkký okraj) + původní obrázek všude jinde. */
export async function mergeInside(base, generated, alpha) {
  const a = await sharp(Buffer.from(alpha.map((v) => v * 255)), { raw: { width: W, height: H, channels: 1 } })
    .blur(3)
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

/** Vrátí neprůhlednou verzi (podklad pro další úpravy) a průhlednou (pro plátno). */
async function withTransparent(png) {
  const { masks } = await segment(png);
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
  const transparent = await sharp(rgba, { raw: { width: W, height: H, channels: 4 } }).png().toBuffer();
  return { opaque: png, transparent };
}

function dataUrl(buffer) {
  return `data:image/png;base64,${buffer.toString('base64')}`;
}
