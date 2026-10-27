/**
 * Oblečení na avatara (druhá fáze):
 *   1. maska zóny těla podle kategorie (SegFormer na těle avatara) – AI smí kreslit jen tam,
 *   2. úprava obrázku: tělo avatara + výřez kusu z fotky → „oblečený avatar“ ve stejném cartoon stylu,
 *   3. vrstva na postavu = rozdíl oblečeného a holého těla (ověřené parametry: práh 45, 14 na pozadí,
 *      morfologické otevření r=3, souvislé oblasti > 3000 px, vyplnění děr).
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import sharp from 'sharp';
import { H, SKIN_TONES, W, edit, headRegion, meanSkin, mergeInside, recolorSkin, skinRegion, subtract, toOpenAiMask } from './avatar.mjs';
import { garmentPrompt } from './prompts.mjs';
import { segment } from './segmentation.mjs';

const BACKGROUND = [226, 226, 231];

/**
 * @param {Buffer} body      neprůhledné tělo avatara (688×1024, holá hlava)
 * @param {Buffer} garment   výřez kusu (PNG, ideálně průhledný)
 * @param {{ category: string, bottomLength?: 'long'|'short' }} hint
 * @param {Buffer} [bodyWithFace]  tělo složené s obličejem – jen pro přesnější masku (hlavu SegFormer pozná lépe)
 * @returns {Promise<{ dressed: Buffer, layer: Buffer, region: Uint8Array, usd: number }>}
 */
export async function dressAvatar(body, garment, hint, bodyWithFace = body, { quality } = {}) {
  const seg = await segment(bodyWithFace);
  const region = zoneRegion(seg, hint);
  const flat = await sharp(garment).flatten({ background: '#ffffff' }).png().toBuffer();
  const out = await edit([body, flat], garmentPrompt(hint), await toOpenAiMask(region), quality);
  // Mimo zónu vrátíme původní pixely – oblečený avatar se od těla liší jen tam, kde je kus.
  const dressed = await mergeInside(body, out.png, region, 2);
  const { layer, erase } = await extractGarment(dressed, body, region, hint, seg, garment);
  return { dressed, layer, erase, region, usd: out.usd };
}

const AVATARS = new URL('../design-assets/avatars/', import.meta.url);
const CACHE = new URL('./.cache/dress/', import.meta.url);
const BODY_ID = /^(male|female)-(S|M|L|XL)-(light|medium|tan|dark)$/;
const segCache = new Map();
const ratioCache = new Map();
const inFlight = new Map();

/**
 * Kus na konkrétní tělo z knihovny (pro aplikaci).
 * - AI kreslí jen na tělo se střední pletí (pohlaví × velikost); jiná pleť = lokální přebarvení rukou ve vrstvě, zdarma.
 * - Výstup AI se ukládá do server/.cache/dress (klíč = kus + zadání + tělo + prompt) – stejný kus na stejném
 *   těle se nikdy neplatí dvakrát (jiná pleť, nové stažení, ladění výřezu).
 * - Stejný požadavek, který právě běží, se nespouští znovu.
 * @param {{ garment: Buffer, hint: { category: string, bottomLength?: string, reach?: string|null, name?: string, subtype?: string },
 *           bodyId: string, quality?: string, retry?: boolean }} req
 */
