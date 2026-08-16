import { apiUrl } from '../config/api';
import {
  MSG_IMAGE_CAP,
  MSG_MODEL_CAP,
  type AssetCounts,
  type AssetLimits,
} from './assetCaps';
import { useAssetStore } from './useAssetStore';
import { useAppStore } from './useAppStore';

export {
  USER_IMAGE_CAP,
  USER_MODEL_CAP,
  MSG_IMAGE_CAP,
  MSG_MODEL_CAP,
} from './assetCaps';
export type { AssetCounts, AssetLimits } from './assetCaps';

/** 拉取服务端轻量计数并刷新本地资产列表，返回最新 counts */
export async function refreshAssetCounts(): Promise<AssetCounts> {
  const store = useAssetStore.getState();
  try {
    await store.load();
  } catch {
    /* keep cached */
  }
  try {
    const res = await fetch(apiUrl('/api/assets/counts'), {
      credentials: 'include',
    });
    if (res.ok) {
      const data = (await res.json()) as {
        ok?: boolean;
        counts?: AssetCounts;
      };
      if (data?.counts) {
        store.applyRemoteCounts(data.counts);
      }
    }
  } catch {
    /* ignore network */
  }
  return store.counts();
}

export function getAssetLimits(): AssetLimits {
  return useAssetStore.getState().limits();
}

export function isImageAtCap(
  counts?: AssetCounts,
  limits?: AssetLimits,
): boolean {
  const c = counts ?? useAssetStore.getState().counts();
  const l = limits ?? useAssetStore.getState().limits();
  return c.image >= l.image;
}

export function isModelAtCap(
  counts?: AssetCounts,
  limits?: AssetLimits,
): boolean {
  const c = counts ?? useAssetStore.getState().counts();
  const l = limits ?? useAssetStore.getState().limits();
  return c.model >= l.model;
}

function toast(msg: string) {
  useAppStore.getState().pushToast(msg, 'info');
}

/** 上传新图 / 导入原图前：刷新计数，超限则提示并返回 false */
export async function ensureCanUploadImage(): Promise<boolean> {
  const counts = await refreshAssetCounts();
  if (isImageAtCap(counts)) {
    toast(MSG_IMAGE_CAP);
    return false;
  }
  return true;
}

/** AI 改图前：刷新计数，超限则提示并返回 false */
export async function ensureCanEditImage(): Promise<boolean> {
  const counts = await refreshAssetCounts();
  if (isImageAtCap(counts)) {
    toast(MSG_IMAGE_CAP);
    return false;
  }
  return true;
}

/** 图生模型前：刷新计数，超限则提示并返回 false */
export async function ensureCanAddModel(): Promise<boolean> {
  const counts = await refreshAssetCounts();
  if (isModelAtCap(counts)) {
    toast(MSG_MODEL_CAP);
    return false;
  }
  return true;
}
