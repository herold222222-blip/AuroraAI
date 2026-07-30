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

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('素材加载失败'));
    img.src = src;
  });
}

/** Measure intrinsic size of a sticker asset. */
export async function measureSticker(
  src: string,
): Promise<{ w: number; h: number }> {
  const img = await loadImage(src);
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
  const base = await loadImage(baseUrl);
  const canvas = document.createElement('canvas');
  canvas.width = base.naturalWidth;
  canvas.height = base.naturalHeight;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(base, 0, 0);
  for (const o of overlays) {
    const stamp = await loadImage(o.url);
    ctx.drawImage(stamp, o.x - o.w / 2, o.y - o.h / 2, o.w, o.h);
  }
  return canvas.toDataURL('image/png');
}
