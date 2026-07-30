export type StickerCategory = 'plant' | 'people' | 'custom';

export interface StickerPreset {
  id: string;
  name: string;
  category: StickerCategory;
  /** Public URL (transparent SVG/PNG). */
  src: string;
}

/** Built-in cutout assets for landscape collage. */
export const STICKER_PRESETS: StickerPreset[] = [
  {
    id: 'tree-broadleaf',
    name: '阔叶树',
    category: 'plant',
    src: '/materials/tree-broadleaf.svg',
  },
  {
    id: 'tree-pine',
    name: '针叶树',
    category: 'plant',
    src: '/materials/tree-pine.svg',
  },
  {
    id: 'palm',
    name: '棕榈',
    category: 'plant',
    src: '/materials/palm.svg',
  },
  {
    id: 'bush',
    name: '灌木丛',
    category: 'plant',
    src: '/materials/bush.svg',
  },
  {
    id: 'shrub-flower',
    name: '花灌木',
    category: 'plant',
    src: '/materials/shrub-flower.svg',
  },
  {
    id: 'person-stand',
    name: '人物站立',
    category: 'people',
    src: '/materials/person-stand.svg',
  },
  {
    id: 'person-walk',
    name: '人物行走',
    category: 'people',
    src: '/materials/person-walk.svg',
  },
  {
    id: 'people-pair',
    name: '双人',
    category: 'people',
    src: '/materials/people-pair.svg',
  },
];
