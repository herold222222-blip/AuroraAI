import type { FaceQuality, Layer, SceneGrid, TopologyType } from '../../types';

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

type Vec3 = [number, number, number];

/** Quantize height so tiny float noise still counts as coplanar. */
function qH(h: number): number {
  return Math.round(h * 1000) / 1000;
}

/**
 * Greedy merge of occupied cells into maximal axis-aligned rectangles.
 * Cells are (ix, iy) in block index space.
 */
function mergeRects(
  cells: Array<[number, number]>,
): Array<{ x0: number; y0: number; x1: number; y1: number }> {
  if (!cells.length) return [];
  const set = new Set(cells.map(([x, y]) => `${x},${y}`));
  const visited = new Set<string>();
  const sorted = [...cells].sort((a, b) => a[1] - b[1] || a[0] - b[0]);
  const rects: Array<{ x0: number; y0: number; x1: number; y1: number }> = [];

  const has = (x: number, y: number) => set.has(`${x},${y}`) && !visited.has(`${x},${y}`);

  for (const [sx, sy] of sorted) {
    const key = `${sx},${sy}`;
    if (visited.has(key)) continue;

    let w = 1;
    while (has(sx + w, sy)) w++;

    let h = 1;
    outer: while (true) {
      for (let dx = 0; dx < w; dx++) {
        if (!has(sx + dx, sy + h)) break outer;
      }
      h++;
    }

    for (let dy = 0; dy < h; dy++) {
      for (let dx = 0; dx < w; dx++) {
        visited.add(`${sx + dx},${sy + dy}`);
      }
    }
    rects.push({ x0: sx, y0: sy, x1: sx + w, y1: sy + h });
  }
  return rects;
}

/**
 * Merge 1D runs of identical wall segments (same plane + same y range).
 * Each item: along-axis index `i` and span [a0,a1] on the orthogonal axis.
 */
function mergeWallRuns(
  items: Array<{ i: number; a0: number; a1: number; y0: number; y1: number }>,
): Array<{ i0: number; i1: number; a0: number; a1: number; y0: number; y1: number }> {
  if (!items.length) return [];
  const sorted = [...items].sort(
    (a, b) => a.y0 - b.y0 || a.y1 - b.y1 || a.a0 - b.a0 || a.i - b.i,
  );
  const out: Array<{
    i0: number;
    i1: number;
    a0: number;
    a1: number;
    y0: number;
    y1: number;
  }> = [];

  let cur = {
    i0: sorted[0].i,
    i1: sorted[0].i + 1,
    a0: sorted[0].a0,
    a1: sorted[0].a1,
    y0: sorted[0].y0,
    y1: sorted[0].y1,
  };

  for (let n = 1; n < sorted.length; n++) {
    const s = sorted[n];
    const sameBand =
      s.y0 === cur.y0 &&
      s.y1 === cur.y1 &&
      Math.abs(s.a0 - cur.a0) < 1e-6 &&
      Math.abs(s.a1 - cur.a1) < 1e-6;
    if (sameBand && s.i === cur.i1) {
      cur.i1 = s.i + 1;
    } else {
      out.push(cur);
      cur = {
        i0: s.i,
        i1: s.i + 1,
        a0: s.a0,
        a1: s.a1,
        y0: s.y0,
        y1: s.y1,
      };
    }
  }
  out.push(cur);
  return out;
}

