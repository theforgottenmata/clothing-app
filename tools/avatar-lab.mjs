/**
 * Zkušební dílna avatara – ladění promptů pro tvorbu avatara přes OpenAI (úprava obrázku).
 *
 *   node --env-file=.env tools/avatar-lab.mjs body --gender female --size L --skin tan
 *   node --env-file=.env tools/avatar-lab.mjs head --base tmp/avatar-lab/body-female-L-tan.png --hair "short curly" --hairColor auburn --eyes green
 *
 * Výstupy jsou v tmp/avatar-lab/. Prompty jsou v server/prompts.mjs.
 * Každé volání stojí peníze – v konzoli se vypíše spotřeba a odhad ceny.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import sharp from 'sharp';
import { avatarBodyPrompt, avatarHeadPrompt } from '../server/prompts.mjs';
import { segment } from '../server/segmentation.mjs';

const OUT = 'tmp/avatar-lab';
const BASE = 'design-assets/avatar/avatar.png';
const MODEL = process.env.OPENAI_IMAGE_MODEL ?? 'gpt-image-2.5-sunburst';
const API = process.env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1';
// Ceník za 1M tokenů (developers.openai.com/api/docs/pricing, říjen 2026)
const PRICE = { imageIn: 8, textIn: 5, imageOut: 30 };
const USD_CZK = Number(process.env.USD_CZK ?? 23);

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    gender: { type: 'string' }, size: { type: 'string' }, skin: { type: 'string' },
    base: { type: 'string' }, hair: { type: 'string' }, hairColor: { type: 'string' },
    eyes: { type: 'string' }, beard: { type: 'string' }, glasses: { type: 'string' },
    quality: { type: 'string', default: 'medium' },
  },
});
if (!process.env.OPENAI_API_KEY) throw new Error('Chybí OPENAI_API_KEY – spusť s --env-file=.env');
mkdirSync(OUT, { recursive: true });

const command = positionals[0];
if (command === 'body') {
  const opts = { gender: values.gender ?? 'male', size: values.size ?? 'M', skin: values.skin ?? 'medium' };
  const png = await edit([readFileSync(BASE)], avatarBodyPrompt(opts));
  save(`body-${opts.gender}-${opts.size}-${opts.skin}.png`, png);
} else if (command === 'head') {
  const base = readFileSync(values.base ?? BASE);
  const mask = await headMask(base);
  save('head-mask.png', mask.preview);
  const png = await edit([base], avatarHeadPrompt(values), mask.png);
  // Pojistka: mimo masku vrátíme původní pixely, aby tělo zůstalo stejné a oblečení dál sedělo.
  const merged = await mergeInside(base, png, mask.alpha);
  const name = ['head', values.hair, values.hairColor, values.eyes, values.beard, values.glasses].filter(Boolean).join('-').replace(/\s+/g, '_');
  save(`${name}-raw.png`, png);
  save(`${name}.png`, merged);
} else {
  console.log('Použití: avatar-lab.mjs body|head [volby] – viz komentář v souboru.');
  process.exit(1);
}

async function edit(images, prompt, mask) {
  console.log(`→ ${MODEL}, ${values.quality}: ${prompt}\n`);
  const started = Date.now();
  const body = {
    model: MODEL,
    prompt,
    images: images.map((b) => ({ image_url: dataUrl(b) })),
    size: '688x1024',
    quality: values.quality,
    output_format: 'png',
    ...(mask ? { mask: { image_url: dataUrl(mask) } } : {}),
  };
  const res = await fetch(`${API}/images/edits`, {
    method: 'POST',
    headers: { authorization: `Bearer ${process.env.OPENAI_API_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`OpenAI ${res.status}: ${JSON.stringify(json.error ?? json)}`);
  const u = json.usage ?? {};
  const imgIn = u.input_tokens_details?.image_tokens ?? 0;
  const txtIn = u.input_tokens_details?.text_tokens ?? (u.input_tokens ?? 0) - imgIn;
  const usd = (imgIn * PRICE.imageIn + txtIn * PRICE.textIn + (u.output_tokens ?? 0) * PRICE.imageOut) / 1e6;
  console.log(`✓ ${((Date.now() - started) / 1000).toFixed(1)} s · tokeny: ${imgIn} obr. + ${txtIn} text → ${u.output_tokens} výstup · cca $${usd.toFixed(3)} (${(usd * USD_CZK).toFixed(2)} Kč)`);
  return Buffer.from(json.data[0].b64_json, 'base64');
}

/** Maska hlavy: vlasy + obličej (z modelu SegFormer), rozšířená nahoru a do stran, ale ne pod ramena. */
async function headMask(buffer) {
  const { W, H, masks } = await segment(buffer);
  const head = new Uint8Array(W * H);
  let minX = W, maxX = 0, minY = H, maxY = 0;
  for (const label of ['Hair', 'Face', 'Sunglasses', 'Hat']) {
    const m = masks.get(label);
    if (!m) continue;
    for (let i = 0; i < m.length; i++) if (m[i]) {
      head[i] = 1;
      const x = i % W, y = Math.floor(i / W);
      if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
  }
  // Spodní hranice = začátek trupu (ramena), aby se tělo nikdy neměnilo.
  const upper = masks.get('Upper-clothes');
  let shoulders = maxY;
  if (upper) for (let i = 0; i < upper.length; i++) if (upper[i]) { shoulders = Math.floor(i / W); break; }
  const pad = Math.round((maxX - minX) * 0.35);
  const alpha = new Uint8Array(W * H);
  for (let y = 0; y < Math.min(H, shoulders); y++)
    for (let x = Math.max(0, minX - pad); x <= Math.min(W - 1, maxX + pad); x++) {
      // oblast hlavy + volné místo nad ní a vedle ní (pro jiný účes)
      if (y < minY + (maxY - minY) * 0.6 || head[y * W + x]) alpha[y * W + x] = 1;
    }
  // OpenAI maska: průhledné = smí se měnit, neprůhledné = zachovat.
  const rgba = Buffer.alloc(W * H * 4, 255);
  const preview = Buffer.alloc(W * H * 3);
  for (let i = 0; i < W * H; i++) {
    rgba[i * 4 + 3] = alpha[i] ? 0 : 255;
    preview.fill(alpha[i] ? 255 : 0, i * 3, i * 3 + 3);
  }
  return {
    alpha,
    png: await sharp(rgba, { raw: { width: W, height: H, channels: 4 } }).png().toBuffer(),
    preview: await sharp(preview, { raw: { width: W, height: H, channels: 3 } }).png().toBuffer(),
  };
}

/** Výsledek = generovaná hlava uvnitř masky (se změkčeným okrajem) + původní obrázek všude jinde. */
async function mergeInside(base, generated, alpha) {
  const W = 688, H = 1024;
  const a = await sharp(Buffer.from(alpha.map((v) => v * 255)), { raw: { width: W, height: H, channels: 1 } })
    .blur(3).extractChannel(0).raw().toBuffer();
  const b = await sharp(base).resize(W, H).removeAlpha().raw().toBuffer();
  const g = await sharp(generated).resize(W, H).removeAlpha().raw().toBuffer();
  const out = Buffer.alloc(W * H * 3);
  for (let i = 0; i < W * H; i++) {
    const t = a[i] / 255;
    for (let c = 0; c < 3; c++) out[i * 3 + c] = Math.round(g[i * 3 + c] * t + b[i * 3 + c] * (1 - t));
  }
  return sharp(out, { raw: { width: W, height: H, channels: 3 } }).png().toBuffer();
}

function dataUrl(buffer) {
  return `data:image/png;base64,${buffer.toString('base64')}`;
}

function save(name, buffer) {
  writeFileSync(`${OUT}/${name}`, buffer);
  console.log(`  uloženo ${OUT}/${name}`);
}