export async function dressFor({ garment, hint, bodyId, quality, retry = false, cachedOnly = false }) {
  const match = BODY_ID.exec(bodyId);
  if (!match) throw Object.assign(new Error('Neznámé tělo avatara.'), { status: 400 });
  const [, g, size, skinTone] = match;
  const baseId = `${g}-${size}-medium`;
  const bodyFile = new URL(`${baseId}.webp`, AVATARS);
  if (!existsSync(bodyFile)) throw Object.assign(new Error('Tohle tělo zatím v knihovně chybí.'), { status: 404 });
  const body = await sharp(readFileSync(bodyFile)).png().toBuffer();
  const faceFile = new URL(`face-${g}-default.webp`, AVATARS);
  const bodyWithFace = existsSync(faceFile) ? await sharp(body).composite([{ input: readFileSync(faceFile) }]).png().toBuffer() : body;

  if (!segCache.has(baseId)) segCache.set(baseId, segment(bodyWithFace));
  const seg = await segCache.get(baseId);
  const region = zoneRegion(seg, hint);
  const prompt = garmentPrompt(hint);
  const key = createHash('sha256').update(garment).update(prompt).update(baseId).update(quality ?? '').digest('hex').slice(0, 32);
  const cacheFile = new URL(`${key}.png`, CACHE);

  let usd = 0;
  let dressed;
  if (!retry && existsSync(cacheFile)) {
    dressed = readFileSync(cacheFile);
  } else if (cachedOnly) {
    // jen přepočet vrstvy po vylepšení výřezu – bez volání AI
    return { layer: null, erase: null, usd: 0, warning: null, missing: true };
  } else {
    if (!inFlight.has(key)) {
      const job = (async () => {
        const flat = await sharp(garment).flatten({ background: '#ffffff' }).png().toBuffer();
        const out = await edit([body, flat], prompt, await toOpenAiMask(region), quality);
        const merged = await mergeInside(body, out.png, region, 2);
        mkdirSync(CACHE, { recursive: true });
        writeFileSync(cacheFile, merged);
        return { dressed: merged, usd: out.usd };
      })().finally(() => inFlight.delete(key));
      inFlight.set(key, job);
    }
    ({ dressed, usd } = await inFlight.get(key));
  }

  const { layer: rawLayer, erase, dressedSkin } = await extractGarment(dressed, body, region, hint, seg, garment);
  let layer = rawLayer;
  if (skinTone !== 'medium') {
    // Ruce/kůže, které jsou ve vrstvě (posunuté dlaně, odhalená ramena), dostanou pleť zvoleného těla.
    if (!ratioCache.has(baseId + skinTone)) {
      const mean = await meanSkin(bodyWithFace, skinRegion(seg));
      ratioCache.set(baseId + skinTone, SKIN_TONES[skinTone].map((t, c) => t / Math.max(1, mean[c])));
    }
    layer = await recolorSkin(layer, ratioCache.get(baseId + skinTone), dilate(dressedSkin, W, H, 1));
  }
  const pixels = await opaquePixels(layer);
  const erased = await opaquePixels(erase);
  return {
    layer: pixels >= 1500 ? layer : null,
    erase: erased > 50 ? erase : null,
    usd,
    warning: pixels >= 1500 ? null : 'AI kus na postavu nenakreslila. Zkus to znovu, případně nahraj jinou fotku kusu.',
    missing: false,
  };
}

async function opaquePixels(png) {
  const { data, info } = await sharp(png).ensureAlpha().extractChannel(3).raw().toBuffer({ resolveWithObject: true });
  let n = 0;
  for (let i = 0; i < info.width * info.height; i++) if (data[i] > 127) n++;
  return n;
}

/** Štítky SegFormeru, které patří ke kusu dané kategorie. */
const GARMENT_LABELS = {
  top: ['Upper-clothes', 'Dress'],
  outerwear: ['Upper-clothes', 'Dress', 'Scarf', 'Skirt'],
  bottom: ['Pants', 'Skirt', 'Belt'],
  shoes: ['Left-shoe', 'Right-shoe'],
  accessory: ['Hat', 'Bag', 'Scarf', 'Belt', 'Sunglasses'],
};

/**
 * Vrstva kusu: rozdíl oblečeného a holého těla, ale jen tam, kde SegFormer na oblečeném avatarovi
 * vidí oblečení dané kategorie (vypadnou ruce, chodidla, kůže i světlé „duchy“ na pozadí)
 * a kde nezůstalo původní šedé tílko / šortky.
 * @param baseSeg segmentace těla (s obličejem) – kde bylo tílko a šortky
 */
