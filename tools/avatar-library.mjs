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
 *   node --env-file=.env tools/avatar-library.mjs --faces              # přebarvit obličej pro všechny pleti (zdarma)
 *        – dělá se i automaticky po přebarvení těla
 *
 * Postup, aby těla do sebe pasovala:
 *   male-M-medium   = výchozí avatar s holou hlavou bez obličeje
 *   female-M-medium = výchozí avatar převedený na ženu, holá hlava bez obličeje
 *   face-{g}-default = obličej + vlasy namalované na holou hlavu {g}-M-medium, vyříznuté rozdílem obrázků
 *   {g}-{S|L|XL}-medium = jiná velikost z {g}-M-medium; hlava zůstane pixel po pixelu stejná (maska bez hlavy)
 *   {g}-{velikost}-{light|tan|dark} = LOKÁLNĚ přebarvená kůže těla se střední pletí (zdarma, bez AI);
 *                     obličej face-{g}-default-{pleť} se přebarví stejným poměrem
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
  faceSolid,
  headRegion,
  mergeInside,
  meanSkin,
  personRegion,
  recolorSkin,
  SKIN_TONES,
  skinRegion,
  subtract,
  toOpenAiMask,
  withTransparent,
} from '../server/avatar.mjs';
import { BODY_SIZES, blankHeadPrompt, buildPrompt, defaultFacePrompt, femaleBasePrompt, maleBasePrompt } from '../server/prompts.mjs';
import { segment } from '../server/segmentation.mjs';

const DIR = 'design-assets/avatars';
const BASE = 'design-assets/avatar/avatar.png';
const GENDERS = ['male', 'female'];
const SIZES = BODY_SIZES;
const SKINS = ['light', 'medium', 'tan', 'dark'];
const ratioCache = new Map();
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
    faces: { type: 'boolean', default: false },
  },
});
mkdirSync(DIR, { recursive: true });

const id = (g, s, k) => `${g}-${s}-${k}`;
const file = (bodyId, kind = 'opaque') =>
  bodyId.startsWith('face-') ? `${DIR}/${bodyId}.webp` : `${DIR}/${bodyId}${kind === 'opaque' ? '' : '-transparent'}.webp`;
// Tělo existuje, když má průhlednou verzi (neprůhledná se drží jen u střední pleti – podklad pro AI).
const exists = (bodyId) => existsSync(bodyId.startsWith('face-') ? file(bodyId) : file(bodyId, 'transparent'));

/** Z čeho a jak vzniká dané tělo. */
function recipe(bodyId) {
  const [g, s, k] = bodyId.split('-');
  if (bodyId.startsWith('face-')) return { from: `${bodyId.split('-')[1]}-M-medium`, kind: 'face', gender: bodyId.split('-')[1] };
  if (bodyId === 'male-M-medium') return { from: null, kind: 'male' };
  if (bodyId === 'female-M-medium') return { from: null, kind: 'female' };
  // Jiná pleť se nepočítá přes AI, ale lokálně přebarvením kůže těla stejné velikosti se střední pletí.
  if (k !== 'medium') return { from: id(g, s, 'medium'), kind: 'skin', gender: g, skin: k };
  return { from: id(g, 'M', 'medium'), kind: 'build', gender: g, size: s };
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

if (values.faces) {
  for (const g of GENDERS) for (const k of SKINS) if (k !== 'medium') await skinFace(g, k);
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

const calls = plan.filter((b) => recipe(b).kind !== 'skin').length;
console.log(`Hotových těl: ${bodies.filter(exists).length}/${bodies.length}, obličejů: ${faces.filter(exists).length}/2. K vygenerování: ${plan.length} (${calls} volání OpenAI).`);
for (const b of plan) console.log(`  ${b.padEnd(16)} ← ${recipe(b).kind === 'skin' ? 'přebarvení zdarma' : 'AI ' + recipe(b).kind}${recipe(b).from ? ` z ${recipe(b).from}` : ''}`);
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
  } else if (r.kind === 'skin') {
    png = await recolorBody(r.from, r.gender, r.skin);
  } else {
    const source = await sharp(readFileSync(file(r.from))).png().toBuffer();
    const seg = await segment(source);
    // Mění se postava kromě hlavy; rezerva do šířky pro mohutnější těla.
    const grow = { S: 12, L: 28, XL: 44 }[r.size];
    const region = subtract(personRegion(seg, grow), headRegion(seg));
    const out = await edit([source], buildPrompt(r.gender, r.size), await toOpenAiMask(region));
    spent += out.usd;
    // Mimo masku vrátíme původní pixely (pozadí, hlava) – těla do sebe přesně pasují.
    png = await mergeInside(source, out.png, region, 2);
  }
  await save(bodyId, png);
  if (r.kind === 'skin') await skinFace(r.gender, r.skin);
}
await writeManifest();
console.log(`\nHotovo. Utraceno cca $${spent.toFixed(3)} (${(spent * czk()).toFixed(2)} Kč).`);

