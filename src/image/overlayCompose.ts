import { loadImageEl } from './loadImage';

export interface ImageOverlay {
  id: string;
  url: string;
  label: string;
  /** Center X in natural image pixels */
  x: number;
  /** Center Y in natural image pixels */
  y: number;
  /** Display width in natural image pixels */
  w: number;
  /** Display height in natural image pixels */
  h: number;
}

/** Measure intrinsic size of a sticker asset. */
export async function measureSticker(
  src: string,
): Promise<{ w: number; h: number }> {
  const img = await loadImageEl(src);
  return {
    w: Math.max(1, img.naturalWidth || img.width),
    h: Math.max(1, img.naturalHeight || img.height),
  };
}

/** Flatten base image + transparent overlays into one PNG data URL. */
export async function flattenOverlaysOntoImage(
  baseUrl: string,
  overlays: ImageOverlay[],
): Promise<string> {
  const base = await loadImageEl(baseUrl);
  const canvas = document.createElement('canvas');
  canvas.width = base.naturalWidth;
  canvas.height = base.naturalHeight;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(base, 0, 0);
  for (const o of overlays) {
    const stamp = await loadImageEl(o.url);
    ctx.drawImage(stamp, o.x - o.w / 2, o.y - o.h / 2, o.w, o.h);
  }
  return canvas.toDataURL('image/png');
}
