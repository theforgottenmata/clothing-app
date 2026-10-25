/**
 * Knihovna těl avatara: pohlaví (2) × postava (4) × pleť (4) = 32 variant.
 * Generuje se jednou, výsledky jsou v design-assets/avatars/ a aplikace mezi nimi jen přepíná.
 *
 *   node --env-file=.env tools/avatar-library.mjs                      # jen plán a odhad ceny (nic neplatí)
 *   node --env-file=.env tools/avatar-library.mjs --run                # vygeneruje vše, co chybí
 *   node --env-file=.env tools/avatar-library.mjs --only female-L-tan --run
 *   node --env-file=.env tools/avatar-library.mjs --only male-XL-dark --force --run   # přegenerovat
 *   node --env-file=.env tools/avatar-library.mjs --manifest           # jen přepočítat manifest (zdarma)
 *
 * Postup, aby těla do sebe pasovala:
 *   male-M-medium   = výchozí avatar (bez volání)
 *   female-M-medium = výchozí avatar převedený na ženu (1 volání)
 *   {g}-M-{pleť}    = jiná pleť, mění se jen postava, pozadí zůstane (maska postavy)
 *   {g}-{S|L|XL}-{pleť} = jiná postava z {g}-M-{pleť}; hlava zůstane pixel po pixelu stejná (maska bez hlavy)
 * Prompty jsou v server/prompts.mjs.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import sharp from 'sharp';
import {
  bodyMap,
  czk,
  edit,
  headRegion,
  mergeInside,
  personRegion,
  subtract,
  toOpenAiMask,
  withTransparent,
} from '../server/avatar.mjs';
import { buildPrompt, femaleBasePrompt, skinPrompt } from '../server/prompts.mjs';
import { segment } from '../server/segmentation.mjs';

const DIR = 'design-assets/avatars';
const BASE = 'design-assets/avatar/avatar.png';
const GENDERS = ['male', 'female'];
const SIZES = ['S', 'M', 'L', 'XL'];
const SKINS = ['light', 'medium', 'tan', 'dark'];
const EST_USD_PER_CALL = 0.045;

const { values } = parseArgs({
  options: {
    run: { type: 'boolean', default: false },
    force: { type: 'boolean', default: false },
    only: { type: 'string' },
    manifest: { type: 'boolean', default: false },
  },
});
mkdirSync(DIR, { recursive: true });

const id = (g, s, k) => `${g}-${s}-${k}`;
const file = (bodyId, kind = 'opaque') => `${DIR}/${bodyId}${kind === 'opaque' ? '' : '-transparent'}.webp`;
const exists = (bodyId) => existsSync(file(bodyId));

/** Z čeho a jak vzniká dané tělo. */
function recipe(bodyId) {
  const [g, s, k] = bodyId.split('-');
  if (bodyId === 'male-M-medium') return { from: null, kind: 'copy' };
  if (bodyId === 'female-M-medium') return { from: null, kind: 'female' };
  if (s === 'M') return { from: id(g, 'M', 'medium'), kind: 'skin', skin: k };
  return { from: id(g, 'M', k), kind: 'build', gender: g, size: s };
}

const all = GENDERS.flatMap((g) => SIZES.flatMap((s) => SKINS.map((k) => id(g, s, k))));
const wanted = values.only ? values.only.split(',').map((x) => x.trim()) : all;
for (const w of wanted) if (!all.includes(w)) throw new Error(`Neznámé tělo: ${w} (formát pohlaví-postava-pleť, např. female-L-tan)`);

if (values.manifest) {
  await writeManifest();
  process.exit(0);
}

// Plán včetně chybějících předchůdců.
const plan = [];
const visit = (bodyId, forced) => {
  if (plan.includes(bodyId)) return;
  if (exists(bodyId) && !forced) return;
  const r = recipe(bodyId);
  if (r.from) visit(r.from, false);
  plan.push(bodyId);
};
for (const w of wanted) visit(w, values.force);

const calls = plan.filter((b) => recipe(b).kind !== 'copy').length;
console.log(`Hotových těl: ${all.filter(exists).length}/32. K vygenerování: ${plan.length} (${calls} volání OpenAI).`);
for (const b of plan) console.log(`  ${b.padEnd(16)} ← ${recipe(b).kind}${recipe(b).from ? ` z ${recipe(b).from}` : ''}`);
console.log(`Odhad ceny: cca $${(calls * EST_USD_PER_CALL).toFixed(2)} (${(calls * EST_USD_PER_CALL * czk()).toFixed(0)} Kč)`);
if (!plan.length) process.exit(0);
if (!values.run) {
  console.log('\nNic se negenerovalo. Spusť znovu s --run.');
  process.exit(0);
}

let spent = 0;
for (const bodyId of plan) {
  const r = recipe(bodyId);
  console.log(`\n▶ ${bodyId}`);
  let png;
  if (r.kind === 'copy') {
    png = await sharp(readFileSync(BASE)).removeAlpha().png().toBuffer();
  } else if (r.kind === 'female') {
    const out = await edit([readFileSync(BASE)], femaleBasePrompt());
    png = out.png;
    spent += out.usd;
  } else {
    const source = await sharp(readFileSync(file(r.from))).png().toBuffer();
    const seg = await segment(source);
    let region;
    let prompt;
    if (r.kind === 'skin') {
      region = personRegion(seg, 12);
      prompt = skinPrompt(r.skin);
    } else {
      // Mění se postava kromě hlavy; rezerva do šířky pro mohutnější těla.
      const grow = { S: 16, L: 48, XL: 80 }[r.size];
      region = subtract(personRegion(seg, grow), headRegion(seg));
      prompt = buildPrompt(r.gender, r.size);
    }
    const out = await edit([source], prompt, await toOpenAiMask(region));
    spent += out.usd;
    // Mimo masku vrátíme původní pixely (pozadí, u postavy i hlava) – těla do sebe přesně pasují.
    png = await mergeInside(source, out.png, region, 2);
  }
  await save(bodyId, png);
}
await writeManifest();
console.log(`\nHotovo. Utraceno cca $${spent.toFixed(3)} (${(spent * czk()).toFixed(2)} Kč).`);

async function save(bodyId, png) {
  const seg = await segment(png);
  const transparent = await withTransparent(png, seg);
  await sharp(png).webp({ quality: 92 }).toFile(file(bodyId));
  await sharp(transparent).webp({ quality: 92, alphaQuality: 100 }).toFile(file(bodyId, 'transparent'));
  console.log(`  uloženo ${file(bodyId)} (+ průhledná verze)`);
}

/** manifest.json – seznam hotových těl + mapa hlavy a zón (pro obličej a oblečení). */
async function writeManifest() {
  const bodies = {};
  for (const bodyId of all.filter(exists)) {
    const [gender, size, skin] = bodyId.split('-');
    const seg = await segment(await sharp(readFileSync(file(bodyId))).png().toBuffer());
    bodies[bodyId] = { gender, size, skin, map: bodyMap(seg) };
  }
  writeFileSync(`${DIR}/manifest.json`, JSON.stringify({ size: { w: 688, h: 1024 }, bodies }, null, 2));
  console.log(`manifest.json: ${Object.keys(bodies).length} těl`);
}
