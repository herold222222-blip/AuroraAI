/** Local-edit helpers: hotspot ROI + brush mask + strict composite */

export async function loadImageEl(src: string): Promise<HTMLImageElement> {
  const img = new Image();
  await new Promise<void>((res, rej) => {
    img.onload = () => res();
    img.onerror = () => rej(new Error('图片加载失败'));
    img.src = src;
  });
  return img;
}

function colorDist(
  data: Uint8ClampedArray,
  i: number,
  tr: number,
  tg: number,
  tb: number,
) {
  const dr = data[i] - tr;
  const dg = data[i + 1] - tg;
  const db = data[i + 2] - tb;
  return Math.sqrt(dr * dr + dg * dg + db * db);
}

/** Local edge magnitude (approx) for edge-aware fill */
function edgeMag(
  data: Uint8ClampedArray,
  w: number,
  h: number,
  x: number,
  y: number,
) {
  const i = (y * w + x) * 4;
  const l = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
  let maxD = 0;
  for (const [dx, dy] of [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ] as const) {
    const nx = x + dx;
    const ny = y + dy;
    if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
    const j = (ny * w + nx) * 4;
    const ln = 0.299 * data[j] + 0.587 * data[j + 1] + 0.114 * data[j + 2];
    maxD = Math.max(maxD, Math.abs(l - ln));
  }
  return maxD;
}

/**
 * Edge-aware flood fill. Used to expand the hotspot ROI when the clicked
 * material is color-coherent (doors, planters, facade panels, etc.).
 */
function floodFillBinary(
  data: Uint8ClampedArray,
  w: number,
  h: number,
  sx: number,
  sy: number,
  tolerance: number,
  maxPixels: number,
  edgeBarrier = 38,
): Uint8Array {
  const visited = new Uint8Array(w * h);
  const mask = new Uint8Array(w * h);
  const i0 = (sy * w + sx) * 4;
  const tr = data[i0];
  const tg = data[i0 + 1];
  const tb = data[i0 + 2];
  const stack: number[] = [sx, sy];
  visited[sy * w + sx] = 1;
  let count = 0;

  while (stack.length && count < maxPixels) {
    const cy = stack.pop()!;
    const cx = stack.pop()!;
    mask[cy * w + cx] = 1;
    count++;
    const neighbors = [
      [cx - 1, cy],
      [cx + 1, cy],
      [cx, cy - 1],
      [cx, cy + 1],
    ];
    for (const [nx, ny] of neighbors) {
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const idx = ny * w + nx;
      if (visited[idx]) continue;
      visited[idx] = 1;
      if (colorDist(data, idx * 4, tr, tg, tb) > tolerance) continue;
      // Stop crossing strong edges (keeps fill on one object face)
      if (edgeMag(data, w, h, nx, ny) > edgeBarrier) continue;
      stack.push(nx, ny);
    }
  }
  return mask;
}

function dilateBinary(
  mask: Uint8Array,
  w: number,
  h: number,
  radius: number,
): Uint8Array {
  if (radius <= 0) return mask;
  const out = new Uint8Array(mask);
  const r2 = radius * radius;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!mask[y * w + x]) continue;
      for (let dy = -radius; dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          if (dx * dx + dy * dy > r2) continue;
          const qx = x + dx;
          const qy = y + dy;
          if (qx < 0 || qy < 0 || qx >= w || qy >= h) continue;
          out[qy * w + qx] = 1;
        }
      }
    }
  }
  return out;
}

function binaryToDataUrl(mask: Uint8Array, w: number, h: number): string {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(w, h);
  for (let i = 0; i < w * h; i++) {
    const v = mask[i] ? 255 : 0;
    const o = i * 4;
    img.data[o] = v;
    img.data[o + 1] = v;
    img.data[o + 2] = v;
    img.data[o + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return canvas.toDataURL('image/png');
}

function featherAlpha(
  alpha: Float32Array,
  w: number,
  h: number,
  radius: number,
): Float32Array {
  if (radius <= 0) return alpha;
  const tmp = new Float32Array(alpha.length);
  const out = new Float32Array(alpha.length);
  out.set(alpha);
  const passes = 2;
  for (let p = 0; p < passes; p++) {
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let s = 0;
        let c = 0;
        for (let k = -radius; k <= radius; k++) {
          const xx = x + k;
          if (xx < 0 || xx >= w) continue;
          s += out[y * w + xx];
          c++;
        }
        tmp[y * w + x] = s / c;
      }
    }
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let s = 0;
        let c = 0;
        for (let k = -radius; k <= radius; k++) {
          const yy = y + k;
          if (yy < 0 || yy >= h) continue;
          s += tmp[yy * w + x];
          c++;
        }
        out[y * w + x] = s / c;
      }
    }
  }
  for (let i = 0; i < out.length; i++) {
    out[i] = Math.min(1, Math.max(out[i], alpha[i] * 0.92));
  }
  return out;
}

