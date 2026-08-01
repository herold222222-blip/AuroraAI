export type StickerCategory = 'plant' | 'people' | 'custom';

export interface StickerPreset {
  id: string;
  name: string;
  category: StickerCategory;
  /** Public URL (transparent PNG cutout). */
  src: string;
}

/** Built-in photoreal cutout assets for landscape collage. */
export const STICKER_PRESETS: StickerPreset[] = [
  {
    id: 'tree-broadleaf',
    name: '阔叶树',
    category: 'plant',
    src: '/materials/tree-broadleaf.png',
  },
  {
    id: 'tree-pine',
    name: '针叶树',
    category: 'plant',
    src: '/materials/tree-pine.png',
  },
  {
    id: 'palm',
    name: '棕榈',
    category: 'plant',
    src: '/materials/palm.png',
  },
  {
    id: 'bush',
    name: '灌木丛',
    category: 'plant',
    src: '/materials/bush.png',
  },
  {
    id: 'shrub-flower',
    name: '花灌木',
    category: 'plant',
    src: '/materials/shrub-flower.png',
  },
  {
    id: 'person-stand',
    name: '人物站立',
    category: 'people',
    src: '/materials/person-stand.png',
  },
  {
    id: 'person-walk',
    name: '人物行走',
    category: 'people',
    src: '/materials/person-walk.png',
  },
  {
    id: 'people-pair',
    name: '双人',
    category: 'people',
    src: '/materials/people-pair.png',
  },
];
