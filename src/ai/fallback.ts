import type { CategoryKey } from './labels';
import type { RawSceneAnalysis } from './pipeline';
import { GRID_W } from './pipeline';

/**
 * Procedural landscape used when the AI models cannot be loaded (offline / model
 * error). Produces the same RawSceneAnalysis shape so the rest of the pipeline
 * is identical.
 */
export function generateFallbackScene(): RawSceneAnalysis {
  const gridW = GRID_W;
  const gridH = 130;
  const cells = new Int16Array(gridW * gridH).fill(-1);
  const depth = new Float32Array(gridW * gridH);

  const categories: CategoryKey[] = [
    'sky',
    'building',
    'vegetation',
    'water',
    'road',
    'ground',
  ];
  const idx = (c: CategoryKey) => categories.indexOf(c);

  const inEllipse = (
    nx: number,
    ny: number,
    cx: number,
    cy: number,
    rx: number,
    ry: number,
  ) => {
    const dx = (nx - cx) / rx;
    const dy = (ny - cy) / ry;
    return dx * dx + dy * dy <= 1;
  };

  for (let gy = 0; gy < gridH; gy++) {
    for (let gx = 0; gx < gridW; gx++) {
      const nx = gx / gridW;
      const ny = gy / gridH;
      let cat: CategoryKey = 'ground';

      if (ny < 0.26) cat = 'sky';
      else if (nx > 0.68 && nx < 0.95 && ny > 0.3 && ny < 0.56) cat = 'building';
      else if (inEllipse(nx, ny, 0.16, 0.44, 0.13, 0.14)) cat = 'vegetation';
      else if (inEllipse(nx, ny, 0.34, 0.38, 0.08, 0.09)) cat = 'vegetation';
      else if (inEllipse(nx, ny, 0.5, 0.66, 0.17, 0.12)) cat = 'water';
      else if (ny > 0.82 && ny < 0.92) cat = 'road';

      cells[gy * gridW + gx] = idx(cat);

      // depth: far (top) -> near (bottom); buildings/veg a touch higher
      let d = 0.2 + ny * 0.7;
      if (cat === 'building') d = Math.min(1, d + 0.15);
      if (cat === 'water') d = Math.max(0, d - 0.1);
      depth[gy * gridW + gx] = Math.max(0, Math.min(1, d));
    }
  }

  return { gridW, gridH, cells, categories, depth };
}
