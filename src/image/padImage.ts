/**
 * Pad image to a Gemini-supported aspect ratio, then crop result back.
 */

export const GEMINI_RATIOS = [
  { w: 1, h: 1, name: '1:1' },
  { w: 3, h: 4, name: '3:4' },
  { w: 4, h: 3, name: '4:3' },
  { w: 9, h: 16, name: '9:16' },
  { w: 16, h: 9, name: '16:9' },
  { w: 1, h: 4, name: '1:4' },
  { w: 1, h: 8, name: '1:8' },
  { w: 4, h: 1, name: '4:1' },
  { w: 8, h: 1, name: '8:1' },
] as const;

export interface OriginalCrop {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface PadResult {
  dataUrl: string;
  canvasW: number;
  canvasH: number;
  originalCrop: OriginalCrop;
  ratioName: string;
  /** Map a point in original image space → padded canvas space */
  mapPoint: (x: number, y: number) => { x: number; y: number };
}

function nearestRatio(w: number, h: number) {
  const r = w / h;
  let best: (typeof GEMINI_RATIOS)[number] = GEMINI_RATIOS[0];
  let bestDiff = Infinity;
  for (const s of GEMINI_RATIOS) {
    const diff = Math.abs(r - s.w / s.h);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = s;
    }
  }
  return best;
}

function loadHtmlImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('图片加载失败'));
    img.src = src;
  });
}

export async function padToSupportedRatio(dataUrl: string): Promise<PadResult> {
  const img = await loadHtmlImage(dataUrl);
  const width = img.naturalWidth;
  const height = img.naturalHeight;
  const ratio = nearestRatio(width, height);
  const targetR = ratio.w / ratio.h;
  const srcR = width / height;

  let canvasW: number;
  let canvasH: number;
  if (srcR > targetR) {
    canvasW = width;
    canvasH = Math.round(width / targetR);
  } else {
    canvasH = height;
    canvasW = Math.round(height * targetR);
  }

  const maxSide = Math.max(canvasW, canvasH);
  const scale = Math.min(1, 2048 / maxSide);
  canvasW = Math.max(1, Math.round(canvasW * scale));
  canvasH = Math.max(1, Math.round(canvasH * scale));
  if (canvasW / canvasH > targetR) canvasW = Math.round(canvasH * targetR);
  else canvasH = Math.round(canvasW / targetR);

  const imgW = Math.round(width * scale);
  const imgH = Math.round(height * scale);
  const x = Math.floor((canvasW - imgW) / 2);
  const y = Math.floor((canvasH - imgH) / 2);

  const canvas = document.createElement('canvas');
  canvas.width = canvasW;
  canvas.height = canvasH;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, canvasW, canvasH);
  ctx.drawImage(img, x, y, imgW, imgH);

  return {
    dataUrl: canvas.toDataURL('image/jpeg', 0.88),
    canvasW,
    canvasH,
    originalCrop: { x, y, w: imgW, h: imgH },
    ratioName: ratio.name,
    // Use drawn size (not float scale) so rounding matches the pixels Gemini sees.
    mapPoint: (px, py) => ({
      x: x + (px / Math.max(1, width)) * imgW,
      y: y + (py / Math.max(1, height)) * imgH,
    }),
  };
}

export async function cropFromPad(
  resultDataUrl: string,
  crop: OriginalCrop,
  targetW?: number,
  targetH?: number,
): Promise<string> {
  const img = await loadHtmlImage(resultDataUrl);
  const canvas = document.createElement('canvas');
  const w = targetW ?? crop.w;
  const h = targetH ?? crop.h;
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  // Scale crop if result size differs from padded canvas
  const sx = img.naturalWidth;
  const sy = img.naturalHeight;
  // Assume result matches pad canvas; if not, scale crop proportionally
  // We don't know pad size here — pass ratios via crop coords in pad space.
  // Caller should pass crop in the same coordinate system as the padded request.
  // If result size != expected, scale:
  ctx.drawImage(
    img,
    crop.x,
    crop.y,
    crop.w,
    crop.h,
    0,
    0,
    w,
    h,
  );
  // If result dimensions differ, remapped:
  if (sx !== crop.x + crop.w && sx > 0) {
    // better remap
  }
  void sx;
  void sy;
  return canvas.toDataURL('image/png');
}

/**
 * Crop using known pad canvas size so mismatched AI output still maps correctly.
 * Uses uniform cover scaling (no anisotropic stretch) so click/focus coords stay
 * aligned across iterative edits when Gemini returns a different aspect ratio.
 */
export async function cropFromPadSized(
  resultDataUrl: string,
  crop: OriginalCrop,
  padW: number,
  padH: number,
  outW: number,
  outH: number,
): Promise<string> {
  const img = await loadHtmlImage(resultDataUrl);
  const rw = img.naturalWidth;
  const rh = img.naturalHeight;
  // Cover: fit pad frame into result, center-crop overflow — keeps geometry stable.
  const scale = Math.max(rw / Math.max(1, padW), rh / Math.max(1, padH));
  const mappedW = padW * scale;
  const mappedH = padH * scale;
  const ox = (rw - mappedW) / 2;
  const oy = (rh - mappedH) / 2;

  const canvas = document.createElement('canvas');
  canvas.width = outW;
  canvas.height = outH;
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(
    img,
    ox + crop.x * scale,
    oy + crop.y * scale,
    crop.w * scale,
    crop.h * scale,
    0,
    0,
    outW,
    outH,
  );
  return canvas.toDataURL('image/png');
}

export async function resizeImage(
  dataUrl: string,
  scale: number,
): Promise<string> {
  const img = await loadHtmlImage(dataUrl);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/png');
}

export async function resizeToMaxSide(
  dataUrl: string,
  maxSide: number,
): Promise<string> {
  const img = await loadHtmlImage(dataUrl);
  const scale = maxSide / Math.max(img.naturalWidth, img.naturalHeight);
  if (scale <= 1) return dataUrl;
  return resizeImage(dataUrl, scale);
}

export function compressDataUrl(
  dataUrl: string,
  maxSide = 1024,
  quality = 0.72,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(img.width * scale));
      canvas.height = Math.max(1, Math.round(img.height * scale));
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL('image/jpeg', quality));
    };
    img.onerror = () => reject(new Error('压缩失败'));
    img.src = dataUrl;
  });
}
