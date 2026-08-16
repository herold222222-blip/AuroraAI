/** 普通用户资产上限（管理员无上限，见 useAssetStore.limits） */
export const USER_IMAGE_CAP = 20;
export const USER_MODEL_CAP = 2;

export const MSG_IMAGE_CAP =
  '图片数量已达上限（20 张），无法继续上传或 AI 改图。请到「资产」删除部分图片后重试。';

export const MSG_MODEL_CAP =
  '模型数量已达上限（2 个），无法继续生成三维模型。请到「资产」删除旧模型后重试。';

export type AssetCounts = { image: number; model: number };
export type AssetLimits = { image: number; model: number };
