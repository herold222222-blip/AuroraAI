/** Brush-region mask utilities (display or natural resolution RGBA canvases). */

export function canvasToBinaryMask(canvas: HTMLCanvasElement, alphaThr = 16): Uint8Array {
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const out = new Uint8Array(canvas.width * canvas.height);
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    out[p] = data[i + 3] > alphaThr || data[i] > 40 ? 1 : 0;
  }
  return out;
}

export function binaryMaskToDataUrl(
  mask: Uint8Array,
  w: number,
  h: number,
): string {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(w, h);
  for (let i = 0; i < mask.length; i++) {
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

export async function dataUrlToBinaryMask(
  dataUrl: string,
): Promise<{ mask: Uint8Array; w: number; h: number }> {
  const img = new Image();
  await new Promise<void>((res, rej) => {
    img.onload = () => res();
    img.onerror = () => rej(new Error('mask load fail'));
    img.src = dataUrl;
  });
  const w = img.naturalWidth;
  const h = img.naturalHeight;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(img, 0, 0);
  const { data } = ctx.getImageData(0, 0, w, h);
  const mask = new Uint8Array(w * h);
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    mask[p] = data[i] > 127 ? 1 : 0;
  }
  return { mask, w, h };
}

export function masksOverlap(a: Uint8Array, b: Uint8Array): boolean {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    if (a[i] && b[i]) return true;
  }
  return false;
}

export function unionMasks(masks: Uint8Array[]): Uint8Array {
  if (!masks.length) return new Uint8Array(0);
  const out = new Uint8Array(masks[0].length);
  for (const m of masks) {
    for (let i = 0; i < out.length; i++) {
      if (m[i]) out[i] = 1;
    }
  }
  return out;
}

/** 4-connected components; returns list of binary masks */
export function connectedComponents(
  mask: Uint8Array,
  w: number,
  h: number,
): Uint8Array[] {
  const visited = new Uint8Array(w * h);
  const regions: Uint8Array[] = [];
  const stack: number[] = [];

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const start = y * w + x;
      if (!mask[start] || visited[start]) continue;
      const region = new Uint8Array(w * h);
      stack.length = 0;
      stack.push(x, y);
      visited[start] = 1;
      while (stack.length) {
        const cy = stack.pop()!;
        const cx = stack.pop()!;
        region[cy * w + cx] = 1;
        const nbs = [
          [cx - 1, cy],
          [cx + 1, cy],
          [cx, cy - 1],
          [cx, cy + 1],
        ];
        for (const [nx, ny] of nbs) {
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const idx = ny * w + nx;
          if (visited[idx] || !mask[idx]) continue;
          visited[idx] = 1;
          stack.push(nx, ny);
        }
      }
      regions.push(region);
    }
  }
  return regions;
}

export function maskCentroid(
  mask: Uint8Array,
  w: number,
  h: number,
): { x: number; y: number } {
  let sx = 0;
  let sy = 0;
  let c = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!mask[y * w + x]) continue;
      sx += x;
      sy += y;
      c++;
    }
  }
  if (!c) return { x: w / 2, y: h / 2 };
  return { x: sx / c, y: sy / c };
}

export function hitMask(
  mask: Uint8Array,
  w: number,
  h: number,
  x: number,
  y: number,
  radius = 4,
): boolean {
  const cx = Math.round(x);
  const cy = Math.round(y);
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      if (dx * dx + dy * dy > radius * radius) continue;
      const px = cx + dx;
      const py = cy + dy;
      if (px < 0 || py < 0 || px >= w || py >= h) continue;
      if (mask[py * w + px]) return true;
    }
  }
  return false;
}

/** Draw binary masks as semi-transparent red onto a display canvas */
export function paintRegionsOnCanvas(
  canvas: HTMLCanvasElement,
  regions: { mask: Uint8Array; w: number; h: number }[],
): void {
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  for (const r of regions) {
    if (r.w !== canvas.width || r.h !== canvas.height) {
      // scale region mask to canvas size
      const tmp = document.createElement('canvas');
      tmp.width = r.w;
      tmp.height = r.h;
      const tctx = tmp.getContext('2d')!;
      const img = tctx.createImageData(r.w, r.h);
      for (let i = 0; i < r.mask.length; i++) {
        if (!r.mask[i]) continue;
        const o = i * 4;
        img.data[o] = 239;
        img.data[o + 1] = 68;
        img.data[o + 2] = 68;
        img.data[o + 3] = 150;
      }
      tctx.putImageData(img, 0, 0);
      ctx.drawImage(tmp, 0, 0, canvas.width, canvas.height);
      continue;
    }
    const img = ctx.createImageData(canvas.width, canvas.height);
    for (let i = 0; i < r.mask.length; i++) {
      if (!r.mask[i]) continue;
      const o = i * 4;
      img.data[o] = 239;
      img.data[o + 1] = 68;
      img.data[o + 2] = 68;
      img.data[o + 3] = 150;
    }
    // merge with existing by redrawing — use destination-over via temp
    const tmp = document.createElement('canvas');
    tmp.width = canvas.width;
    tmp.height = canvas.height;
    tmp.getContext('2d')!.putImageData(img, 0, 0);
    ctx.drawImage(tmp, 0, 0);
  }
}

export function scaleMask(
  mask: Uint8Array,
  srcW: number,
  srcH: number,
  dstW: number,
  dstH: number,
): Uint8Array {
  if (srcW === dstW && srcH === dstH) return mask;
  const out = new Uint8Array(dstW * dstH);
  for (let y = 0; y < dstH; y++) {
    const sy = Math.min(srcH - 1, Math.floor((y * srcH) / dstH));
    for (let x = 0; x < dstW; x++) {
      const sx = Math.min(srcW - 1, Math.floor((x * srcW) / dstW));
      out[y * dstW + x] = mask[sy * srcW + sx];
    }
  }
  return out;
}