export async function extractGarment(dressed, body, region, hint, baseSeg, garment = null) {
  const { category, reach } = hint;
  const dressedSeg = await segment(dressed);
  const labels = [...(GARMENT_LABELS[category] ?? GARMENT_LABELS.accessory)];
  // Dlouhý kabát přes nohy SegFormer občas vidí jako kalhoty.
  if (category === 'outerwear' && LONG.has(reach)) labels.push('Pants');
  const clothing = new Uint8Array(W * H);
  for (const l of labels) {
    const m = dressedSeg.masks.get(l);
    if (m) for (let i = 0; i < m.length; i++) clothing[i] |= m[i] & region[i];
  }
  const underwear = new Uint8Array(W * H);
  for (const l of ['Upper-clothes', 'Pants']) {
    const m = baseSeg.masks.get(l);
    if (m) for (let i = 0; i < m.length; i++) underwear[i] |= m[i];
  }
  const skin = new Uint8Array(W * H);
  for (const l of ['Left-arm', 'Right-arm', 'Left-leg', 'Right-leg', 'Face']) {
    const m = baseSeg.masks.get(l);
    if (m) for (let i = 0; i < m.length; i++) skin[i] |= m[i];
  }
  // Kůže na oblečeném avatarovi (ruce posunuté AI, odhalená kůže místo tílka u topů bez rukávů).
  const dressedSkin = new Uint8Array(W * H);
  for (const l of ['Left-arm', 'Right-arm', 'Face', 'Left-leg', 'Right-leg']) {
    const m = dressedSeg.masks.get(l);
    if (m) for (let i = 0; i < m.length; i++) dressedSkin[i] |= m[i];
  }

  // Kus, který SegFormer nezná (šperk, hodinky, neobvyklý doplněk): jen rozdíl obrázků v zóně.
  const known = count(clothing) >= 1500;
  // Horní okraj boty podle SegFormeru – kůže nad ním (kotník, lýtko) do vrstvy nepatří, pod ním (prsty v žabkách) ano.
  let shoeTop = H;
  if (category === 'shoes') for (let i = 0; i < clothing.length; i++) if (clothing[i]) { shoeTop = Math.floor(i / W) - 6; break; }
  // Boty: celá zóna chodidel (sandály a žabky jsou z velké části noha – patří k vrstvě, jinak zbudou jen cáry podrážky).
  const keep = category === 'shoes' ? region.map((v, i) => (v && Math.floor(i / W) >= shoeTop - 20 ? 1 : 0)) : known ? dilate(clothing, W, H, 3) : region.slice();
  if (category === 'top' || category === 'outerwear') {
    // Ruka, kterou AI nakreslila jinde, nebo kůže tam, kde bylo tílko (top bez rukávů / s výstřihem).
    const extra = new Uint8Array(W * H);
    for (let i = 0; i < keep.length; i++) {
      if (!region[i] || !dressedSkin[i] || keep[i]) continue;
      if (!skin[i] || (category === 'top' && underwear[i])) extra[i] = 1;
    }
    // Jen větší souvislé kusy kůže – tenké proužky (ruka posunutá o pár px pod krátkým rukávem) by trčely jako pahýly.
    const solid = largeComponents(morph(morph(extra, true, 4), false, 4), 1200);
    for (let i = 0; i < keep.length; i++) if (solid[i]) keep[i] = 1;
  }

  const palette = garment ? await garmentPalette(garment) : null;
  // Chodidla u spodků a bot do vrstvy nepatří (AI je překreslí) – kůže mimo barvy kusu vypadne.
  const skinTone = category === 'bottom' ? await meanColor(body, skin) : null;
  // Plocha, kterou SegFormer jasně vidí jako kus (mimo původní tílko/šortky), se bere celá: béžová bota
  // nebo kalhoty mají barvu pleti a rozdíl proti noze je malý, bílý kus zase splývá se světlem.
  // Jen vnitřek štítku (SegFormer má hrubé, schodovité okraje) – obrys kusu určí rozdíl obrázků.
  const core = known ? morphWH(clothing, W, H, true, category === 'shoes' ? 1 : 3) : null;
  const trusted = core ? core.map((v, i) => (v && !underwear[i] ? 1 : 0)) : null;
  // Odhalená kůže místo tílka (top bez rukávů) – bez filtru pleti.
  const allowSkin =
    category === 'top'
      ? underwear.map((v, i) => v & dressedSkin[i])
      : category === 'shoes'
        ? dressedSkin.map((v, i) => (v & region[i] && Math.floor(i / W) >= shoeTop ? 1 : 0))
        : null;
  const layer = await garmentLayer(dressed, body, region, {
    keep, underwear, skin, palette, skinTone, trusted, allowSkin,
    minComponent: category === 'shoes' || category === 'accessory' ? 800 : undefined,
  });
  const erase = await eraseMask(dressedSeg, baseSeg, region, dressed, body, category);
  return { layer, erase, dressedSkin };
}

