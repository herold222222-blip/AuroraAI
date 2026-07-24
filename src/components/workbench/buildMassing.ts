import type { FaceQuality, Layer, SceneGrid } from '../../types';

export const WORLD_W = 14;

export interface LayerMesh {
  layer: Layer;
  positions: Float32Array;
}

/** How many grid cells to skip when sampling (higher = fewer faces). */
export function faceStep(quality: FaceQuality, gridW: number): number {
  switch (quality) {
    case 'high':
      return 1;
    case 'medium':
      return 2;
    case 'low':
      return 4;
    case 'auto':
    default:
      if (gridW <= 120) return 1;
      if (gridW <= 200) return 2;
      return 3;
  }
}

function heightForKind(kind: Layer['kind'], base: number, dm: number): number {
  switch (kind) {
    case 'building':
      return base * (0.6 + 0.75 * dm);
    case 'mountain':
      return base * (0.55 + 0.8 * dm);
    case 'vegetation':
      return base * (0.75 + 0.45 * dm);
    case 'ground':
      return base + dm * 0.25;
    case 'water':
      return Math.max(0.06, base * 0.6);
    case 'path':
      return base + dm * 0.08;
    default:
      return base * (0.8 + 0.4 * dm);
  }
}

/**
 * Build one flat-shaded massing mesh per visible layer from the AI label grid.
 * `quality` controls block sampling density (face count).
 */
export function buildMassing(
  grid: SceneGrid,
  layers: Layer[],
  quality: FaceQuality = 'auto',
): LayerMesh[] {
  const { width: gw, height: gh, cells, depth } = grid;
  const step = faceStep(quality, gw);
  const D = (WORLD_W * gh) / gw;
  const cw = (WORLD_W / gw) * step;
  const cd = (D / gh) * step;

  const layerByKey = new Map<number, Layer>();
  layers.forEach((l) => layerByKey.set(l.key, l));

  const acc = new Map<number, { c: number; d: number }>();
  for (let i = 0; i < cells.length; i++) {
    const k = cells[i];
    if (k < 0) continue;
    const e = acc.get(k) ?? { c: 0, d: 0 };
    e.c++;
    e.d += depth[i];
    acc.set(k, e);
  }

  const heightByKey = new Map<number, number>();
  for (const l of layers) {
    if (!l.visible || l.kind === 'sky') {
      heightByKey.set(l.key, 0);
      continue;
    }
    const e = acc.get(l.key);
    const dm = e && e.c ? e.d / e.c : 0.5;
    heightByKey.set(l.key, heightForKind(l.kind, l.height, dm));
  }

  const posByKey = new Map<number, number[]>();
  const arrFor = (k: number) => {
    let a = posByKey.get(k);
    if (!a) {
      a = [];
      posByKey.set(k, a);
    }
    return a;
  };

  const addTri = (
    a: number[],
    p1: [number, number, number],
    p2: [number, number, number],
    p3: [number, number, number],
  ) => {
    a.push(p1[0], p1[1], p1[2], p2[0], p2[1], p2[2], p3[0], p3[1], p3[2]);
  };
  const addQuad = (
    a: number[],
    p1: [number, number, number],
    p2: [number, number, number],
    p3: [number, number, number],
    p4: [number, number, number],
  ) => {
    addTri(a, p1, p2, p3);
    addTri(a, p1, p3, p4);
  };

  const blockKey = (gx: number, gy: number): number => {
    const counts = new Map<number, number>();
    for (let dy = 0; dy < step && gy + dy < gh; dy++) {
      for (let dx = 0; dx < step && gx + dx < gw; dx++) {
        const k = cells[(gy + dy) * gw + (gx + dx)];
        if (k < 0) continue;
        counts.set(k, (counts.get(k) ?? 0) + 1);
      }
    }
    let best = -1;
    let n = 0;
    for (const [k, c] of counts) {
      if (c > n) {
        n = c;
        best = k;
      }
    }
    return best;
  };

  const heightAtBlock = (bx: number, by: number): number => {
    if (bx < 0 || by < 0 || bx >= gw || by >= gh) return 0;
    const nk = blockKey(bx, by);
    if (nk < 0) return 0;
    return heightByKey.get(nk) ?? 0;
  };

  for (let gy = 0; gy < gh; gy += step) {
    for (let gx = 0; gx < gw; gx += step) {
      const k = blockKey(gx, gy);
      if (k < 0) continue;
      const L = layerByKey.get(k);
      if (!L || !L.visible || L.kind === 'sky') continue;
      const H = heightByKey.get(k) ?? 0;
      if (H <= 0) continue;

      const x0 = -WORLD_W / 2 + (gx / step) * cw;
      const x1 = x0 + cw;
      const z0 = -D / 2 + (gy / step) * cd;
      const z1 = z0 + cd;
      const a = arrFor(k);

      addQuad(a, [x0, H, z0], [x0, H, z1], [x1, H, z1], [x1, H, z0]);

      const hl = heightAtBlock(gx - step, gy);
      if (hl < H) {
        const b = Math.max(0, hl);
        addQuad(a, [x0, b, z0], [x0, b, z1], [x0, H, z1], [x0, H, z0]);
      }
      const hr = heightAtBlock(gx + step, gy);
      if (hr < H) {
        const b = Math.max(0, hr);
        addQuad(a, [x1, b, z1], [x1, b, z0], [x1, H, z0], [x1, H, z1]);
      }
      const hu = heightAtBlock(gx, gy - step);
      if (hu < H) {
        const b = Math.max(0, hu);
        addQuad(a, [x0, b, z0], [x1, b, z0], [x1, H, z0], [x0, H, z0]);
      }
      const hd = heightAtBlock(gx, gy + step);
      if (hd < H) {
        const b = Math.max(0, hd);
        addQuad(a, [x1, b, z1], [x0, b, z1], [x0, H, z1], [x1, H, z1]);
      }
    }
  }

  const meshes: LayerMesh[] = [];
  for (const l of layers) {
    const a = posByKey.get(l.key);
    if (a && a.length) meshes.push({ layer: l, positions: new Float32Array(a) });
  }
  return meshes;
}
