/**
 * Bake Gemini-style numbered red sketch marks onto a photo.
 * The model must see the ink on the image (not a separate soft ROI mask).
 */

export interface SketchMarkBakeInput {
  n: number;
  x: number;
  y: number;
  strokeMaskDataUrl?: string;
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('图片加载失败'));
    img.src = url;
  });
}

function drawNumberBadge(
  ctx: CanvasRenderingContext2D,
  n: number,
  x: number,
  y: number,
  minDim: number,
) {
  const r = Math.max(10, Math.round(minDim * 0.018));
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(239, 68, 68, 0.95)';
  ctx.fill();
  ctx.lineWidth = Math.max(2, r * 0.18);
  ctx.strokeStyle = '#ffffff';
  ctx.stroke();

  ctx.fillStyle = '#ffffff';
  ctx.font = `bold ${Math.max(11, Math.round(r * 1.15))}px system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(String(n), x, y + 0.5);
}

async function drawStrokeTint(
  ctx: CanvasRenderingContext2D,
  strokeMaskDataUrl: string,
  canvasW: number,
  canvasH: number,
) {
  const maskImg = await loadImage(strokeMaskDataUrl);
  const tmp = document.createElement('canvas');
  tmp.width = maskImg.naturalWidth;
  tmp.height = maskImg.naturalHeight;
  const tctx = tmp.getContext('2d', { willReadFrequently: true })!;
  tctx.drawImage(maskImg, 0, 0);
  const data = tctx.getImageData(0, 0, tmp.width, tmp.height);
  const d = data.data;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i] < 128) {
      d[i + 3] = 0;
      continue;
    }
    d[i] = 239;
    d[i + 1] = 68;
    d[i + 2] = 68;
    d[i + 3] = 230;
  }
  tctx.putImageData(data, 0, 0);
  ctx.drawImage(tmp, 0, 0, canvasW, canvasH);
}

/** Draw red strokes + number badges onto a copy of the photo (Gemini markup). */
export async function bakeSketchMarksOntoImage(
  imageUrl: string,
  marks: SketchMarkBakeInput[],
): Promise<string> {
  if (!marks.length) return imageUrl;
  const img = await loadImage(imageUrl);
  const w = img.naturalWidth;
  const h = img.naturalHeight;
  if (!w || !h) throw new Error('图片尺寸无效');

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(img, 0, 0, w, h);

  const minDim = Math.min(w, h);
  for (const m of marks) {
    if (m.strokeMaskDataUrl) {
      await drawStrokeTint(ctx, m.strokeMaskDataUrl, w, h);
    } else {
      // Legacy click mark: small red ring so the model still sees ink.
      const ringR = Math.max(14, Math.round(minDim * 0.03));
      ctx.beginPath();
      ctx.arc(m.x, m.y, ringR, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(239, 68, 68, 0.95)';
      ctx.lineWidth = Math.max(3, Math.round(minDim * 0.006));
      ctx.stroke();
    }
    drawNumberBadge(ctx, m.n, m.x, m.y, minDim);
  }

  return canvas.toDataURL('image/png');
}
