import {
  binaryMaskToDataUrl,
  canvasToBinaryMask,
  connectedComponents,
  dataUrlToBinaryMask,
  hitMask,
  maskCentroid,
  masksOverlap,
  scaleMask,
  unionMasks,
} from './brushRegions';
import type { BrushRegion } from './useImageStore';

function uid() {
  return `br_${Math.random().toString(36).slice(2, 9)}`;
}

type Loaded = BrushRegion & { mask: Uint8Array };

/**
 * Merge a finished display-space stroke into existing natural-res brush regions.
 * Connecting strokes merge regions; disconnected blobs become new numbered regions.
 */
export async function mergeStrokeIntoRegions(
  strokeCanvas: HTMLCanvasElement,
  existing: BrushRegion[],
  naturalW: number,
  naturalH: number,
): Promise<BrushRegion[]> {
  const dw = strokeCanvas.width;
  const dh = strokeCanvas.height;
  if (!dw || !dh) return existing;

  const strokeDisp = canvasToBinaryMask(strokeCanvas);
  const strokeNat = scaleMask(strokeDisp, dw, dh, naturalW, naturalH);
  if (!strokeNat.some(Boolean)) return existing;

  const components = connectedComponents(strokeNat, naturalW, naturalH);
  let loaded: Loaded[] = await Promise.all(
    existing.map(async (r) => {
      const { mask } = await dataUrlToBinaryMask(r.maskDataUrl);
      return { ...r, mask };
    }),
  );

  for (const comp of components) {
    const touched = loaded.filter((r) => masksOverlap(r.mask, comp));
    if (!touched.length) {
      const c = maskCentroid(comp, naturalW, naturalH);
      loaded.push({
        id: uid(),
        n: 0,
        prompt: '',
        maskDataUrl: binaryMaskToDataUrl(comp, naturalW, naturalH),
        cx: c.x,
        cy: c.y,
        mask: comp,
      });
    } else {
      const merged = unionMasks([...touched.map((t) => t.mask), comp]);
      const prompt =
        touched
          .map((t) => t.prompt.trim())
          .filter(Boolean)
          .join('；') || '';
      const c = maskCentroid(merged, naturalW, naturalH);
      const touchedIds = new Set(touched.map((t) => t.id));
      loaded = loaded.filter((r) => !touchedIds.has(r.id));
      loaded.push({
        id: uid(),
        n: 0,
        prompt,
        maskDataUrl: binaryMaskToDataUrl(merged, naturalW, naturalH),
        cx: c.x,
        cy: c.y,
        mask: merged,
      });
    }
  }

  return loaded.map(({ mask: _m, ...r }, i) => ({ ...r, n: i + 1 }));
}

/**
 * Convert a finished display-space freehand stroke into one natural-res sketch mark.
 * Unlike brush merge, each gesture always becomes a new numbered mark.
 */
export async function strokeCanvasToSketchMark(
  strokeCanvas: HTMLCanvasElement,
  naturalW: number,
  naturalH: number,
): Promise<{
  strokeMaskDataUrl: string;
  cx: number;
  cy: number;
} | null> {
  const dw = strokeCanvas.width;
  const dh = strokeCanvas.height;
  if (!dw || !dh) return null;

  const strokeDisp = canvasToBinaryMask(strokeCanvas);
  const strokeNat = scaleMask(strokeDisp, dw, dh, naturalW, naturalH);
  if (!strokeNat.some(Boolean)) return null;

  const c = maskCentroid(strokeNat, naturalW, naturalH);
  return {
    strokeMaskDataUrl: binaryMaskToDataUrl(strokeNat, naturalW, naturalH),
    cx: c.x,
    cy: c.y,
  };
}

export async function findHotspotSketchAt(
  hotspots: { id: string; x: number; y: number; strokeMaskDataUrl?: string }[],
  x: number,
  y: number,
  naturalW: number,
  naturalH: number,
): Promise<string | null> {
  for (const hp of [...hotspots].reverse()) {
    if (hp.strokeMaskDataUrl) {
      const { mask, w, h } = await dataUrlToBinaryMask(hp.strokeMaskDataUrl);
      const mx = (x / naturalW) * w;
      const my = (y / naturalH) * h;
      if (hitMask(mask, w, h, mx, my, 10)) return hp.id;
    } else {
      const hitR = Math.max(18, Math.min(naturalW, naturalH) * 0.025);
      if (Math.hypot(hp.x - x, hp.y - y) <= hitR) return hp.id;
    }
  }
  return null;
}

export async function findBrushRegionAt(
  regions: BrushRegion[],
  x: number,
  y: number,
  naturalW: number,
  naturalH: number,
): Promise<BrushRegion | null> {
  for (const r of [...regions].reverse()) {
    const { mask, w, h } = await dataUrlToBinaryMask(r.maskDataUrl);
    const mx = (x / naturalW) * w;
    const my = (y / naturalH) * h;
    if (hitMask(mask, w, h, mx, my, 6)) return r;
  }
  return null;
}

export async function redrawBrushOverlay(
  canvas: HTMLCanvasElement,
  regions: BrushRegion[],
  opts?: { tint?: 'red' | 'amber' },
): Promise<void> {
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const tint = opts?.tint ?? 'red';
  const rgb =
    tint === 'amber'
      ? ([251, 191, 36] as const) // Gemini-like sketch yellow
      : ([239, 68, 68] as const);
  for (const r of regions) {
    const img = new Image();
    await new Promise<void>((res, rej) => {
      img.onload = () => res();
      img.onerror = () => rej(new Error('overlay'));
      img.src = r.maskDataUrl;
    });
    // Tint white mask → translucent stroke color
    const tmp = document.createElement('canvas');
    tmp.width = img.naturalWidth;
    tmp.height = img.naturalHeight;
    const tctx = tmp.getContext('2d', { willReadFrequently: true })!;
    tctx.drawImage(img, 0, 0);
    const data = tctx.getImageData(0, 0, tmp.width, tmp.height);
    const d = data.data;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i] < 128) {
        d[i + 3] = 0;
        continue;
      }
      d[i] = rgb[0];
      d[i + 1] = rgb[1];
      d[i + 2] = rgb[2];
      d[i + 3] = tint === 'amber' ? 200 : 150;
    }
    tctx.putImageData(data, 0, 0);
    ctx.drawImage(tmp, 0, 0, canvas.width, canvas.height);
  }
}