const LONG = new Set(['thigh', 'knee', 'calf', 'ankle']);

function count(m) {
  let n = 0;
  for (let i = 0; i < m.length; i++) n += m[i];
  return n;
}

/**
 * Maska mazání: kde je na holém avatarovi tělo, ale na oblečeném už pozadí (AI posunula ruce, zúžila
 * siluetu). V aplikaci se těmito místy avatar „vygumuje“ (destination-out), aby původní ruce nebyly vidět vedle rukávů.
 * Vrací PNG 688×1024 – bílá s alfou = gumovat.
 */
async function eraseMask(dressedSeg, baseSeg, region, dressed, body, category) {
  // Gumuje se jen v místě původních paží (a u bot chodidel) – nohy a boky AI občas o pár px zúží, tam by vznikaly zuby.
  const baseArms = new Uint8Array(W * H);
  for (const l of ['Left-arm', 'Right-arm']) {
    const a = baseSeg.masks.get(l);
    if (a) for (let i = 0; i < a.length; i++) baseArms[i] |= a[i];
  }
  const allowed = dilate(baseArms, W, H, 6);
  if (category === 'shoes') {
    // jen pod horním okrajem boty (prsty koukající zpod podrážky) – kotníky ne, tam by vznikaly zuby
    let top = H;
    for (const l of ['Left-shoe', 'Right-shoe']) {
      const m = dressedSeg.masks.get(l);
      if (m) for (let i = 0; i < m.length; i++) if (m[i]) { top = Math.min(top, Math.floor(i / W)); break; }
    }
    for (let i = 0; i < allowed.length; i++) if (region[i] && Math.floor(i / W) >= top + 10) allowed[i] = 1;
  }
  const baseBg = baseSeg.masks.get('Background');
  const dressedBg = dressedSeg.masks.get('Background');
  const d = await sharp(dressed).resize(W, H).removeAlpha().raw().toBuffer();
  const b = await sharp(body).resize(W, H).removeAlpha().raw().toBuffer();
  const m = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) {
    // jen v zóně kusu, kde AI opravdu kreslila (mimo zónu je oblečený obrázek totožný s tělem)
    if (!region[i] || !allowed[i] || (baseBg && baseBg[i]) || !(dressedBg && dressedBg[i])) continue;
    const p = i * 3;
    if (dist(d, p, b.subarray(p, p + 3)) < 45) continue;
    // pojistka: na oblečeném obrázku je tam opravdu pozadí
    if (dist(d, p, BACKGROUND) > 40) continue;
    m[i] = 1;
  }
  const grown = dilate(m, W, H, 2);
  const alpha = await sharp(Buffer.from(grown.map((v) => v * 255)), { raw: { width: W, height: H, channels: 1 } })
    .blur(1)
    .extractChannel(0)
    .raw()
    .toBuffer();
  const rgba = Buffer.alloc(W * H * 4, 255);
  for (let i = 0; i < W * H; i++) rgba[i * 4 + 3] = alpha[i];
  return sharp(rgba, { raw: { width: W, height: H, channels: 4 } }).png().toBuffer();
}

