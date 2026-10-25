/**
 * Knihovna avatara: těla s holou hlavou bez obličeje – pohlaví (2) × velikost S–XL podle EN 13402 (4) × pleť (4) = 32.
 * Obličeje jsou samostatné průhledné vrstvy; generují se jen na vyžádání (--only face-male-default,face-female-default).
 * Generuje se jednou, výsledky jsou v design-assets/avatars/ a aplikace je jen skládá.
 *
 *   node --env-file=.env tools/avatar-library.mjs                      # jen plán a odhad ceny (nic neplatí)
 *   node --env-file=.env tools/avatar-library.mjs --run                # vygeneruje všechna chybějící těla
 *   node --env-file=.env tools/avatar-library.mjs --gender male --skin medium --run   # jen muži, jedna pleť
 *   node --env-file=.env tools/avatar-library.mjs --only female-L-tan,face-female-default --run
 *   node --env-file=.env tools/avatar-library.mjs --only male-XL-dark --force --run   # přegenerovat
 *   node --env-file=.env tools/avatar-library.mjs --manifest           # jen přepočítat manifest (zdarma)
 *   node --env-file=.env tools/avatar-library.mjs --blank-heads --run  # holé hlavy: 1 volání na pohlaví × pleť,
 *        hlava se vloží do všech velikostí a původní obličej se uloží jako vrstva face-{pohlaví}-default
 *
 * Postup, aby těla do sebe pasovala:
 *   male-M-medium   = výchozí avatar s holou hlavou bez obličeje
 *   female-M-medium = výchozí avatar převedený na ženu, holá hlava bez obličeje
 *   face-{g}-default = obličej + vlasy namalované na holou hlavu {g}-M-medium, vyříznuté rozdílem obrázků
 *   {g}-M-{pleť}    = jiná pleť, mění se jen postava, pozadí zůstane (maska postavy)
 *   {g}-{S|L|XL}-{pleť} = jiná velikost z {g}-M-{pleť}; hlava zůstane pixel po pixelu stejná (maska bez hlavy)
 * Prompty jsou v server/prompts.mjs.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import sharp from 'sharp';
import {
  bodyMap,
  czk,
  diffLayer,
  edit,
  headRegion,
  mergeInside,
  personRegion,
  subtract,
  toOpenAiMask,
  withTransparent,
} from '../server/avatar.mjs';
import { BODY_SIZES, blankHeadPrompt, buildPrompt, defaultFacePrompt, femaleBasePrompt, maleBasePrompt, skinPrompt } from '../server/prompts.mjs';
import { segment } from '../server/segmentation.mjs';

const DIR = 'design-assets/avatars';
const BASE = 'design-assets/avatar/avatar.png';
const GENDERS = ['male', 'female'];
const SIZES = BODY_SIZES;
const SKINS = ['light', 'medium', 'tan', 'dark'];
const EST_USD_PER_CALL = 0.045; // odhad pro střední kvalitu

const { values } = parseArgs({
  options: {
    run: { type: 'boolean', default: false },
    force: { type: 'boolean', default: false },
    only: { type: 'string' },
    gender: { type: 'string' },
    skin: { type: 'string' },
    manifest: { type: 'boolean', default: false },
    'blank-heads': { type: 'boolean', default: false },
  },
});
mkdirSync(DIR, { recursive: true });

const id = (g, s, k) => `${g}-${s}-${k}`;
const file = (bodyId, kind = 'opaque') =>
  bodyId.startsWith('face-') ? `${DIR}/${bodyId}.webp` : `${DIR}/${bodyId}${kind === 'opaque' ? '' : '-transparent'}.webp`;
const exists = (bodyId) => existsSync(file(bodyId));

/** Z čeho a jak vzniká dané tělo. */
function recipe(bodyId) {
  const [g, s, k] = bodyId.split('-');
  if (bodyId.startsWith('face-')) return { from: `${bodyId.split('-')[1]}-M-medium`, kind: 'face', gender: bodyId.split('-')[1] };
  if (bodyId === 'male-M-medium') return { from: null, kind: 'male' };
  if (bodyId === 'female-M-medium') return { from: null, kind: 'female' };
  if (s === 'M') return { from: id(g, 'M', 'medium'), kind: 'skin', skin: k };
  return { from: id(g, 'M', k), kind: 'build', gender: g, size: s };
}

const bodies = GENDERS.flatMap((g) => SIZES.flatMap((s) => SKINS.map((k) => id(g, s, k))));
const faces = GENDERS.map((g) => `face-${g}-default`);
const all = [...bodies, ...faces];
// Bez --only jen těla (volitelně jen jedno pohlaví / pleť); obličeje jsou volitelné.
const wanted = values.only
  ? values.only.split(',').map((x) => x.trim())
  : bodies.filter((b) => {
      const [g, , k] = b.split('-');
      return (!values.gender || g === values.gender) && (!values.skin || k === values.skin);
    });
for (const w of wanted) {
  if (!all.includes(w)) throw new Error(`Neznámá položka: ${w} (tělo pohlaví-postava-pleť, např. female-L-tan, nebo face-male-default)`);
}

