/**
 * Burn a small "Aurora AI" watermark into the bottom-right of an AI result image.
 */

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('水印：图片加载失败'));
    img.src = url;
  });
}

export async function applyAuroraWatermark(imageUrl: string): Promise<string> {
  const img = await loadImage(imageUrl);
  const w = img.naturalWidth;
  const h = img.naturalHeight;
  if (!w || !h) return imageUrl;

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return imageUrl;

  ctx.drawImage(img, 0, 0);

  const minSide = Math.min(w, h);
  const fontSize = Math.max(11, Math.round(minSide * 0.022));
  const pad = Math.max(8, Math.round(minSide * 0.018));
  const text = 'Aurora AI';

  ctx.font = `600 ${fontSize}px "Segoe UI", "PingFang SC", system-ui, sans-serif`;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'bottom';

  const x = w - pad;
  const y = h - pad;

  ctx.lineWidth = Math.max(2, Math.round(fontSize * 0.18));
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.45)';
  ctx.strokeText(text, x, y);
  ctx.fillStyle = 'rgba(255, 255, 255, 0.78)';
  ctx.fillText(text, x, y);

  return canvas.toDataURL('image/png');
}
