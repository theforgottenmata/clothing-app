import { AVATAR_H, AVATAR_W } from '../core/body-map';
import { canvasToBlob } from '../core/image-utils';

export interface ExtractOptions {
  /** Barva pozadí podkladového obrázku (RGB). */
  background?: [number, number, number];
  /** Práh rozdílu RGB (součet) pro pixely těla/oblečení. */
  threshold?: number;
  /** Nižší práh tam, kde byl v podkladu jen background (světlé kusy oblečení). */
  backgroundThreshold?: number;
  /** Poloměr morfologického otevření (odstraní šum na okrajích). */
  radius?: number;
  /** Minimální velikost souvislé oblasti v px. */
  minComponent?: number;
}

/**
 * Vyřízne oblečení porovnáním „oblečeného avatara“ s podkladem (holý avatar,
 * nebo avatar ve standardních botách u dlouhých spodků). Výsledek je průhledná
 * vrstva 688×1024, která sedí na avatara na pozici 0,0.
 *
 * Parametry odpovídají ověřenému nastavení z návrhu (docs/rozhodnuti.md).
 */
export async function extractGarmentLayer(
  dressed: CanvasImageSource,
  base: CanvasImageSource,
  opts: ExtractOptions = {},
): Promise<Blob> {
  const W = AVATAR_W;
  const H = AVATAR_H;
  const bgc = opts.background ?? [227, 227, 231];
  const thr = opts.threshold ?? 45;
  const bgThr = opts.backgroundThreshold ?? 14;
  const r = opts.radius ?? 3;
  const minComp = opts.minComponent ?? 3000;

  const read = (src: CanvasImageSource) => {
    const c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    const ctx = c.getContext('2d', { willReadFrequently: true })!;
    ctx.drawImage(src, 0, 0, W, H);
    return ctx.getImageData(0, 0, W, H);
  };
  const d = read(dressed);
  const b = read(base);

  let m: Uint8Array = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) {
    const p = i * 4;
    const diff = Math.abs(d.data[p] - b.data[p]) + Math.abs(d.data[p + 1] - b.data[p + 1]) + Math.abs(d.data[p + 2] - b.data[p + 2]);
    const baseIsBg =
      Math.abs(b.data[p] - bgc[0]) + Math.abs(b.data[p + 1] - bgc[1]) + Math.abs(b.data[p + 2] - bgc[2]) < 14;
    m[i] = diff > (baseIsBg ? bgThr : thr) ? 1 : 0;
  }

  m = morph(morph(m, W, H, true, r), W, H, false, r);
  const keep = largeComponents(m, W, H, minComp);
  const outside = floodOutside(keep, W, H);

  const out = new ImageData(W, H);
  for (let i = 0; i < W * H; i++) {
    if (outside[i]) continue;
    const p = i * 4;
    out.data[p] = d.data[p];
    out.data[p + 1] = d.data[p + 1];
    out.data[p + 2] = d.data[p + 2];
    out.data[p + 3] = 255;
  }
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  canvas.getContext('2d')!.putImageData(out, 0, 0);
  return canvasToBlob(canvas);
}

/** Separabilní eroze (erode=true) / dilatace se čtvercovým jádrem. */
function morph(src: Uint8Array, W: number, H: number, erode: boolean, r: number): Uint8Array {
  const tmp = new Uint8Array(W * H);
  const out = new Uint8Array(W * H);
  const pass = (from: Uint8Array, to: Uint8Array, horizontal: boolean) => {
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        let v = erode ? 1 : 0;
        for (let k = -r; k <= r; k++) {
          const xx = horizontal ? x + k : x;
          const yy = horizontal ? y : y + k;
          const s = xx < 0 || xx >= W || yy < 0 || yy >= H ? 0 : from[yy * W + xx];
          if (erode && !s) { v = 0; break; }
          if (!erode && s) { v = 1; break; }
        }
        to[y * W + x] = v;
      }
    }
  };
  pass(src, tmp, true);
  pass(tmp, out, false);
  return out;
}

function largeComponents(m: Uint8Array, W: number, H: number, min: number): Uint8Array {
  const seen = new Uint8Array(W * H);
  const keep = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) {
    if (!m[i] || seen[i]) continue;
    const comp: number[] = [];
    const stack = [i];
    seen[i] = 1;
    while (stack.length) {
      const c = stack.pop()!;
      comp.push(c);
      const x = c % W;
      const ns = [x > 0 ? c - 1 : -1, x < W - 1 ? c + 1 : -1, c - W, c + W];
      for (const n of ns) {
        if (n < 0 || n >= W * H || seen[n] || !m[n]) continue;
        seen[n] = 1;
        stack.push(n);
      }
    }
    if (comp.length > min) for (const c of comp) keep[c] = 1;
  }
  return keep;
}

/** Vše, co je spojené s okrajem obrázku přes nevybrané pixely (= díry uvnitř se vyplní). */
function floodOutside(keep: Uint8Array, W: number, H: number): Uint8Array {
  const out = new Uint8Array(W * H);
  const stack: number[] = [];
  for (let x = 0; x < W; x++) stack.push(x, (H - 1) * W + x);
  for (let y = 0; y < H; y++) stack.push(y * W, y * W + W - 1);
  while (stack.length) {
    const c = stack.pop()!;
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