/**
 * Build one flat-shaded massing mesh per visible layer from the AI label grid.
 * Coplanar neighboring blocks merge into large faces; only non-coplanar
 * surfaces stay separate and are tessellated as triangle/quad per topology.
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
  const nx = Math.ceil(gw / step);
  const ny = Math.ceil(gh / step);

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

  const addTri = (a: number[], p1: Vec3, p2: Vec3, p3: Vec3) => {
    a.push(p1[0], p1[1], p1[2], p2[0], p2[1], p2[2], p3[0], p3[1], p3[2]);
  };

  /** Emit a planar rectangle; topology chooses diagonal split style. */
  const addFace = (
    a: number[],
    p1: Vec3,
    p2: Vec3,
    p3: Vec3,
    p4: Vec3,
    topology: TopologyType,
  ) => {
    if (topology === 'quad') {
      // Two tris sharing the same quad outline (GPU still needs triangles).
      addTri(a, p1, p2, p3);
      addTri(a, p1, p3, p4);
    } else {
      // Triangle topology: alternate diagonal for more even triangulation.
      addTri(a, p1, p2, p4);
      addTri(a, p2, p3, p4);
    }
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

  // Precompute block key + height grids.
  const keys = new Int32Array(nx * ny);
  const heights = new Float32Array(nx * ny);
  keys.fill(-1);
  for (let iy = 0; iy < ny; iy++) {
    for (let ix = 0; ix < nx; ix++) {
      const gx = ix * step;
      const gy = iy * step;
      const k = blockKey(gx, gy);
      const L = k >= 0 ? layerByKey.get(k) : undefined;
      if (!L || !L.visible || L.kind === 'sky') continue;
      const H = heightByKey.get(k) ?? 0;
      if (H <= 0) continue;
      const idx = iy * nx + ix;
      keys[idx] = k;
      heights[idx] = H;
    }
  }

  const heightAt = (ix: number, iy: number): number => {
    if (ix < 0 || iy < 0 || ix >= nx || iy >= ny) return 0;
    return heights[iy * nx + ix] || 0;
  };

  const worldX = (ix: number) => -WORLD_W / 2 + ix * cw;
  const worldZ = (iy: number) => -D / 2 + iy * cd;

  // --- Top faces: merge coplanar (same layer + same height) into large rects ---
  const topBuckets = new Map<string, Array<[number, number]>>();
  for (let iy = 0; iy < ny; iy++) {
    for (let ix = 0; ix < nx; ix++) {
      const k = keys[iy * nx + ix];
      if (k < 0) continue;
      const H = qH(heights[iy * nx + ix]);
      const bucket = `${k}|${H}`;
      let list = topBuckets.get(bucket);
      if (!list) {
        list = [];
        topBuckets.set(bucket, list);
      }
      list.push([ix, iy]);
    }
  }

  for (const [bucket, cellList] of topBuckets) {
    const k = Number(bucket.split('|')[0]);
    const H = Number(bucket.split('|')[1]);
    const L = layerByKey.get(k);
    if (!L) continue;
    const topo = L.topology ?? 'triangle';
    const a = arrFor(k);
    for (const r of mergeRects(cellList)) {
      const x0 = worldX(r.x0);
      const x1 = worldX(r.x1);
      const z0 = worldZ(r.y0);
      const z1 = worldZ(r.y1);
      addFace(
        a,
        [x0, H, z0],
        [x0, H, z1],
        [x1, H, z1],
        [x1, H, z0],
        topo,
      );
    }
  }

  // --- Side faces: merge coplanar wall runs ---
  type WallItem = {
    i: number;
    a0: number;
    a1: number;
    y0: number;
    y1: number;
  };

  const emitWallGroup = (
    k: number,
    items: WallItem[],
    toQuad: (
      i0: number,
      i1: number,
      a0: number,
      a1: number,
      y0: number,
      y1: number,
    ) => [Vec3, Vec3, Vec3, Vec3],
  ) => {
    if (!items.length) return;
    const L = layerByKey.get(k);
    if (!L) return;
    const topo = L.topology ?? 'triangle';
    const a = arrFor(k);
    for (const run of mergeWallRuns(items)) {
      const [p1, p2, p3, p4] = toQuad(
        run.i0,
        run.i1,
        run.a0,
        run.a1,
        run.y0,
        run.y1,
      );
      addFace(a, p1, p2, p3, p4, topo);
    }
  };

  // Group wall candidates by (layerKey|planeId|y0|y1) then merge along the free axis.
  // Left walls (−X): plane = ix, free axis = iy
  const leftByKey = new Map<number, WallItem[]>();
  const rightByKey = new Map<number, WallItem[]>();
  const northByKey = new Map<number, WallItem[]>(); // −Z (image top)
  const southByKey = new Map<number, WallItem[]>(); // +Z

  const pushWall = (
    map: Map<number, WallItem[]>,
    k: number,
    item: WallItem,
  ) => {
    let list = map.get(k);
    if (!list) {
      list = [];
      map.set(k, list);
    }
    list.push(item);
  };

  for (let iy = 0; iy < ny; iy++) {
    for (let ix = 0; ix < nx; ix++) {
      const k = keys[iy * nx + ix];
      if (k < 0) continue;
      const H = heights[iy * nx + ix];
      const x0 = worldX(ix);
      const x1 = worldX(ix + 1);
      const z0 = worldZ(iy);
      const z1 = worldZ(iy + 1);

      const hl = heightAt(ix - 1, iy);
      if (hl < H) {
        pushWall(leftByKey, k, {
          i: iy,
          a0: x0,
          a1: x0,
          y0: qH(Math.max(0, hl)),
          y1: qH(H),
        });
      }
      const hr = heightAt(ix + 1, iy);
      if (hr < H) {
        pushWall(rightByKey, k, {
          i: iy,
          a0: x1,
          a1: x1,
          y0: qH(Math.max(0, hr)),
          y1: qH(H),
        });
      }
      const hu = heightAt(ix, iy - 1);
      if (hu < H) {
        pushWall(northByKey, k, {
          i: ix,
          a0: z0,
          a1: z0,
          y0: qH(Math.max(0, hu)),
          y1: qH(H),
        });
      }
      const hd = heightAt(ix, iy + 1);
      if (hd < H) {
        pushWall(southByKey, k, {
          i: ix,
          a0: z1,
          a1: z1,
          y0: qH(Math.max(0, hd)),
          y1: qH(H),
        });
      }
    }
  }

  // Left walls need grouping by X plane (a0) + y-range before 1D merge on iy.
  const groupAndEmit = (
    map: Map<number, WallItem[]>,
    axis: 'x' | 'z',
    sign: 1 | -1,
  ) => {
    for (const [k, items] of map) {
      const bands = new Map<string, WallItem[]>();
      for (const it of items) {
        const band = `${it.a0}|${it.y0}|${it.y1}`;
        let list = bands.get(band);
        if (!list) {
          list = [];
          bands.set(band, list);
        }
        list.push(it);
      }
      for (const [, bandItems] of bands) {
        if (axis === 'x') {
          // free axis = Z via iy; a0 is constant X
          emitWallGroup(k, bandItems, (i0, i1, x, _x1, y0, y1) => {
            const zA = worldZ(i0);
            const zB = worldZ(i1);
            if (sign < 0) {
              // left (−X outward)
              return [
                [x, y0, zA],
                [x, y0, zB],
                [x, y1, zB],
                [x, y1, zA],
              ];
            }
            // right (+X)
            return [
              [x, y0, zB],
              [x, y0, zA],
              [x, y1, zA],
              [x, y1, zB],
            ];
          });
        } else {
          emitWallGroup(k, bandItems, (i0, i1, z, _z1, y0, y1) => {
            const xA = worldX(i0);
            const xB = worldX(i1);
            if (sign < 0) {
              // north (−Z)
              return [
                [xA, y0, z],
                [xB, y0, z],
                [xB, y1, z],
                [xA, y1, z],
              ];
            }
            // south (+Z)
            return [
              [xB, y0, z],
              [xA, y0, z],
              [xA, y1, z],
              [xB, y1, z],
            ];
          });
        }
      }
    }
  };

  // Fix left/right wall items: `i` should be iy, but a0 holds X.
  // mergeWallRuns merges on consecutive `i` — good.
  // For north/south, `i` is ix — good.

  groupAndEmit(leftByKey, 'x', -1);
  groupAndEmit(rightByKey, 'x', 1);
  groupAndEmit(northByKey, 'z', -1);
  groupAndEmit(southByKey, 'z', 1);

  const meshes: LayerMesh[] = [];
  for (const l of layers) {
    const a = posByKey.get(l.key);
    if (a && a.length) meshes.push({ layer: l, positions: new Float32Array(a) });
  }
  return meshes;
}
