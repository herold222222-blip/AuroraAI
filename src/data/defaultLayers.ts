import type { Layer, MaterialConfig, MaterialSwatch } from '../types';

let seq = 0;
export const uid = (prefix = 'id'): string => {
  seq += 1;
  return `${prefix}_${Date.now().toString(36)}_${seq}`;
};

export const AI_MODELS = [
  'Aurora-Geo v1 (通用)',
  'Meshy (Image to 3D)',
];

export const MESHY_MODEL_ID = 'Meshy (Image to 3D)';
export const DEFAULT_AI_MODEL = AI_MODELS[0];

export function isMeshyModel(aiModel: string) {
  return aiModel === MESHY_MODEL_ID || aiModel.toLowerCase().startsWith('meshy');
}

/** Map legacy / removed model ids onto the current allow-list. */
export function resolveAiModel(aiModel: string | undefined | null) {
  if (aiModel && AI_MODELS.includes(aiModel)) return aiModel;
  if (aiModel && isMeshyModel(aiModel)) return MESHY_MODEL_ID;
  return DEFAULT_AI_MODEL;
}

export const MATERIAL_PRESETS = [
  '草坪 / 软质地被',
  '静水 / 镜面水体',
  '乔木 / 组团绿化',
  '混凝土 / 白模体块',
  '透水铺装',
  '花岗岩铺装',
  '土石 / 微地形',
  '玻璃幕墙',
  '木质平台',
];

/** SketchUp-like material library swatches */
export const MATERIAL_LIBRARY: MaterialSwatch[] = [
  { id: 'mat_grass', name: '草坪', color: '#7CC28C', preset: '草坪 / 软质地被' },
  { id: 'mat_dark_grass', name: '深绿草坪', color: '#2E8B57', preset: '乔木 / 组团绿化' },
  { id: 'mat_water', name: '静水', color: '#3FA9F5', preset: '静水 / 镜面水体' },
  { id: 'mat_deep_water', name: '深水', color: '#1B6CA8', preset: '静水 / 镜面水体' },
  { id: 'mat_concrete', name: '混凝土', color: '#C8CED6', preset: '混凝土 / 白模体块' },
  { id: 'mat_white', name: '白模', color: '#F0F2F5', preset: '混凝土 / 白模体块' },
  { id: 'mat_stone', name: '花岗岩', color: '#B0A8C9', preset: '花岗岩铺装' },
  { id: 'mat_paving', name: '透水铺装', color: '#C9A46B', preset: '透水铺装' },
  { id: 'mat_earth', name: '土石', color: '#9C8B7A', preset: '土石 / 微地形' },
  { id: 'mat_wood', name: '木质', color: '#B07840', preset: '木质平台' },
  { id: 'mat_glass', name: '玻璃', color: '#A8D8EA', preset: '玻璃幕墙' },
  { id: 'mat_metal', name: '金属', color: '#8A939E', preset: '混凝土 / 白模体块' },
  { id: 'mat_brick', name: '砖墙', color: '#C4704B', preset: '混凝土 / 白模体块' },
  { id: 'mat_sand', name: '砂石', color: '#D4C4A8', preset: '透水铺装' },
  { id: 'mat_asphalt', name: '沥青', color: '#4A4E56', preset: '透水铺装' },
  { id: 'mat_amber', name: '暖色体块', color: '#F5A623', preset: '混凝土 / 白模体块' },
];

const sameColor = (a?: string, b?: string) =>
  Boolean(a && b && a.toLowerCase() === b.toLowerCase());

/** Resolve the library swatch linked to a material / layer color. */
export function matchLibrarySwatch(
  library: MaterialSwatch[],
  opts: { swatchId?: string; color?: string; preset?: string },
): MaterialSwatch | undefined {
  if (opts.swatchId) {
    const byId = library.find((s) => s.id === opts.swatchId);
    if (byId) return byId;
  }
  if (opts.color) {
    const byColor = library.find((s) => sameColor(s.color, opts.color));
    if (byColor) return byColor;
  }
  if (opts.preset) {
    return library.find((s) => s.preset === opts.preset);
  }
  return undefined;
}

/** Display name for PBR inspector — prefers library list name over preset. */
export function resolveMaterialDisplayName(
  material: MaterialConfig,
  library: MaterialSwatch[],
  layerColor?: string,
): string {
  const sw = matchLibrarySwatch(library, {
    swatchId: material.swatchId,
    color: layerColor ?? material.diffuse,
    preset: material.preset,
  });
  const raw = material.name?.trim();
  // Legacy materials used the long preset string as `name`.
  if (sw && (!raw || raw === material.preset)) return sw.name;
  if (raw) return raw;
  return sw?.name || material.preset;
}

const material = (
  preset: string,
  diffuse = '#e9edf2',
  name?: string,
  swatchId?: string,
): MaterialConfig => ({
  name: name ?? preset,
  swatchId,
  preset,
  diffuse,
  normal: '#8080ff',
  roughness: '#b8b8b8',
  metalness: '#101010',
  resolution: '2K',
});

export const newLayerMaterial = (preset: string, diffuse?: string) => {
  const sw = matchLibrarySwatch(MATERIAL_LIBRARY, { color: diffuse, preset });
  return material(
    sw?.preset ?? preset,
    diffuse ?? sw?.color ?? '#e9edf2',
    sw?.name,
    sw?.id,
  );
};

export const materialFromSwatch = (sw: MaterialSwatch): MaterialConfig =>
  swatchToMaterialConfig(sw);

/** Expand a library swatch into a full MaterialConfig (with PBR channel defaults). */
export function swatchToMaterialConfig(sw: MaterialSwatch): MaterialConfig {
  return {
    name: sw.name,
    swatchId: sw.id,
    preset: sw.preset,
    diffuse: sw.color,
    normal: sw.normal ?? '#8080ff',
    roughness: sw.roughness ?? '#b8b8b8',
    metalness: sw.metalness ?? '#101010',
    resolution: sw.resolution ?? '2K',
  };
}

/**
 * Materials shown in the sidebar list:
 * - no selection → full library
 * - selection → only materials used by the selected layer(s)
 */
export function materialsForSelection(
  library: MaterialSwatch[],
  layers: Layer[],
  selectedIds: string[],
): MaterialSwatch[] {
  if (!selectedIds.length) return library;

  const selected = layers.filter((l) => selectedIds.includes(l.id));
  if (!selected.length) return library;

  const out: MaterialSwatch[] = [];
  const seen = new Set<string>();

  for (const layer of selected) {
    const sw = matchLibrarySwatch(library, {
      swatchId: layer.material.swatchId,
      color: layer.color || layer.material.diffuse,
      preset: layer.material.preset,
    });
    if (sw) {
      if (!seen.has(sw.id)) {
        seen.add(sw.id);
        out.push(sw);
      }
      continue;
    }
    // Custom / unmatched material — still list it for the selection.
    const id = layer.material.swatchId || `layer_mat_${layer.id}`;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({
      id,
      name: resolveMaterialDisplayName(
        layer.material,
        library,
        layer.color,
      ),
      color: layer.color || layer.material.diffuse,
      preset: layer.material.preset,
      normal: layer.material.normal,
      roughness: layer.material.roughness,
      metalness: layer.material.metalness,
      resolution: layer.material.resolution,
    });
  }

  return out;
}
