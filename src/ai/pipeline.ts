// Real in-browser AI: semantic segmentation (SegFormer/ADE20K) + monocular
// depth estimation (Depth-Anything), running via transformers.js (ONNX Runtime
// Web). Results are resampled onto a fixed analysis grid consumed by the 2D
// canvas and the 3D massing builder.
import { pipeline, env } from '@huggingface/transformers';
import { categoryForLabel, type CategoryKey } from './labels';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyPipeline = any;

const SEG_MODEL = 'Xenova/segformer-b0-finetuned-ade-512-512';
const DEPTH_MODEL = 'Xenova/depth-anything-small-hf';

// Prefer the global HF host but fall back to the China-friendly mirror.
const HOSTS = ['https://huggingface.co', 'https://hf-mirror.com'];

export const GRID_W = 208;

export interface RawSceneAnalysis {
  gridW: number;
  gridH: number;
  /** index into `categories` for each cell, -1 = empty */
  cells: Int16Array;
  categories: CategoryKey[];
  /** normalized 0..1 depth (1 = nearest / highest) */
  depth: Float32Array;
}

export type ProgressFn = (stage: string, fraction: number) => void;

let segPromise: Promise<AnyPipeline> | null = null;
let depthPromise: Promise<AnyPipeline> | null = null;

function configureEnv() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const e = env as any;
  e.allowLocalModels = false;
  // single-threaded wasm avoids the need for cross-origin isolation
  if (e.backends?.onnx?.wasm) {
    e.backends.onnx.wasm.numThreads = 1;
  }
}

