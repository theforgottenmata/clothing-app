import { canvasToBlob } from '../core/image-utils';

/**
 * Odstraní jednolité světlé pozadí (bílé / světle šedé) flood-fillem od okrajů.
 * Není to AI – jen jednoduchý výřez fotky pořízené na světlém pozadí.
 */
export async function removeUniformBackground(blob: Blob, tolerance = 38, maxSide = 1200): Promise<Blob> {
  const bmp = await createImageBitmap(blob);
  const ratio = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
  const W = Math.round(bmp.width * ratio);
  const H = Math.round(bmp.height * ratio);
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(bmp, 0, 0, W, H);
  bmp.close();
  const img = ctx.getImageData(0, 0, W, H);
  const d = img.data;

  // Barva pozadí = průměr rohových pixelů.
  const corners = [0, W - 1, (H - 1) * W, H * W - 1];
  const bg = [0, 1, 2].map((c) => corners.reduce((s, i) => s + d[i * 4 + c], 0) / corners.length);
  const bgLum = (bg[0] + bg[1] + bg[2]) / 3;
  if (bgLum < 170) return canvasToBlob(canvas); // tmavé pozadí – nic neodstraňujeme

  const near = (i: number) =>
    Math.abs(d[i * 4] - bg[0]) + Math.abs(d[i * 4 + 1] - bg[1]) + Math.abs(d[i * 4 + 2] - bg[2]) < tolerance;

  const visited = new Uint8Array(W * H);
  const stack: number[] = [];
  for (let x = 0; x < W; x++) stack.push(x, (H - 1) * W + x);
  for (let y = 0; y < H; y++) stack.push(y * W, y * W + W - 1);
  while (stack.length) {
    const i = stack.pop()!;
    if (visited[i] || !near(i)) continue;
    visited[i] = 1;
    const x = i % W;
    if (x > 0) stack.push(i - 1);
    if (x < W - 1) stack.push(i + 1);
    if (i >= W) stack.push(i - W);
    if (i < W * (H - 1)) stack.push(i + W);
  }

  // Měkký okraj: pixely sousedící s pozadím dostanou poloviční průhlednost.
  for (let i = 0; i < W * H; i++) {
    if (visited[i]) {
      d[i * 4 + 3] = 0;
      continue;
    }
    const x = i % W;
    const edge =
      (x > 0 && visited[i - 1]) || (x < W - 1 && visited[i + 1]) || (i >= W && visited[i - W]) || (i < W * (H - 1) && visited[i + W]);
    if (edge) d[i * 4 + 3] = 140;
  }
  ctx.putImageData(img, 0, 0);
  return trimTransparent(canvas);
}

/** Ořízne průhledné okraje. */
async function trimTransparent(canvas: HTMLCanvasElement): Promise<Blob> {
  const ctx = canvas.getContext('2d')!;
  const { width: W, height: H } = canvas;
  const d = ctx.getImageData(0, 0, W, H).data;
  let minX = W, minY = H, maxX = -1, maxY = -1;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (d[(y * W + x) * 4 + 3] > 10) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return canvasToBlob(canvas);
  const pad = 8;
  minX = Math.max(0, minX - pad);
  minY = Math.max(0, minY - pad);
  maxX = Math.min(W - 1, maxX + pad);
  maxY = Math.min(H - 1, maxY + pad);
  const out = document.createElement('canvas');
  out.width = maxX - minX + 1;
  out.height = maxY - minY + 1;
  out.getContext('2d')!.drawImage(canvas, minX, minY, out.width, out.height, 0, 0, out.width, out.height);
  return canvasToBlob(out);
}