if (values.manifest) {
  await writeManifest();
  process.exit(0);
}

if (values['blank-heads']) {
  await blankHeads();
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

const calls = plan.length;
console.log(`Hotových těl: ${bodies.filter(exists).length}/${bodies.length}, obličejů: ${faces.filter(exists).length}/2. K vygenerování: ${plan.length} (${calls} volání OpenAI).`);
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
  if (r.kind === 'male' || r.kind === 'female') {
    const out = await edit([readFileSync(BASE)], r.kind === 'male' ? maleBasePrompt() : femaleBasePrompt());
    png = out.png;
    spent += out.usd;
  } else if (r.kind === 'face') {
    const body = await sharp(readFileSync(file(r.from))).png().toBuffer();
    const region = headRegion(await segment(body));
    const out = await edit([body], defaultFacePrompt(r.gender), await toOpenAiMask(region));
    spent += out.usd;
    const painted = await mergeInside(body, out.png, region, 2);
    // Vrstva obličeje = jen to, co se na holé hlavě změnilo (oči, obočí, pusa, vlasy).
    const layer = await diffLayer(body, painted, region);
    await sharp(layer).webp({ quality: 92, alphaQuality: 100 }).toFile(file(bodyId));
    console.log(`  uloženo ${file(bodyId)}`);
    continue;
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
      const grow = { S: 12, L: 44, XL: 76 }[r.size];
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

/**
 * Holé hlavy bez obličeje: model obličej při úpravě těla často zachová, proto ho odstraníme zvlášť –
 * jen v masce hlavy těla M (1 volání na pohlaví × pleť). Hlava je u všech velikostí na stejném místě,
 * takže se holá hlava lokálně vloží i do S, L, XL. Původní obličej se zdarma vyřízne jako vrstva.
 */
async function blankHeads() {
  const done = new Set(readManifest().blankHeads ?? []);
  const todo = [];
  for (const g of GENDERS) {
    for (const k of SKINS) {
      if (values.gender && g !== values.gender) continue;
      if (values.skin && k !== values.skin) continue;
      if (!exists(id(g, 'M', k))) continue;
      if (done.has(`${g}-${k}`) && !values.force) continue;
      todo.push([g, k]);
    }
  }
  console.log(`Holé hlavy k vytvoření: ${todo.map(([g, k]) => `${g}-${k}`).join(', ') || 'žádné'}`);
  console.log(`Odhad ceny: cca $${(todo.length * EST_USD_PER_CALL).toFixed(2)} (${(todo.length * EST_USD_PER_CALL * czk()).toFixed(0)} Kč)`);
  if (!todo.length) return;
  if (!values.run) {
    console.log('\nNic se negenerovalo. Spusť znovu s --run.');
    return;
  }
  let spent = 0;
  for (const [g, k] of todo) {
    console.log(`\n▶ holá hlava ${g}-${k}`);
    const original = await sharp(readFileSync(file(id(g, 'M', k)))).png().toBuffer();
    const region = headRegion(await segment(original));
    const out = await edit([original], blankHeadPrompt(), await toOpenAiMask(region));
    spent += out.usd;
    const blank = await mergeInside(original, out.png, region, 2);
    // Původní obličej + vlasy jako samostatná vrstva (jen to, čím se liší od holé hlavy).
    const faceId = `face-${g}-default`;
    if (!exists(faceId) || values.force) {
      const layer = await diffLayer(blank, original, region);
      await sharp(layer).webp({ quality: 92, alphaQuality: 100 }).toFile(file(faceId));
      console.log(`  uloženo ${file(faceId)}`);
    }
    for (const size of SIZES) {
      const bodyId = id(g, size, k);
      if (!exists(bodyId)) continue;
      const img = await sharp(readFileSync(file(bodyId))).png().toBuffer();
      await save(bodyId, await mergeInside(img, blank, region, 1));
    }
    done.add(`${g}-${k}`);
    await writeManifest([...done]);
  }
  console.log(`\nHotovo. Utraceno cca $${spent.toFixed(3)} (${(spent * czk()).toFixed(2)} Kč).`);
}

function readManifest() {
  try {
    return JSON.parse(readFileSync(`${DIR}/manifest.json`, 'utf8'));
  } catch {
    return {};
  }
}

/** manifest.json – hotová těla s mapou hlavy a zón + hotové obličeje. */
async function writeManifest(blankHeadsDone = readManifest().blankHeads ?? []) {
  const done = {};
  for (const bodyId of bodies.filter(exists)) {
    const [gender, size, skin] = bodyId.split('-');
    const seg = await segment(await sharp(readFileSync(file(bodyId))).png().toBuffer());
    done[bodyId] = { gender, size, skin, map: bodyMap(seg) };
  }
  const doneFaces = faces.filter(exists).map((f) => ({ id: f, gender: f.split('-')[1], name: 'default' }));
  writeFileSync(
    `${DIR}/manifest.json`,
    JSON.stringify({ size: { w: 688, h: 1024 }, bodies: done, faces: doneFaces, blankHeads: blankHeadsDone }, null, 2),
  );
  console.log(`manifest.json: ${Object.keys(done).length} těl, ${doneFaces.length} obličejů`);
}