/** Hlavní barvy kusu z fotky (k-means, 6 barev) – podle nich se pozná, co ve vrstvě ke kusu patří. */
export async function garmentPalette(garment, k = 6) {
  const { data, info } = await sharp(garment).ensureAlpha().resize(160, 160, { fit: 'inside' }).raw().toBuffer({ resolveWithObject: true });
  const px = [];
  let transparent = 0;
  for (let i = 0; i < info.width * info.height; i++) if (data[i * 4 + 3] < 200) transparent++;
  // Výřez s průhledným pozadím: bílá patří ke kusu (bílé tričko). Bez průhlednosti je bílá nejspíš pozadí fotky.
  const hasAlpha = transparent > 0.02 * info.width * info.height;
  for (let i = 0; i < info.width * info.height; i++) {
    const p = i * 4;
    if (data[p + 3] < 200) continue;
    if (!hasAlpha && data[p] > 235 && data[p + 1] > 235 && data[p + 2] > 235) continue;
    px.push([data[p], data[p + 1], data[p + 2]]);
  }
  if (px.length < 50) return null;
  let centers = Array.from({ length: k }, (_, j) => px[Math.floor(((j + 0.5) / k) * px.length)]);
  for (let iter = 0; iter < 10; iter++) {
    const sum = centers.map(() => [0, 0, 0, 0]);
    for (const c of px) {
      let best = 0;
      let bd = Infinity;
      centers.forEach((m, j) => {
        const d = (c[0] - m[0]) ** 2 + (c[1] - m[1]) ** 2 + (c[2] - m[2]) ** 2;
        if (d < bd) (bd = d), (best = j);
      });
      const s = sum[best];
      s[0] += c[0];
      s[1] += c[1];
      s[2] += c[2];
      s[3]++;
    }
    centers = sum.map((s, j) => (s[3] ? [s[0] / s[3], s[1] / s[3], s[2] / s[3]] : centers[j]));
  }
  return centers;
}

