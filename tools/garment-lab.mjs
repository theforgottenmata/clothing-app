/**
 * Dílna oblečení – ladění druhé fáze (kus z fotky → cartoon vrstva na avatara) na jednom těle.
 *
 *   node --env-file=.env tools/garment-lab.mjs fotka.jpg --category outerwear --color Zelená
 *   node --env-file=.env tools/garment-lab.mjs dziny.png --category bottom --length long --color Černá
 *   node --env-file=.env tools/garment-lab.mjs bunda.png --category outerwear --quality high
 *
 * Tělo: muž M, střední pleť (design-assets/avatars/male-M-medium.webp), přepnout jde --body female-M-medium.
 * Výstupy v tmp/garment-lab/: <název>-1-vyrez.png (kus z fotky), -2-obleceny.png (výstup AI),
 * -3-vrstva.png (vrstva na postavu), -3b-mazani.png (kde se avatar pod kusem schová), -4-nahled.png (avatar s obličejem + vrstva), -zona.png (kde smí AI kreslit).
 * Prompt je v server/prompts.mjs (garmentPrompt). Jedno spuštění = 1 volání OpenAI (cca 1 Kč ve střední kvalitě).
 * --reuse = bez volání AI: vezme uložený výřez (-1-vyrez) a výstup AI (-2-obleceny) a jen znovu spočítá vrstvu
 *           (ladění výřezu zdarma).
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, extname } from 'node:path';
import { parseArgs } from 'node:util';
import sharp from 'sharp';
import { czk } from '../server/avatar.mjs';
import { dressAvatar, extractGarment, zoneRegion } from '../server/garment.mjs';
import { existsSync } from 'node:fs';
import { extractGarments, segment } from '../server/segmentation.mjs';

const OUT = 'tmp/garment-lab';
const CATEGORIES = ['top', 'outerwear', 'bottom', 'shoes', 'accessory'];

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    category: { type: 'string' },
    length: { type: 'string', default: 'long' },
    color: { type: 'string' },
    body: { type: 'string', default: 'male-M-medium' },
    quality: { type: 'string' },
    'no-cut': { type: 'boolean', default: false },
    reuse: { type: 'boolean', default: false },
  },
});
const photo = positionals[0];
if (!photo || !CATEGORIES.includes(values.category)) {
  console.log(`Použití: garment-lab.mjs <fotka> --category ${CATEGORIES.join('|')} [--length long|short] [--color Černá] [--quality low|medium|high]`);
  process.exit(1);
}
mkdirSync(OUT, { recursive: true });
const name = basename(photo, extname(photo));
const save = (suffix, buf) => {
  writeFileSync(`${OUT}/${name}-${suffix}.png`, buf);
  console.log(`  ${OUT}/${name}-${suffix}.png`);
};

// 1. Výřez kusu z fotky (lokálně, zdarma) – stejně jako při přidání kusu v aplikaci.
const input = readFileSync(photo);
const reuse = values.reuse && existsSync(`${OUT}/${name}-2-obleceny.png`) && existsSync(`${OUT}/${name}-1-vyrez.png`);
let cutout = await sharp(input).png().toBuffer();
if (reuse) {
  cutout = readFileSync(`${OUT}/${name}-1-vyrez.png`);
} else if (!values['no-cut']) {
  const [res] = await extractGarments(input, [{ category: values.category, primaryColor: values.color ?? null }]);
  if (res.image) cutout = Buffer.from(res.image.split(',')[1], 'base64');
  if (res.warning) console.log(`  ⚠ ${res.warning}`);
}
if (!reuse) save('1-vyrez', cutout);

// 2. + 3. Oblečení na tělo přes AI a vrstva z rozdílu.
const gender = values.body.split('-')[0];
const [g, s, k] = values.body.split('-');
const body = await sharp(readFileSync(`design-assets/avatars/${values.body}.webp`)).png().toBuffer();
const faceFile = `design-assets/avatars/face-${gender}-default${k === 'medium' ? '' : `-${k}`}.webp`;
const face = readFileSync(faceFile);
const bodyWithFace = await sharp(body).composite([{ input: face }]).png().toBuffer();
const hint = { category: values.category, bottomLength: values.length };
console.log(`\n▶ ${name}: ${values.category}${values.category === 'bottom' ? ` (${values.length})` : ''} na tělo ${g}-${s}-${k}${reuse ? ' – bez AI (--reuse)' : ''}`);
const started = Date.now();
let dressed, layer, erase, region, usd = 0;
if (reuse) {
  const seg = await segment(bodyWithFace);
  region = zoneRegion(seg, hint);
  dressed = await sharp(readFileSync(`${OUT}/${name}-2-obleceny.png`)).removeAlpha().png().toBuffer();
  ({ layer, erase } = await extractGarment(dressed, body, region, hint, seg, cutout));
} else {
  ({ dressed, layer, erase, region, usd } = await dressAvatar(body, cutout, hint, bodyWithFace, { quality: values.quality }));
  save('2-obleceny', dressed);
}
save('3-vrstva', layer);
save('3b-mazani', erase);

// 4. Náhled: průhledné tělo + obličej + vrstva oblečení na pozadí aplikace.
// Tělo „vygumované“ maskou mazání (jako to bude dělat aplikace), pak obličej a vrstva oblečení.
const transparent = await sharp(readFileSync(`design-assets/avatars/${values.body}-transparent.webp`))
  .composite([{ input: erase, blend: 'dest-out' }])
  .png()
  .toBuffer();
const preview = await sharp({ create: { width: 688, height: 1024, channels: 4, background: '#eef0f3' } })
  .composite([{ input: transparent }, { input: face }, { input: layer }])
  .png()
  .toBuffer();
save('4-nahled', preview);
const zone = Buffer.alloc(688 * 1024 * 3);
for (let i = 0; i < region.length; i++) zone.fill(region[i] ? 255 : 0, i * 3, i * 3 + 3);
save('zona', await sharp(zone, { raw: { width: 688, height: 1024, channels: 3 } }).png().toBuffer());
console.log(`\nHotovo za ${((Date.now() - started) / 1000).toFixed(0)} s, cca $${usd.toFixed(3)} (${(usd * czk()).toFixed(2)} Kč).`);
