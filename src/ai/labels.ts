import type { Dimension, Layer } from '../types';

export type CategoryKey =
  | 'ground'
  | 'vegetation'
  | 'water'
  | 'building'
  | 'road'
  | 'hardscape'
  | 'mountain'
  | 'furniture'
  | 'sky'
  | 'misc';

export interface CategoryDef {
  key: CategoryKey;
  display: string;
  color: string;
  kind: Layer['kind'];
  dimension: Dimension;
  /** base extrusion height in scene units */
  baseHeight: number;
  materialPreset: string;
}

export const CATEGORY_DEFS: Record<CategoryKey, CategoryDef> = {
  ground: {
    key: 'ground',
    display: '地形基底',
    color: '#7CC28C',
    kind: 'ground',
    dimension: '3D',
    baseHeight: 0.18,
    materialPreset: '草坪 / 软质地被',
  },
  vegetation: {
    key: 'vegetation',
    display: '植被组团',
    color: '#2E8B57',
    kind: 'vegetation',
    dimension: '3D',
    baseHeight: 0.95,
    materialPreset: '乔木 / 组团绿化',
  },
  water: {
    key: 'water',
    display: '水体',
    color: '#3FA9F5',
    kind: 'water',
    dimension: '3D',
    baseHeight: 0.1,
    materialPreset: '静水 / 镜面水体',
  },
  building: {
    key: 'building',
    display: '建筑构筑物',
    color: '#F5A623',
    kind: 'building',
    dimension: '3D',
    baseHeight: 2.0,
    materialPreset: '混凝土 / 白模体块',
  },
  road: {
    key: 'road',
    display: '道路铺装',
    color: '#C9A46B',
    kind: 'path',
    dimension: '3D',
    baseHeight: 0.14,
    materialPreset: '透水铺装',
  },
  hardscape: {
    key: 'hardscape',
    display: '硬质景观',
    color: '#B0A8C9',
    kind: 'generic',
    dimension: '3D',
    baseHeight: 0.3,
    materialPreset: '花岗岩铺装',
  },
  mountain: {
    key: 'mountain',
    display: '地形山体',
    color: '#9C8B7A',
    kind: 'ground',
    dimension: '3D',
    baseHeight: 2.4,
    materialPreset: '土石 / 微地形',
  },
  furniture: {
    key: 'furniture',
    display: '家具陈设',
    color: '#E09B5A',
    kind: 'generic',
    dimension: '3D',
    baseHeight: 0.6,
    materialPreset: '通用材质',
  },
  sky: {
    key: 'sky',
    display: '天空背景',
    color: '#BFE3FF',
    kind: 'sky',
    dimension: '2D',
    baseHeight: 0,
    materialPreset: '背景',
  },
  misc: {
    key: 'misc',
    display: '其他元素',
    color: '#8FA0B3',
    kind: 'generic',
    dimension: '3D',
    baseHeight: 0.4,
    materialPreset: '通用材质',
  },
};

/**
 * Keyword rules mapping ADE20K class label strings (which may be comma lists,
 * e.g. "earth, ground") to our landscape categories. Scanned in order; first
 * keyword contained in the (lowercased) label wins.
 */