/** Oblast, kde smí být kus oblečení, podle kategorie. Hlava je vždy vyloučená. */
export function zoneRegion(seg, { category, bottomLength = 'long', reach = null }) {
  const { W: w, H: h, masks } = seg;
  const union = (labels) => {
    const m = new Uint8Array(w * h);
    for (const l of labels) {
      const part = masks.get(l);
      if (part) for (let i = 0; i < m.length; i++) m[i] |= part[i];
    }
    return m;
  };
  const rows = (m, from, to) => {
    const out = new Uint8Array(w * h);
    for (let y = Math.max(0, from); y < Math.min(h, to); y++) for (let x = 0; x < w; x++) out[y * w + x] = m[y * w + x];
    return out;
  };
  const box = (m) => {
    let minY = h, maxY = -1;
    for (let i = 0; i < m.length; i++) {
      if (!m[i]) continue;
      const y = Math.floor(i / w);
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    return { minY, maxY };
  };

  const torso = union(['Upper-clothes', 'Dress']);
  const arms = union(['Left-arm', 'Right-arm']);
  const hips = union(['Pants', 'Skirt']);
  const legs = union(['Left-leg', 'Right-leg', 'Left-shoe', 'Right-shoe']);
  const legBox = box(legs);
  const torsoBox = box(torso);
  const hipsTop = box(hips).minY;
  // Pas = medián horního okraje šortek po sloupcích (min. by chytil výběžek, kde SegFormer zabere kus tílka).
  const tops = [];
  for (let x = 0; x < w; x++) for (let y = 0; y < h; y++) if (hips[y * w + x]) { tops.push(y); break; }
  tops.sort((a, b) => a - b);
  const waist = tops.length ? tops[Math.floor(tops.length / 2)] : hipsTop;
  // Úrovně na nohou (od rozkroku po chodidla) – kam kus podle analýzy sahá.
  const L = legBox.maxY - legBox.minY;
  const level = {
    hip: hipsTop + 90,
    thigh: legBox.minY + Math.round(L * 0.25),
    knee: legBox.minY + Math.round(L * 0.47),
    calf: legBox.minY + Math.round(L * 0.7),
    ankle: legBox.maxY - 20,
  };
  const neckTop = torsoBox.minY - 28;
  let region;
  let keepHead = false;
  switch (category) {
    case 'top': {
      // vršek: trup + ruce (rukávy) + horní okraj šortek; delší topy (tunika) podle reach
      const bottom = LONG.has(reach) ? Math.max(level.hip, level[reach] + 30) : hipsTop + 90;
      region = rows(dilate(or(torso, arms, rows(or(hips, legs), 0, bottom)), w, h, 28), 0, bottom);
      break;
    }
    case 'outerwear': {
      // svrchní: volnější; bunda přes boky, kabát podle reach až ke kolenům / kotníkům
      const bottom = LONG.has(reach) ? Math.max(torsoBox.maxY + 220, level[reach] + 40) : torsoBox.maxY + 220;
      region = rows(dilate(or(torso, arms, hips, rows(legs, 0, bottom)), w, h, 48), 0, bottom);
      break;
    }
    case 'bottom': {
      // spodek: šortky + nohy; krátké nad kolena, dlouhé až po kotníky (lem přes nárt), jinak podle reach
      const short = bottomLength === 'short' || reach === 'thigh' || reach === 'hip';
      const end = short ? (reach === 'knee' ? level.knee + 20 : level.knee) : reach === 'knee' || reach === 'calf' ? level[reach] + 20 : legBox.maxY - 20;
      // nahoře rovně v úrovni pasu (kalhoty nesmí lézt na tílko)
      region = rows(dilate(or(hips, rows(legs, 0, end)), w, h, 26), waist - 4, end + 26);
      break;
    }
    case 'shoes': {
      // boty: chodidla a kotníky; kozačky výš podle reach
      const top = reach === 'knee' ? level.knee : reach === 'calf' ? level.calf : legBox.maxY - 120;
      region = dilate(rows(legs, top, h), w, h, 22);
      break;
    }
    default: {
      // doplňky podle místa nošení
      if (reach === 'head') {
        const hd = headRegion(seg);
        region = rows(dilate(hd, w, h, 30), 0, neckTop + 10);
        keepHead = true;
      } else if (reach === 'neck') {
        region = rows(dilate(or(torso, arms), w, h, 30), neckTop - 20, torsoBox.minY + 140);
        keepHead = true;
      } else if (reach === 'waist') {
        region = rows(dilate(or(torso, hips), w, h, 20), waist - 50, waist + 60);
      } else {
        region = dilate(or(torso, arms, hips, legs), w, h, 30);
      }
    }
  }
  if (keepHead) {
    // čepice, brýle, šála: hlava se smí kreslit, jen obličej zůstane (brýle/šála jen přes něj)
    return region;
  }
  // Krk zůstává povolený pro vršky a bundy (límec, kapuce u krku); zakázaná je jen hlava nad ním.
  const head = headRegion(seg);
  if (category === 'top' || category === 'outerwear') {
    for (let i = 0; i < head.length; i++) if (Math.floor(i / w) >= neckTop) head[i] = 0;
  }
  return subtract(region, head);
}

/** Port ověřeného výřezu z src/app/ai/garment-extract.ts (stejné parametry). */
export async function garmentLayer(dressed, base, region = null, opts = {}) {
  const thr = opts.threshold ?? 45;
  const bgThr = opts.backgroundThreshold ?? 14;
  const r = opts.radius ?? 3;
  const minComp = opts.minComponent ?? 3000;
  const d = await sharp(dressed).resize(W, H).removeAlpha().raw().toBuffer();
  const b = await sharp(base).resize(W, H).removeAlpha().raw().toBuffer();

  const keepMask = opts.keep ?? null;
  const underwear = opts.underwear ?? null;
  const skin = opts.skin ?? null;
  const palette = opts.palette ?? null;
  const skinTone = opts.skinTone ?? null;
  const trusted = opts.trusted ?? null;
  const allowSkin = opts.allowSkin ?? null;
  let m = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) {
    if (region && !region[i]) continue;
    if (keepMask && !keepMask[i]) continue;
    const p = i * 3;
    const baseIsBg = dist(b, p, BACKGROUND) < 14;
    // Světlý „duch“ pozadí na okraji kusu – jen tam, kde bylo i na holém avatarovi pozadí
    // (na těle by to byl světle šedý nebo bílý kus).
    const ghost = baseIsBg && dist(d, p, BACKGROUND) < 40;
    // Spolehlivý štítek kusu: bere se celý (béžová bota / kalhoty mají skoro barvu pleti).
    if (trusted && trusted[i]) {
      if (!ghost) m[i] = 1;
      continue;
    }
    const diff = dist(d, p, b.subarray(p, p + 3));
    if (diff <= (baseIsBg ? bgThr : thr)) continue;
    if (ghost) continue;
    const okSkin = allowSkin && allowSkin[i];
    // Kůže (ruce, nohy, krk), kterou AI jen jemně přestínovala.
    if (!okSkin && skin && skin[i] && diff < 90) continue;
    // Světlejší než pozadí a bez barvy na místě pozadí = stín/odlesk pod chodidly, ne kus.
    const satD = Math.max(d[p], d[p + 1], d[p + 2]) - Math.min(d[p], d[p + 1], d[p + 2]);
    if (baseIsBg && satD < 16 && d[p] > BACKGROUND[0] - 6 && d[p + 1] > BACKGROUND[1] - 6 && d[p + 2] > BACKGROUND[2] - 6 && !nearPalette(palette, d, p, 60)) continue;
    // Kůže (chodidla u kalhot a bot), pokud nemá barvu kusu.
    if (skinTone && dist(d, p, skinTone) < 110 && !nearPalette(palette, d, p, 60)) continue;
    // Šedé tílko / šortky, které AI jen překreslila (pod rozepnutou bundou apod.), do vrstvy nepatří:
    // v jejich oblasti zůstane jen to, co má barvu kusu z fotky.
    if (underwear && underwear[i]) {
      const sat = Math.max(d[p], d[p + 1], d[p + 2]) - Math.min(d[p], d[p + 1], d[p + 2]);
      const lumD = (d[p] + d[p + 1] + d[p + 2]) / 3;
      const lumB = (b[p] + b[p + 1] + b[p + 2]) / 3;
      // šedý kus (šedé tričko přes šedé tílko) se podle palety pozná a zůstane
      if (sat < 14 && Math.abs(lumD - lumB) < 32 && !nearPalette(palette, d, p, 30)) continue;
      if (palette && sat < 22) {
        let near = Infinity;
        for (const c of palette) near = Math.min(near, Math.abs(d[p] - c[0]) + Math.abs(d[p + 1] - c[1]) + Math.abs(d[p + 2] - c[2]));
        if (near > 75) continue;
      }
    }
    m[i] = 1;
  }
  // V oblasti tílka/šortek rozhodnutí vyhladíme (většina v okolí 9×9), aby nevznikaly pruhy.
  if (underwear) {
    const avg = await sharp(Buffer.from(m.map((v) => v * 255)), { raw: { width: W, height: H, channels: 1 } })
      .blur(3)
      .extractChannel(0)
      .raw()
      .toBuffer();
    for (let i = 0; i < W * H; i++) if (underwear[i] && (!region || region[i])) m[i] = avg[i] > 140 ? 1 : 0;
  }
  m = morph(morph(m, true, r), false, r);
  const keep = largeComponents(m, minComp);
  const outside = floodOutside(keep);

  // Hladký obrys: maska se jemně rozmaže (bez schodů po morfologii a štítcích) a na okraji proti pozadí
  // se průhlednost dopočítá z barvy (jak moc se pixel liší od pozadí) a barva se očistí o světlý lem.
  const inside = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) inside[i] = outside[i] ? 0 : 255;
  const soft = await sharp(Buffer.from(inside), { raw: { width: W, height: H, channels: 1 } }).blur(0.9).extractChannel(0).raw().toBuffer();
  const band = morphWH(
    inside.map((v) => (v ? 1 : 0)),
    W,
    H,
    false,
    2,
  ).map((v, i) => (v && !morphWH1(inside, i) ? 1 : 0));
  const rgba = Buffer.alloc(W * H * 4);
  for (let i = 0; i < W * H; i++) {
    let a = soft[i] / 255;
    if (a < 0.04) continue;
    const p = i * 3;
    let r = d[p], g = d[p + 1], bl = d[p + 2];
    if (band[i] && dist(b, p, BACKGROUND) < 14) {
      // okrajový pixel na místě pozadí: průhlednost podle odlišnosti od pozadí, barva bez příměsi pozadí
      const k = Math.min(1, Math.max(0, (dist(d, p, BACKGROUND) - 6) / 45));
      a = Math.min(a, k);
      if (a < 0.04) continue;
      r = unmix(r, BACKGROUND[0], a);
      g = unmix(g, BACKGROUND[1], a);
      bl = unmix(bl, BACKGROUND[2], a);
    }
    rgba[i * 4] = r;
    rgba[i * 4 + 1] = g;
    rgba[i * 4 + 2] = bl;
    rgba[i * 4 + 3] = Math.round(a * 255);
  }
  return sharp(rgba, { raw: { width: W, height: H, channels: 4 } }).png().toBuffer();
}