async function createWithFallback(
  task: string,
  model: string,
  onProgress?: (p: number) => void,
): Promise<AnyPipeline> {
  configureEnv();
  const files: Record<string, number> = {};
  const report = () => {
    const vals = Object.values(files);
    if (!vals.length || !onProgress) return;
    onProgress(vals.reduce((a, b) => a + b, 0) / vals.length / 100);
  };
  const progress_callback = (e: {
    status?: string;
    file?: string;
    progress?: number;
  }) => {
    if (e.status === 'progress' && e.file) {
      files[e.file] = e.progress ?? 0;
      report();
    } else if (e.status === 'done' && e.file) {
      files[e.file] = 100;
      report();
    }
  };

  let lastErr: unknown;
  for (const host of HOSTS) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (env as any).remoteHost = host;
    try {
      // wasm is the most compatible backend across browsers
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return await (pipeline as any)(task, model, {
        device: 'wasm',
        progress_callback,
      });
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr;
}

function getSegmenter(onProgress?: (p: number) => void) {
  if (!segPromise) segPromise = createWithFallback('image-segmentation', SEG_MODEL, onProgress);
  return segPromise;
}

function getDepth(onProgress?: (p: number) => void) {
  if (!depthPromise) depthPromise = createWithFallback('depth-estimation', DEPTH_MODEL, onProgress);
  return depthPromise;
}

interface RawImageLike {
  data: Uint8Array | Uint8ClampedArray;
  width: number;
  height: number;
  channels: number;
}

export async function runSceneAI(
  imageUrl: string,
  onProgress?: ProgressFn,
): Promise<RawSceneAnalysis> {
  onProgress?.('正在加载语义分割模型', 0.02);
  const segmenter = await getSegmenter((p) =>
    onProgress?.('正在加载语义分割模型', 0.02 + p * 0.33),
  );
  onProgress?.('正在加载深度估算模型', 0.36);
  const depthEstimator = await getDepth((p) =>
    onProgress?.('正在加载深度估算模型', 0.36 + p * 0.28),
  );

  onProgress?.('正在进行语义分割', 0.66);
  const segOut = (await segmenter(imageUrl)) as {
    label: string;
    mask: RawImageLike;
  }[];

  onProgress?.('正在估算场景深度', 0.85);
  const depthOut = (await depthEstimator(imageUrl)) as { depth: RawImageLike };

  onProgress?.('正在生成专业图层', 0.94);

  // pick reference dimensions from the first mask
  const ref = segOut.find((s) => s.mask)?.mask;
  const srcW = ref?.width ?? 512;
  const srcH = ref?.height ?? 512;
  const gridW = GRID_W;
  const gridH = Math.max(96, Math.min(320, Math.round((GRID_W * srcH) / srcW)));

  // assign each present category an index
  const categories: CategoryKey[] = [];
  const catIndex = new Map<CategoryKey, number>();
  const indexFor = (c: CategoryKey) => {
    let i = catIndex.get(c);
    if (i === undefined) {
      i = categories.length;
      categories.push(c);
      catIndex.set(c, i);
    }
    return i;
  };

  // one entry per detected segment, each already resolved to a category
  const entries = segOut
    .filter((s) => s.mask)
    .map((s) => ({ cat: categoryForLabel(s.label), mask: s.mask }));

  // pre-register categories so votes from several ADE labels that share a
  // category (e.g. "tree" + "plant") are pooled together
  const entryCat = entries.map((e) => indexFor(e.cat));
  const numCats = categories.length;

  // Winning segment per SOURCE pixel (arg-max over masks). Working at the mask
  // resolution first, then majority-voting into the coarse grid, keeps region
  // boundaries faithful to the actual image instead of snapping to one sample.
  const maskAt = (m: RawImageLike, sx: number, sy: number): number => {
    const mx = m.width === srcW ? sx : Math.min(m.width - 1, ((sx / srcW) * m.width) | 0);
    const my = m.height === srcH ? sy : Math.min(m.height - 1, ((sy / srcH) * m.height) | 0);
    return m.data[(my * m.width + mx) * m.channels];
  };
  const srcLabel = new Int16Array(srcW * srcH).fill(-1);
  for (let sy = 0; sy < srcH; sy++) {
    for (let sx = 0; sx < srcW; sx++) {
      let best = -1;
      let bestVal = 96; // include soft mask edges, not just the >127 core
      for (let e = 0; e < entries.length; e++) {
        const v = maskAt(entries[e].mask, sx, sy);
        if (v > bestVal) {
          bestVal = v;
          best = e;
        }
      }
      srcLabel[sy * srcW + sx] = best;
    }
  }

  // majority-vote downsample onto the analysis grid, pooled by category
  const cells = new Int16Array(gridW * gridH).fill(-1);
  const tally = new Int32Array(numCats);
  for (let gy = 0; gy < gridH; gy++) {
    const sy0 = ((gy / gridH) * srcH) | 0;
    const sy1 = Math.max(sy0 + 1, (((gy + 1) / gridH) * srcH) | 0);
    for (let gx = 0; gx < gridW; gx++) {
      const sx0 = ((gx / gridW) * srcW) | 0;
      const sx1 = Math.max(sx0 + 1, (((gx + 1) / gridW) * srcW) | 0);
      tally.fill(0);
      let total = 0;
      for (let sy = sy0; sy < sy1; sy++) {
        for (let sx = sx0; sx < sx1; sx++) {
          const e = srcLabel[sy * srcW + sx];
          if (e >= 0) {
            tally[entryCat[e]]++;
            total++;
          }
        }
      }
      if (total === 0) continue;
      let bestCat = -1;
      let bestCount = 0;
      for (let c = 0; c < numCats; c++) {
        if (tally[c] > bestCount) {
          bestCount = tally[c];
          bestCat = c;
        }
      }
      if (bestCat >= 0) cells[gy * gridW + gx] = bestCat;
    }
  }

  // resample depth to the grid (block average), normalized 0..1
  const depth = new Float32Array(gridW * gridH);
  const dImg = depthOut.depth;
  const dW = dImg.width;
  const dH = dImg.height;
  const dC = dImg.channels;
  for (let gy = 0; gy < gridH; gy++) {
    const dy0 = ((gy / gridH) * dH) | 0;
    const dy1 = Math.max(dy0 + 1, (((gy + 1) / gridH) * dH) | 0);
    for (let gx = 0; gx < gridW; gx++) {
      const dx0 = ((gx / gridW) * dW) | 0;
      const dx1 = Math.max(dx0 + 1, (((gx + 1) / gridW) * dW) | 0);
      let sum = 0;
      let c = 0;
      for (let dy = dy0; dy < dy1; dy++) {
        for (let dx = dx0; dx < dx1; dx++) {
          sum += dImg.data[(dy * dW + dx) * dC];
          c++;
        }
      }
      depth[gy * gridW + gx] = c ? sum / c / 255 : 0;
    }
  }

  onProgress?.('分层完成', 1);
  return { gridW, gridH, cells, categories, depth };
}
