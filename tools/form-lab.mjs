/**
 * Pokus „formička“ (docs/navrhy.md, 30. 10.): AI neobléká celého avatara, ale figurínu –
 * výřez avatara v zóně kusu, přebarvený na jednolitou barvu (stínování zůstane), na jednolitém pozadí jiné barvy.
 * Výřez kusu z výsledku = vše, co není barva figuríny ani pozadí. Kus se vrátí přesně na místo výřezu na avatarovi.
 *
 *   node --env-file=.env tools/form-lab.mjs green-jacket black-jacket-ppl bunda --category outerwear
 *
 * Vstup: názvy kusů z dílny (tmp/garment-lab/<název>-1-vyrez.png). Výstup: tmp/form-lab/<název>-*.png
 * a tmp/form-lab/porovnani.png (řádek = kus: forma | výstup AI | nová vrstva na avatarovi | dosavadní postup).
 * Cena: 1 volání AI na kus, menší obrázek než celý avatar.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import sharp from 'sharp';
import { czk, edit, H, W } from '../server/avatar.mjs';
import { garmentPalette, zoneRegion } from '../server/garment.mjs';
import { segment } from '../server/segmentation.mjs';

const LAB = 'tmp/garment-lab';
const OUT = 'tmp/form-lab';
const AV = 'design-assets/avatars';

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    category: { type: 'string', default: 'outerwear' },
    body: { type: 'string', default: 'male-M-medium' },
    quality: { type: 'string' },
  },
});
if (!positionals.length) {
  console.log('Použití: form-lab.mjs <kus> [<kus>…] --category outerwear|top|bottom|dress|shoes');
  process.exit(1);
}
mkdirSync(OUT, { recursive: true });

/** Barvy pro figurínu a pozadí – vybere se ta nejvzdálenější od barev kusu. */
const TINTS = {
  zelená: [40, 190, 80],
  purpurová: [215, 40, 190],
  modrá: [40, 100, 230],
  oranžová: [240, 140, 20],
};
const chroma = ([r, g, b]) => {
  const s = r + g + b + 1;
  return [r / s, g / s, b / s];
};
const cdist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

// --- forma (jednou pro tělo a kategorii) ---
const [g] = values.body.split('-');
const body = await sharp(readFileSync(`${AV}/${values.body}.webp`)).png().toBuffer();
const withFace = await sharp(body).composite([{ input: readFileSync(`${AV}/face-${g}-default.webp`) }]).png().toBuffer();
const seg = await segment(withFace);
const region = zoneRegion(seg, { category: values.category, bottomLength: 'long' });
const person = new Uint8Array(W * H);
const bg = seg.masks.get('Background');
for (let i = 0; i < person.length; i++) person[i] = bg && bg[i] ? 0 : 1;

// výřez = obdélník kolem zóny, strany dělitelné 16
let x0 = W, y0 = H, x1 = 0, y1 = 0;
for (let i = 0; i < region.length; i++) {
  if (!region[i]) continue;
  const x = i % W, y = (i - x) / W;
  x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
}
const pad = 16;
x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad);
let cw = Math.min(W - x0, Math.ceil((x1 - x0 + pad) / 16) * 16);
let ch = Math.min(H - y0, Math.ceil((y1 - y0 + pad) / 16) * 16);
cw -= cw % 16; ch -= ch % 16;
console.log(`Forma ${values.category}: výřez ${cw}×${ch} px na [${x0}, ${y0}] (celý avatar ${W}×${H})`);

// stínování těla rozmazané – zůstane tvar (svaly, objem), ale zmizí švy tílka a šortek, ať je AI nebere jako oblečení
const lum = await sharp(body).greyscale().blur(5).raw().toBuffer();
async function makeForm(fig, back) {
  const rgb = Buffer.alloc(cw * ch * 3);
  for (let y = 0; y < ch; y++)
    for (let x = 0; x < cw; x++) {
      const i = (y0 + y) * W + (x0 + x);
      const o = (y * cw + x) * 3;
      if (person[i]) {
        const l = Math.min(1.25, 0.35 + (lum[i] / 255) * 0.9); // stínování těla zůstane
        for (let c = 0; c < 3; c++) rgb[o + c] = Math.min(255, Math.round(fig[c] * l));
      } else for (let c = 0; c < 3; c++) rgb[o + c] = back[c];
    }
  return sharp(rgb, { raw: { width: cw, height: ch, channels: 3 } }).png().toBuffer();
}

const PROMPT = (figName, backName) =>
  [
    `The first image is a plain ${figName} mannequin (a solid-colour body shape, no face, no skin) on a plain ${backName} background.`,
    'Dress the mannequin in the clothing item from the second image, worn naturally and fitted to this body shape and pose, with soft realistic folds,',
    'in a clean 3D cartoon style (Pixar-like) with soft lighting. Keep the colour, pattern, logos and details of the item faithful to the second image.',
    `Do not change the mannequin pose, arms or proportions; parts of the mannequin not covered by the item stay exactly the same plain ${figName} colour,`,
    `and the background stays exactly the same flat ${backName} colour. Do not add hands, skin, a face or any other clothing.`,
  ].join(' ');