/**
 * Soft alpha ROI for hotspot local composite.
 * Combines a generous soft disc around the click with an edge-aware
 * material flood-fill so whole objects (not just tiny color blobs) are covered.
 */
export async function hotspotRoiAlpha(
  imageUrl: string,
  x: number,
  y: number,
): Promise<{ alpha: Float32Array; w: number; h: number; maskDataUrl: string }> {
  const img = await loadImageEl(imageUrl);
  const w = img.naturalWidth;
  const h = img.naturalHeight;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(img, 0, 0);
  const { data } = ctx.getImageData(0, 0, w, h);

  const sx = Math.max(0, Math.min(w - 1, Math.round(x)));
  const sy = Math.max(0, Math.min(h - 1, Math.round(y)));
  const minDim = Math.min(w, h);
  const coreR = Math.max(24, Math.round(minDim * 0.08));
  const softR = Math.max(coreR + 16, Math.round(minDim * 0.18));
  const maxFill = Math.floor(w * h * 0.28);

  let sum = 0;
  let sum2 = 0;
  let n = 0;
  const sampleR = 4;
  const i0 = (sy * w + sx) * 4;
  const tr = data[i0];
  const tg = data[i0 + 1];
  const tb = data[i0 + 2];
  for (let dy = -sampleR; dy <= sampleR; dy++) {
    for (let dx = -sampleR; dx <= sampleR; dx++) {
      const px = sx + dx;
      const py = sy + dy;
      if (px < 0 || py < 0 || px >= w || py >= h) continue;
      const d = colorDist(data, (py * w + px) * 4, tr, tg, tb);
      sum += d;
      sum2 += d * d;
      n++;
    }
  }
  const mean = n ? sum / n : 20;
  const variance = n ? Math.max(0, sum2 / n - mean * mean) : 100;
  const std = Math.sqrt(variance);
  const tolerance = Math.min(78, Math.max(28, mean + std * 2.2 + 18));

  let fill = floodFillBinary(data, w, h, sx, sy, tolerance, maxFill);
  let fillCount = 0;
  for (let i = 0; i < fill.length; i++) if (fill[i]) fillCount++;

  if (fillCount < Math.PI * coreR * coreR * 0.35) {
    fill = floodFillBinary(
      data,
      w,
      h,
      sx,
      sy,
      Math.min(95, tolerance + 22),
      maxFill,
      52,
    );
  }

  const dilatePx = Math.max(4, Math.round(minDim * 0.012));
  fill = dilateBinary(fill, w, h, dilatePx);

  const alpha = new Float32Array(w * h);
  const softR2 = softR * softR;
  for (let py = 0; py < h; py++) {
    for (let px = 0; px < w; px++) {
      const idx = py * w + px;
      const dx = px - sx;
      const dy = py - sy;
      const d2 = dx * dx + dy * dy;
      let disc = 0;
      if (d2 <= coreR * coreR) disc = 1;
      else if (d2 < softR2) {
        const d = Math.sqrt(d2);
        disc = 1 - (d - coreR) / (softR - coreR);
        disc = disc * disc * (3 - 2 * disc);
      }
      alpha[idx] = Math.max(disc, fill[idx] ? 1 : 0);
    }
  }

  const feathered = featherAlpha(
    alpha,
    w,
    h,
    Math.max(3, Math.round(minDim * 0.008)),
  );

  const bin = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) bin[i] = feathered[i] > 0.12 ? 1 : 0;

  return {
    alpha: feathered,
    w,
    h,
    maskDataUrl: binaryToDataUrl(bin, w, h),
  };
}

/** @deprecated prefer hotspotRoiAlpha; kept for compatibility */
export async function floodFillMask(
  imageUrl: string,
  x: number,
  y: number,
): Promise<string> {
  const roi = await hotspotRoiAlpha(imageUrl, x, y);
  return roi.maskDataUrl;
}

/**
 * Soft-ROI composite for hotspot edits: outside ROI keep original 100%.
 * Inside ROI trust the model; near the soft edge only keep meaningful changes.
 */
