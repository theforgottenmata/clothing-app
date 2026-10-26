/**
 * Oblečení na avatara (druhá fáze):
 *   1. maska zóny těla podle kategorie (SegFormer na těle avatara) – AI smí kreslit jen tam,
 *   2. úprava obrázku: tělo avatara + výřez kusu z fotky → „oblečený avatar“ ve stejném cartoon stylu,
 *   3. vrstva na postavu = rozdíl oblečeného a holého těla (ověřené parametry: práh 45, 14 na pozadí,
 *      morfologické otevření r=3, souvislé oblasti > 3000 px, vyplnění děr).
 */
import sharp from 'sharp';
import { H, W, edit, headRegion, mergeInside, subtract, toOpenAiMask } from './avatar.mjs';
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
  const layer = await garmentLayer(dressed, body, region);
  return { dressed, layer, region, usd: out.usd };
}

/** Oblast, kde smí být kus oblečení, podle kategorie. Hlava je vždy vyloučená. */
export function zoneRegion(seg, { category, bottomLength = 'long' }) {
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
  let region;
  switch (category) {
    case 'top':
      // vršek: trup + ruce (rukávy) + horní okraj šortek; nikdy níž než kousek pod pas
      region = rows(dilate(or(torso, arms, rows(hips, 0, hipsTop + 40)), w, h, 28), 0, hipsTop + 90);
      break;
    case 'outerwear':
      // svrchní: jako vršek, ale volnější a delší (bunda může jít přes boky, kabát do půlky stehen)
      region = rows(dilate(or(torso, arms, hips), w, h, 48), 0, torsoBox.maxY + 220);
      break;
    case 'bottom': {
      // spodek: šortky + nohy; dlouhé až po kotníky (lem přes nárt), krátké nad kolena
      const knee = legBox.minY + Math.round((legBox.maxY - legBox.minY) * 0.45);
      const legPart = bottomLength === 'short' ? rows(legs, 0, knee) : rows(legs, 0, legBox.maxY - 20);
      region = dilate(or(hips, legPart), w, h, 26);
      break;
    }
    case 'shoes':
      // boty: chodidla a kotníky
      region = dilate(rows(legs, legBox.maxY - 120, h), w, h, 22);
      break;
    default:
      region = dilate(or(torso, arms, hips, legs), w, h, 30);
  }
  return subtract(region, headRegion(seg));
}

/** Port ověřeného výřezu z src/app/ai/garment-extract.ts (stejné parametry). */
export async function garmentLayer(dressed, base, region = null, opts = {}) {
  const thr = opts.threshold ?? 45;
  const bgThr = opts.backgroundThreshold ?? 14;
  const r = opts.radius ?? 3;
  const minComp = opts.minComponent ?? 3000;
  const d = await sharp(dressed).resize(W, H).removeAlpha().raw().toBuffer();
  const b = await sharp(base).resize(W, H).removeAlpha().raw().toBuffer();

  let m = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) {
    if (region && !region[i]) continue;
    const p = i * 3;
    const diff = Math.abs(d[p] - b[p]) + Math.abs(d[p + 1] - b[p + 1]) + Math.abs(d[p + 2] - b[p + 2]);
    const baseIsBg =
      Math.abs(b[p] - BACKGROUND[0]) + Math.abs(b[p + 1] - BACKGROUND[1]) + Math.abs(b[p + 2] - BACKGROUND[2]) < 14;
    m[i] = diff > (baseIsBg ? bgThr : thr) ? 1 : 0;
  }
  m = morph(morph(m, true, r), false, r);
  const keep = largeComponents(m, minComp);
  const outside = floodOutside(keep);

  const rgba = Buffer.alloc(W * H * 4);
  for (let i = 0; i < W * H; i++) {
    if (outside[i]) continue;
    rgba[i * 4] = d[i * 3];
    rgba[i * 4 + 1] = d[i * 3 + 1];
    rgba[i * 4 + 2] = d[i * 3 + 2];
    rgba[i * 4 + 3] = 255;
  }
  return sharp(rgba, { raw: { width: W, height: H, channels: 4 } }).png().toBuffer();
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
