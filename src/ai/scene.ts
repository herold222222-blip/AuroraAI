import type { Layer, SceneGrid } from '../types';
import { uid, newLayerMaterial } from '../data/defaultLayers';
import {
  CATEGORY_DEFS,
  CATEGORY_ORDER,
  type CategoryKey,
} from './labels';
import type { RawSceneAnalysis } from './pipeline';

export interface SceneResult {
  grid: SceneGrid;
  layers: Layer[];
}

function makeLayer(key: number, cat: CategoryKey): Layer {
  const def = CATEGORY_DEFS[cat];
  return {
    id: uid('layer'),
    key,
    name: def.display,
    category: def.display,
    dimension: def.dimension,
    visible: true,
    color: def.color,
    height: def.baseHeight,
    kind: def.kind,
    material: newLayerMaterial(def.materialPreset, def.color),
    topology: 'quad',
    transform: { x: 0, y: 0, z: 0, scale: 1, rx: 0, ry: 0, rz: 0 },
  };
}

/**
 * Convert a raw per-cell category-index grid into a keyed scene grid + layer
 * list. Empty cells are back-filled with a ground layer so the terrain is
 * continuous, and layers are ordered for display.
 */
export function buildScene(raw: RawSceneAnalysis): SceneResult {
  const categories = [...raw.categories];
  const cells = Int16Array.from(raw.cells);

  // ensure a ground category exists to back-fill empty cells
  let groundIdx = categories.indexOf('ground');
  const hasEmpty = cells.some((v) => v === -1);
  if (hasEmpty && groundIdx === -1) {
    groundIdx = categories.length;
    categories.push('ground');
  }
  if (hasEmpty) {
    for (let i = 0; i < cells.length; i++) {
      if (cells[i] === -1) cells[i] = groundIdx;
    }
  }

  // drop categories that ended up with no cells (can happen after back-fill)
  const counts = new Array(categories.length).fill(0);
  for (let i = 0; i < cells.length; i++) {
    const v = cells[i];
    if (v >= 0) counts[v]++;
  }

  const layers: Layer[] = categories
    .map((cat, idx) => ({ cat, idx }))
    .filter(({ idx }) => counts[idx] > 0)
    .map(({ cat, idx }) => makeLayer(idx, cat));

  // display order
  layers.sort((a, b) => {
    const ca = categoryOfDef(a);
    const cb = categoryOfDef(b);
    return CATEGORY_ORDER.indexOf(ca) - CATEGORY_ORDER.indexOf(cb);
  });

  return {
    grid: {
      width: raw.gridW,
      height: raw.gridH,
      cells,
      depth: raw.depth,
    },
    layers,
  };
}

function categoryOfDef(layer: Layer): CategoryKey {
  const found = (Object.keys(CATEGORY_DEFS) as CategoryKey[]).find(
    (k) => CATEGORY_DEFS[k].display === layer.category,
  );
  return found ?? 'misc';
}