export async function compositeHotspotLocal(
  originalUrl: string,
  editedUrl: string,
  alpha: Float32Array,
  w: number,
  h: number,
): Promise<string> {
  const [orig, edited] = await Promise.all([
    loadImageEl(originalUrl),
    loadImageEl(editedUrl),
  ]);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(orig, 0, 0, w, h);
  const base = ctx.getImageData(0, 0, w, h);

  const ec = document.createElement('canvas');
  ec.width = w;
  ec.height = h;
  const ecx = ec.getContext('2d', { willReadFrequently: true })!;
  ecx.drawImage(edited, 0, 0, w, h);
  const ed = ecx.getImageData(0, 0, w, h);

  const out = base.data;
  const e = ed.data;
  for (let p = 0, i = 0; p < w * h; p++, i += 4) {
    const a = alpha[p];
    if (a <= 0.02) continue;
    // Soft ROI: trust model inside focus; outside ROI locked to original
    out[i] = Math.round(out[i] * (1 - a) + e[i] * a);
    out[i + 1] = Math.round(out[i + 1] * (1 - a) + e[i + 1] * a);
    out[i + 2] = Math.round(out[i + 2] * (1 - a) + e[i + 2] * a);
  }

  ctx.putImageData(base, 0, 0);
  return canvas.toDataURL('image/png');
}

/**
 * Strict composite: outside the mask (black), keep original pixels 100%.
 */
export async function compositeLocalStrict(
  originalUrl: string,
  editedUrl: string,
  maskUrl: string,
  feather = 3,
): Promise<string> {
  const [orig, edited, maskImg] = await Promise.all([
    loadImageEl(originalUrl),
    loadImageEl(editedUrl),
    loadImageEl(maskUrl),
  ]);
  const w = orig.naturalWidth;
  const h = orig.naturalHeight;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;

  ctx.drawImage(orig, 0, 0, w, h);
  const base = ctx.getImageData(0, 0, w, h);

  const ec = document.createElement('canvas');
  ec.width = w;
  ec.height = h;
  const ecx = ec.getContext('2d', { willReadFrequently: true })!;
  ecx.drawImage(edited, 0, 0, w, h);
  const ed = ecx.getImageData(0, 0, w, h);

  const mc = document.createElement('canvas');
  mc.width = w;
  mc.height = h;
  const mcx = mc.getContext('2d', { willReadFrequently: true })!;
  mcx.drawImage(maskImg, 0, 0, w, h);
  const md = mcx.getImageData(0, 0, w, h);

  const alpha = new Float32Array(w * h);
  for (let p = 0, i = 0; p < w * h; p++, i += 4) {
    alpha[p] = (md.data[i] + md.data[i + 1] + md.data[i + 2]) / (3 * 255);
  }
  const soft = feather > 0 ? featherAlpha(alpha, w, h, feather) : alpha;

  const out = base.data;
  const e = ed.data;
  for (let p = 0, i = 0; p < w * h; p++, i += 4) {
    const a = soft[p];
    if (a <= 0.01) continue;
    out[i] = Math.round(out[i] * (1 - a) + e[i] * a);
    out[i + 1] = Math.round(out[i + 1] * (1 - a) + e[i + 1] * a);
    out[i + 2] = Math.round(out[i + 2] * (1 - a) + e[i + 2] * a);
  }

  ctx.putImageData(base, 0, 0);
  return canvas.toDataURL('image/png');
}

/** Convert display-size brush canvas → natural-resolution white/black mask */
export async function brushCanvasToNaturalMask(
  maskCanvas: HTMLCanvasElement,
  naturalW: number,
  naturalH: number,
): Promise<string> {
  const out = document.createElement('canvas');
  out.width = naturalW;
  out.height = naturalH;
  const ctx = out.getContext('2d', { willReadFrequently: true })!;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, naturalW, naturalH);
  ctx.drawImage(maskCanvas, 0, 0, naturalW, naturalH);
  const imgData = ctx.getImageData(0, 0, naturalW, naturalH);
  const d = imgData.data;
  for (let i = 0; i < d.length; i += 4) {
    const lit = d[i + 3] > 16 || d[i] > 40 || d[i + 1] > 20;
    const v = lit ? 255 : 0;
    d[i] = v;
    d[i + 1] = v;
    d[i + 2] = v;
    d[i + 3] = 255;
  }
  ctx.putImageData(imgData, 0, 0);
  return out.toDataURL('image/png');
}

/** Place a natural-size mask into the padded Gemini canvas */
export async function padMaskToCanvas(
  naturalMaskUrl: string,
  pad: {
    canvasW: number;
    canvasH: number;
    originalCrop: { x: number; y: number; w: number; h: number };
  },
): Promise<string> {
  const mask = await loadImageEl(naturalMaskUrl);
  const out = document.createElement('canvas');
  out.width = pad.canvasW;
  out.height = pad.canvasH;
  const ctx = out.getContext('2d')!;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, pad.canvasW, pad.canvasH);
  const { x, y, w, h } = pad.originalCrop;
  ctx.drawImage(mask, x, y, w, h);
  return out.toDataURL('image/png');
}
