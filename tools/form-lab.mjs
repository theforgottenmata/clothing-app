/**
 * Dílna formičky – ladění kreslení kusů přes figurínu (server/form.mjs, stejný kód jako aplikace).
 *
 *   node --env-file=.env tools/form-lab.mjs design-assets/clothes-raw/black-jean.png --category bottom
 *   node --env-file=.env tools/form-lab.mjs green-jacket black-jacket-ppl --category outerwear
 *   node --env-file=.env tools/form-lab.mjs green-jacket --category outerwear --reuse   # bez AI, jen přepočet výřezu
 *
 * Kus = cesta k fotce (výřez se udělá tady, zdarma) nebo název z tmp/garment-lab/<název>-1-vyrez.png.
 * Výstup: tmp/form-lab/<název>-*.png a tmp/form-lab/porovnani.png
 * (řádek = kus: forma | výstup AI | na avatarovi). Jedno volání AI na kus (~1,5 Kč), --reuse zdarma.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, extname } from 'node:path';
import { parseArgs } from 'node:util';
import sharp from 'sharp';
import { czk, H, W } from '../server/avatar.mjs';
import { cutFromForm, drawOnForm, formImage, formPrompt, formShape, pickTints } from '../server/form.mjs';
import { garmentPalette, zoneRegion } from '../server/garment.mjs';
import { extractGarments, segment } from '../server/segmentation.mjs';

const LAB = 'tmp/garment-lab';
const OUT = 'tmp/form-lab';
const AV = 'design-assets/avatars';

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    category: { type: 'string', default: 'outerwear' },
    length: { type: 'string', default: 'long' },
    body: { type: 'string', default: 'male-M-medium' },
    quality: { type: 'string' },
    reuse: { type: 'boolean', default: false },
  },
});
if (!positionals.length || !['top', 'outerwear', 'bottom'].includes(values.category)) {
  console.log('Použití: form-lab.mjs <fotka nebo kus> [...] --category top|outerwear|bottom [--length long|short] [--reuse]');
  process.exit(1);
}
mkdirSync(OUT, { recursive: true });
mkdirSync(LAB, { recursive: true });

const hint = { category: values.category, bottomLength: values.length === 'short' ? 'short' : 'long' };
const [g] = values.body.split('-');
const body = await sharp(readFileSync(`${AV}/${values.body}.webp`)).png().toBuffer();
const face = readFileSync(`${AV}/face-${g}-default.webp`);
const seg = await segment(await sharp(body).composite([{ input: face }]).png().toBuffer());
const shape = await formShape(seg, zoneRegion(seg, hint), hint.category);
console.log(`Forma ${hint.category}: výřez ${shape.cw}×${shape.ch} px na [${shape.x0}, ${shape.y0}]`);

const rows = [];
let total = 0;
for (const arg of positionals) {
  let name = arg;
  let garment;
  if (existsSync(arg)) {
    name = basename(arg, extname(arg));
    const [res] = await extractGarments(readFileSync(arg), [{ category: hint.category, primaryColor: null }]);
    if (!res.image) {
      console.log(`Přeskakuji ${arg}: kus se na fotce nepodařilo najít.`);
      continue;
    }
    garment = Buffer.from(res.image.split(',')[1], 'base64');
    writeFileSync(`${LAB}/${name}-1-vyrez.png`, garment);
  } else if (existsSync(`${LAB}/${name}-1-vyrez.png`)) {
    garment = readFileSync(`${LAB}/${name}-1-vyrez.png`);
  } else {
    console.log(
      arg.includes('/') || arg.includes('.')
        ? `Přeskakuji ${arg}: soubor neexistuje – zkontroluj cestu (ls design-assets/clothes-raw).`
        : `Přeskakuji ${name}: chybí ${LAB}/${name}-1-vyrez.png (nebo zadej cestu k fotce).`,
    );
    continue;
  }

  const tints = pickTints(await garmentPalette(garment));
  const form = await formImage(shape, tints);
  writeFileSync(`${OUT}/${name}-1-forma.png`, form);
  const aiFile = `${OUT}/${name}-2-ai.png`;
  let ai;
  if (values.reuse && existsSync(aiFile)) {
    ai = readFileSync(aiFile);
    console.log(`▶ ${name}: bez AI (--reuse)`);
  } else {
    process.stdout.write(`▶ ${name}: figurína ${tints.fig.name}, pozadí ${tints.back.name}… `);
    try {
      const out = await drawOnForm(form, garment, formPrompt(tints, hint), shape, values.quality);
      total += out.usd;
      ai = out.png;
      writeFileSync(aiFile, ai);
    } catch (error) {
      console.log(`chyba: ${error.message}`);
      continue;
    }
  }
  const { layer, erase } = await cutFromForm(ai, shape, tints);
  writeFileSync(`${OUT}/${name}-3-vrstva.png`, layer);
  const torso = await sharp(readFileSync(`${AV}/${values.body}-transparent.webp`)).composite([{ input: erase, blend: 'dest-out' }]).png().toBuffer();
  const preview = await sharp({ create: { width: W, height: H, channels: 4, background: '#eef0f3' } })
    .composite([{ input: torso }, { input: face }, { input: layer }])
    .png()
    .toBuffer();
  writeFileSync(`${OUT}/${name}-4-nahled.png`, preview);
  rows.push([form, ai, preview]);
}

const CW = 300, CH = 446;
const cells = [];
for (const [r, imgs] of rows.entries())
  for (const [c, img] of imgs.entries())
    cells.push({ input: await sharp(img).resize(CW, CH, { fit: 'contain', background: '#ffffff' }).png().toBuffer(), left: c * (CW + 10), top: r * (CH + 10) });
if (cells.length) {
  await sharp({ create: { width: 3 * (CW + 10), height: rows.length * (CH + 10), channels: 3, background: '#ffffff' } })
    .composite(cells)
    .png()
    .toFile(`${OUT}/porovnani.png`);
}
console.log(`\nHotovo, cca $${total.toFixed(3)} (${(total * czk()).toFixed(1)} Kč). Porovnání: ${OUT}/porovnani.png (forma | výstup AI | na avatarovi)`);
