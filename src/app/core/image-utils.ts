export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Obrázek se nepodařilo načíst: ${src}`));
    img.src = src;
  });
}

export async function blobSize(blob: Blob): Promise<{ w: number; h: number }> {
  const bmp = await createImageBitmap(blob);
  const size = { w: bmp.width, h: bmp.height };
  bmp.close();
  return size;
}

export function canvasToBlob(canvas: HTMLCanvasElement | OffscreenCanvas): Promise<Blob> {
  if ('convertToBlob' in canvas) return canvas.convertToBlob({ type: 'image/png' });
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Export obrázku selhal'))), 'image/png'),
  );
}

/** Zmenší obrázek tak, aby delší strana měla nejvýš maxSide px (šetří IndexedDB i výkon plátna). */
export async function downscale(blob: Blob, maxSide = 1400): Promise<Blob> {
  const bmp = await createImageBitmap(blob);
  const ratio = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
  if (ratio === 1 && blob.type === 'image/png') {
    bmp.close();
    return blob;
  }
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bmp.width * ratio);
  canvas.height = Math.round(bmp.height * ratio);
  canvas.getContext('2d')!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  bmp.close();
  return canvasToBlob(canvas);
}

/**
 * Ořízne průhledné okraje verze na postavu. Vrací oříznutý obrázek a jeho polohu
 * v původním plátně (= souřadnice v prostoru avatara).
 */
export async function trimToContent(blob: Blob): Promise<{ blob: Blob; box: { x: number; y: number; w: number; h: number } }> {
  const bmp = await createImageBitmap(blob);
  const W = bmp.width;
  const H = bmp.height;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(bmp, 0, 0);
  bmp.close();
  const d = ctx.getImageData(0, 0, W, H).data;
  let minX = W, minY = H, maxX = -1, maxY = -1;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (d[(y * W + x) * 4 + 3] > 8) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return { blob, box: { x: 0, y: 0, w: W, h: H } };
  const box = { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
  const out = document.createElement('canvas');
  out.width = box.w;
  out.height = box.h;
  out.getContext('2d')!.drawImage(c, box.x, box.y, box.w, box.h, 0, 0, box.w, box.h);
  return { blob: await canvasToBlob(out), box };
}