/** Pixel je hluboko uvnitř masky (všech 8 sousedů ve vzdálenosti 2 je uvnitř) – mimo okrajový pás. */
function morphWH1(inside, i) {
  const x = i % W;
  const y = (i - x) / W;
  for (const [dx, dy] of [[-2, 0], [2, 0], [0, -2], [0, 2], [-2, -2], [2, 2], [-2, 2], [2, -2]]) {
    const xx = x + dx;
    const yy = y + dy;
    if (xx < 0 || yy < 0 || xx >= W || yy >= H || !inside[yy * W + xx]) return false;
  }
  return true;
}

/** Barva pixelu bez příměsi pozadí (pixel = a·barva + (1−a)·pozadí). */
function unmix(v, bg, a) {
  return Math.max(0, Math.min(255, Math.round((v - (1 - a) * bg) / Math.max(a, 0.05))));
}

function dist(d, p, c) {
  return Math.abs(d[p] - c[0]) + Math.abs(d[p + 1] - c[1]) + Math.abs(d[p + 2] - c[2]);
}

function nearPalette(palette, d, p, max) {
  if (!palette) return false;
  for (const c of palette) if (dist(d, p, c) <= max) return true;
  return false;
}

/** Průměrná barva obrázku v masce (např. pleť těla). */
async function meanColor(img, mask) {
  const b = await sharp(img).resize(W, H).removeAlpha().raw().toBuffer();
  const s = [0, 0, 0];
  let n = 0;
  for (let i = 0; i < W * H; i++) {
    if (!mask[i]) continue;
    s[0] += b[i * 3];
    s[1] += b[i * 3 + 1];
    s[2] += b[i * 3 + 2];
    n++;
  }
  return n ? s.map((v) => v / n) : null;
}

