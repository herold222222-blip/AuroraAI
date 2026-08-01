export type ConstructionPracticeId =
  | 'pedestrian-estate'
  | 'pedestrian-municipal'
  | 'vehicular';

export interface ConstructionPractice {
  id: ConstructionPracticeId;
  label: string;
  detailSrc: string;
  diagram3dSrc: string;
  detailCaption: string;
  diagram3dCaption: string;
}

export const CONSTRUCTION_PRACTICES: ConstructionPractice[] = [
  {
    id: 'pedestrian-estate',
    label: '人行铺装做法（地产）',
    detailSrc: '/construction/pedestrian-estate-detail.png',
    diagram3dSrc: '/construction/pedestrian-estate-3d.png',
    detailCaption: '附图2 · 构造大样',
    diagram3dCaption: '实景三维图解',
  },
  {
    id: 'pedestrian-municipal',
    label: '人行铺装做法（市镇）',
    detailSrc: '/construction/pedestrian-municipal-detail.png',
    diagram3dSrc: '/construction/pedestrian-municipal-3d.png',
    detailCaption: '附图3 · 构造大样',
    diagram3dCaption: '实景三维图解',
  },
  {
    id: 'vehicular',
    label: '车行铺装做法',
    detailSrc: '/construction/vehicular-detail.png',
    diagram3dSrc: '/construction/vehicular-3d.png',
    detailCaption: '附图4 · 构造大样',
    diagram3dCaption: '实景三维图解',
  },
];