async function save(bodyId, png) {
  const seg = await segment(png);
  const transparent = await withTransparent(png, seg);
  // Neprůhledná verze jen u střední pleti – je to podklad pro úpravy přes AI; ostatní pleti se z ní přebarví.
  if (bodyId.endsWith('-medium')) await sharp(png).webp({ quality: 92 }).toFile(file(bodyId));
  await sharp(transparent).webp({ quality: 92, alphaQuality: 100 }).toFile(file(bodyId, 'transparent'));
  console.log(`  uloženo ${file(bodyId, 'transparent')}`);
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
    for (const k of ['medium']) {
      if (values.gender && g !== values.gender) continue;
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
    const originalSeg = await segment(original);
    const region = headRegion(originalSeg);
    const out = await edit([original], blankHeadPrompt(), await toOpenAiMask(region));
    spent += out.usd;
    const blank = await mergeInside(original, out.png, region, 2);
    // Původní obličej + vlasy jako samostatná vrstva (jen to, čím se liší od holé hlavy).
    const faceId = `face-${g}-default`;
    if (!exists(faceId) || values.force) {
      // Obličej + vlasy celé z originálu (bez děr), rozdíl doplní jen přesahy (pramínky vlasů).
      const layer = await diffLayer(blank, original, region, 36, faceSolid(originalSeg));
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

/**
 * Poměr barev střední pleť → cílová pleť. Měří se na těle M se střední pletí složeném s obličejem
 * (obličej pomůže SegFormeru najít hlavu a krk). Stejný poměr pro tělo i obličej = stejný odstín.
 */
async function skinRatio(g, k) {
  const key = `${g}-${k}`;
  if (!ratioCache.has(key)) {
    const composed = await composeWithFace(id(g, 'M', 'medium'), g);
    const mean = await meanSkin(composed, skinRegion(await segment(composed)));
    ratioCache.set(key, SKIN_TONES[k].map((t, c) => t / Math.max(1, mean[c])));
  }
  return ratioCache.get(key);
}

async function composeWithFace(bodyId, g) {
  const body = sharp(readFileSync(file(bodyId)));
  const face = `face-${g}-default`;
  return exists(face) ? body.composite([{ input: readFileSync(file(face)) }]).png().toBuffer() : body.png().toBuffer();
}

/** Tělo v jiné pleti = přebarvené tělo stejné velikosti se střední pletí (zdarma). */
async function recolorBody(fromId, g, k) {
  const source = await sharp(readFileSync(file(fromId))).png().toBuffer();
  const mask = skinRegion(await segment(await composeWithFace(fromId, g)));
  return recolorSkin(source, await skinRatio(g, k), mask);
}

/** Obličej v jiné pleti = přebarvený výchozí obličej stejným poměrem (zdarma). */
async function skinFace(g, k) {
  const base = `face-${g}-default`;
  const target = `face-${g}-default-${k}`;
  if (!exists(base) || !exists(id(g, 'M', 'medium'))) return;
  if (exists(target) && !values.force) return;
  const face = await sharp(readFileSync(file(base))).png().toBuffer();
  await sharp(await recolorSkin(face, await skinRatio(g, k))).webp({ quality: 92, alphaQuality: 100 }).toFile(file(target));
  console.log(`  uloženo ${file(target)}`);
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
    const seg = await segment(await sharp(readFileSync(file(bodyId, 'transparent'))).flatten({ background: '#e2e2e7' }).png().toBuffer());
    done[bodyId] = { gender, size, skin, map: bodyMap(seg) };
  }
  const faceIds = [...faces, ...GENDERS.flatMap((g) => SKINS.filter((k) => k !== 'medium').map((k) => `face-${g}-default-${k}`))];
  const doneFaces = faceIds.filter(exists).map((f) => {
    const [, gender, name, skin = 'medium'] = f.split('-');
    return { id: f, gender, name, skin };
  });
  writeFileSync(
    `${DIR}/manifest.json`,
    JSON.stringify({ size: { w: 688, h: 1024 }, bodies: done, faces: doneFaces, blankHeads: blankHeadsDone }, null, 2),
  );
  console.log(`manifest.json: ${Object.keys(done).length} těl, ${doneFaces.length} obličejů`);
}