function or(...masks) {
  const out = new Uint8Array(masks[0].length);
  for (const m of masks) for (let i = 0; i < m.length; i++) out[i] |= m[i];
  return out;
}

function dilate(m, w, h, r) {
  return morphWH(m, w, h, false, r);
}

function morph(src, erode, r) {
  return morphWH(src, W, H, erode, r);
}

/** Separabilní eroze / dilatace se čtvercovým jádrem. */
function morphWH(src, w, h, erode, r) {
  const tmp = new Uint8Array(w * h);
  const out = new Uint8Array(w * h);
  const pass = (from, to, horizontal) => {
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let v = erode ? 1 : 0;
        for (let k = -r; k <= r; k++) {
          const xx = horizontal ? x + k : x;
          const yy = horizontal ? y : y + k;
          const s = xx < 0 || xx >= w || yy < 0 || yy >= h ? 0 : from[yy * w + xx];
          if (erode && !s) {
            v = 0;
            break;
          }
          if (!erode && s) {
            v = 1;
            break;
          }
        }
        to[y * w + x] = v;
      }
    }
  };
  pass(src, tmp, true);
  pass(tmp, out, false);
  return out;
}

function largeComponents(m, min) {
  const seen = new Uint8Array(W * H);
  const keep = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) {
    if (!m[i] || seen[i]) continue;
    const comp = [];
    const stack = [i];
    seen[i] = 1;
    while (stack.length) {
      const c = stack.pop();
      comp.push(c);
      const x = c % W;
      for (const n of [x > 0 ? c - 1 : -1, x < W - 1 ? c + 1 : -1, c - W, c + W]) {
        if (n < 0 || n >= W * H || seen[n] || !m[n]) continue;
        seen[n] = 1;
        stack.push(n);
      }
    }
    if (comp.length > min) for (const c of comp) keep[c] = 1;
  }
  return keep;
}

/** Vše spojené s okrajem přes nevybrané pixely (díry uvnitř kusu se vyplní). */
function floodOutside(keep) {
  const out = new Uint8Array(W * H);
  const stack = [];
  for (let x = 0; x < W; x++) stack.push(x, (H - 1) * W + x);
  for (let y = 0; y < H; y++) stack.push(y * W, y * W + W - 1);
  while (stack.length) {
    const c = stack.pop();
    if (out[c] || keep[c]) continue;
    out[c] = 1;
    const x = c % W;
    if (x > 0) stack.push(c - 1);
    if (x < W - 1) stack.push(c + 1);
    if (c >= W) stack.push(c - W);
    if (c < W * (H - 1)) stack.push(c + W);
  }
  return out;
}