const rows = [];
let total = 0;
for (const name of positionals) {
  const file = `${LAB}/${name}-1-vyrez.png`;
  if (!existsSync(file)) {
    console.log(`Přeskakuji ${name}: chybí ${file}`);
    continue;
  }
  const garment = readFileSync(file);
  const pal = (await garmentPalette(garment)) ?? [];
  const ranked = Object.entries(TINTS)
    .map(([n, c]) => [n, c, Math.min(...pal.map((p) => cdist(chroma(p), chroma(c))), 1)])
    .sort((a, b) => b[2] - a[2]);
  const [[figName, fig], [backName, back]] = ranked;
  const form = await makeForm(fig, back);
  writeFileSync(`${OUT}/${name}-1-forma.png`, form);

  process.stdout.write(`▶ ${name}: figurína ${figName}, pozadí ${backName}… `);
  let out;
  try {
    out = await edit([form, garment], PROMPT(figName, backName), null, values.quality, { w: cw, h: ch });
  } catch (error) {
    // Kdyby OpenAI malý rozměr odmítla: stejný poměr stran, plocha jako celý avatar (strany dělitelné 16).
    if (error.status !== 400 || !/size/i.test(error.message)) throw error;
    const k = Math.sqrt((W * H) / (cw * ch));
    const big = { w: Math.round((cw * k) / 16) * 16, h: Math.round((ch * k) / 16) * 16 };
    console.log(`(rozměr ${cw}×${ch} odmítnut, zkouším ${big.w}×${big.h})`);
    out = await edit([form, garment], PROMPT(figName, backName), null, values.quality, big);
    out.png = await sharp(out.png).resize(cw, ch, { fit: 'fill' }).png().toBuffer();
  }
  total += out.usd;
  writeFileSync(`${OUT}/${name}-2-ai.png`, out.png);

  // výřez: vše, co není barva figuríny ani pozadí
  const d = await sharp(out.png).raw().toBuffer();
  const cf = chroma(fig), cb = chroma(back);
  let m = new Uint8Array(cw * ch);
  for (let i = 0; i < cw * ch; i++) {
    const p = [d[i * 3], d[i * 3 + 1], d[i * 3 + 2]];
    const c = chroma(p);
    const sat = Math.max(...p) - Math.min(...p);
    const isFig = sat > 40 && cdist(c, cf) < 0.09;
    const isBack = cdist(c, cb) < 0.07 && sat > 40;
    m[i] = isFig || isBack ? 0 : 1;
  }
  m = clean(m, cw, ch);
  const rgba = Buffer.alloc(W * H * 4);
  for (let y = 0; y < ch; y++)
    for (let x = 0; x < cw; x++) {
      const k = y * cw + x;
      if (!m[k]) continue;
      const o = ((y0 + y) * W + (x0 + x)) * 4;
      rgba[o] = d[k * 3]; rgba[o + 1] = d[k * 3 + 1]; rgba[o + 2] = d[k * 3 + 2]; rgba[o + 3] = 255;
    }
  const layer = await sharp(rgba, { raw: { width: W, height: H, channels: 4 } }).png().toBuffer();
  writeFileSync(`${OUT}/${name}-3-vrstva.png`, layer);
  const preview = await sharp({ create: { width: W, height: H, channels: 4, background: '#eef0f3' } })
    .composite([{ input: readFileSync(`${AV}/${values.body}-transparent.webp`) }, { input: readFileSync(`${AV}/face-${g}-default.webp`) }, { input: layer }])
    .png()
    .toBuffer();
  writeFileSync(`${OUT}/${name}-4-nahled.png`, preview);
  rows.push({ name, form, ai: out.png, preview });
}

// porovnání: forma | výstup AI | nová vrstva na avatarovi | dosavadní postup
const CW = 300, CH = 446;
const cells = [];
for (const [r, row] of rows.entries()) {
  const old = `${LAB}/${row.name}-4-nahled.png`;
  const imgs = [row.form, row.ai, row.preview, existsSync(old) ? readFileSync(old) : null];
  for (const [c, img] of imgs.entries()) {
    if (!img) continue;
    cells.push({ input: await sharp(img).resize(CW, CH, { fit: 'contain', background: '#ffffff' }).png().toBuffer(), left: c * (CW + 10), top: r * (CH + 10) });
  }
}
if (cells.length) {
  await sharp({ create: { width: 4 * (CW + 10), height: rows.length * (CH + 10), channels: 3, background: '#ffffff' } })
    .composite(cells)
    .png()
    .toFile(`${OUT}/porovnani.png`);
}
console.log(`\nHotovo, cca $${total.toFixed(3)} (${(total * czk()).toFixed(1)} Kč). Porovnání: ${OUT}/porovnani.png`);
console.log('Sloupce: forma | výstup AI | nová vrstva na avatarovi | dosavadní postup');

/** Úklid masky: otevření, jen velké oblasti, vyplnění děr. */
function clean(m, w, h) {
  const er = morph(m, w, h, true, 2);
  const op = morph(er, w, h, false, 2);
  // velké oblasti
  const seen = new Uint8Array(w * h), keep = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) {
    if (!op[i] || seen[i]) continue;
    const comp = [i], st = [i];
    seen[i] = 1;
    while (st.length) {
      const c = st.pop();
      const x = c % w;
      for (const n of [x > 0 ? c - 1 : -1, x < w - 1 ? c + 1 : -1, c - w, c + w]) {
        if (n < 0 || n >= w * h || seen[n] || !op[n]) continue;
        seen[n] = 1; st.push(n); comp.push(n);
      }
    }
    if (comp.length > 1500) for (const c of comp) keep[c] = 1;
  }
  return keep;
}
function morph(src, w, h, erode, r) {
  const pass = (from, horiz) => {
    const to = new Uint8Array(w * h);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        let v = erode ? 1 : 0;
        for (let k = -r; k <= r; k++) {
          const xx = horiz ? x + k : x, yy = horiz ? y : y + k;
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