const RULES: [string, CategoryKey][] = [
  // sky
  ['sky', 'sky'],
  // water (specific before generic)
  ['waterfall', 'water'],
  ['fountain', 'water'],
  ['swimming', 'water'],
  ['pool', 'water'],
  ['water', 'water'],
  ['sea', 'water'],
  ['river', 'water'],
  ['lake', 'water'],
  // vegetation
  ['tree', 'vegetation'],
  ['palm', 'vegetation'],
  ['plant', 'vegetation'],
  ['flower', 'vegetation'],
  ['bush', 'vegetation'],
  ['hedge', 'vegetation'],
  ['shrub', 'vegetation'],
  // furniture / interior objects & fixtures (before structural to catch
  // "coffee table", "kitchen island", etc.)
  ['coffee table', 'furniture'],
  ['kitchen island', 'furniture'],
  ['chest', 'furniture'],
  ['drawers', 'furniture'],
  ['wardrobe', 'furniture'],
  ['cabinet', 'furniture'],
  ['bookcase', 'furniture'],
  ['shelf', 'furniture'],
  ['bed', 'furniture'],
  ['sofa', 'furniture'],
  ['armchair', 'furniture'],
  ['swivel chair', 'furniture'],
  ['chair', 'furniture'],
  ['stool', 'furniture'],
  ['ottoman', 'furniture'],
  ['bench', 'furniture'],
  ['seat', 'furniture'],
  ['table', 'furniture'],
  ['desk', 'furniture'],
  ['counter', 'furniture'],
  ['buffet', 'furniture'],
  ['sink', 'furniture'],
  ['toilet', 'furniture'],
  ['bathtub', 'furniture'],
  ['shower', 'furniture'],
  ['stove', 'furniture'],
  ['oven', 'furniture'],
  ['microwave', 'furniture'],
  ['refrigerator', 'furniture'],
  ['dishwasher', 'furniture'],
  ['washer', 'furniture'],
  ['fireplace', 'furniture'],
  ['television', 'furniture'],
  ['monitor', 'furniture'],
  ['computer', 'furniture'],
  ['screen', 'furniture'],
  ['lamp', 'furniture'],
  ['chandelier', 'furniture'],
  ['sconce', 'furniture'],
  ['light', 'furniture'],
  ['fan', 'furniture'],
  ['radiator', 'furniture'],
  ['curtain', 'furniture'],
  ['blind', 'furniture'],
  ['cushion', 'furniture'],
  ['pillow', 'furniture'],
  ['carpet', 'furniture'],
  ['rug', 'furniture'],
  ['mirror', 'furniture'],
  ['painting', 'furniture'],
  ['poster', 'furniture'],
  ['sculpture', 'furniture'],
  ['vase', 'furniture'],
  ['clock', 'furniture'],
  ['book', 'furniture'],
  ['apparel', 'furniture'],
  // building / structural
  ['skyscraper', 'building'],
  ['building', 'building'],
  ['house', 'building'],
  ['tower', 'building'],
  ['hovel', 'building'],
  ['hut', 'building'],
  ['booth', 'building'],
  ['windowpane', 'building'],
  ['window', 'building'],
  ['door', 'building'],
  ['ceiling', 'building'],
  ['wall', 'building'],
  ['column', 'building'],
  ['pillar', 'building'],
  ['awning', 'building'],
  ['canopy', 'building'],
  // roads / paved circulation
  ['sidewalk', 'road'],
  ['pavement', 'road'],
  ['runway', 'road'],
  ['crosswalk', 'road'],
  ['dirt track', 'road'],
  ['road', 'road'],
  ['path', 'road'],
  ['street', 'road'],
  // mountain / rock
  ['mountain', 'mountain'],
  ['hill', 'mountain'],
  ['cliff', 'mountain'],
  ['rock', 'mountain'],
  ['stone', 'mountain'],
  // hardscape (built horizontal / edge elements)
  ['bridge', 'hardscape'],
  ['stairway', 'hardscape'],
  ['stairs', 'hardscape'],
  ['step', 'hardscape'],
  ['escalator', 'hardscape'],
  ['floor', 'hardscape'],
  ['fence', 'hardscape'],
  ['railing', 'hardscape'],
  ['bannister', 'hardscape'],
  ['stage', 'hardscape'],
  ['platform', 'hardscape'],
  ['pier', 'hardscape'],
  // ground / terrain
  ['grass', 'ground'],
  ['earth', 'ground'],
  ['ground', 'ground'],
  ['field', 'ground'],
  ['land', 'ground'],
  ['sand', 'ground'],
  ['dirt', 'ground'],
  ['soil', 'ground'],
];

/**
 * Map an ADE20K class label to a landscape/architecture category. Any label not
 * covered by an explicit rule falls back to `misc` so that a genuinely detected
 * element is never silently discarded from the segmentation.
 */
export function categoryForLabel(label: string): CategoryKey {
  const l = label.toLowerCase();
  for (const [kw, cat] of RULES) {
    if (l.includes(kw)) return cat;
  }
  return 'misc';
}

/** display order for the layer list (top → detail) */
export const CATEGORY_ORDER: CategoryKey[] = [
  'building',
  'furniture',
  'vegetation',
  'water',
  'mountain',
  'hardscape',
  'road',
  'ground',
  'misc',
  'sky',
];
