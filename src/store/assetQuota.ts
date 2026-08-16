import { apiUrl } from '../config/api';
import {
  MSG_IMAGE_CAP,
  MSG_MODEL_CAP,
  type AssetCounts,
  type AssetLimits,
} from './assetCaps';
import { useAssetStore } from './useAssetStore';
import { useAppStore } from './useAppStore';
import { useAuthStore } from './useAuthStore';

export {
  USER_IMAGE_CAP,
  USER_MODEL_CAP,
  MSG_IMAGE_CAP,
  MSG_MODEL_CAP,
} from './assetCaps';
export type { AssetCounts, AssetLimits } from './assetCaps';

/** 从数据库刷新资产并返回 counts */
export async function refreshAssetCounts(): Promise<AssetCounts> {
  const store = useAssetStore.getState();
  const token = useAuthStore.getState().token;
  if (!token) {
    store.clear();
    return { image: 0, model: 0 };
  }
  try {
    await store.load();
  } catch {
    /* keep previous */
  }
  try {
    const res = await fetch(apiUrl('/api/assets/counts'), {
      headers: { Authorization: `Bearer ${token}` },
      credentials: 'include',
    });
    if (res.ok) {
      const data = (await res.json()) as {
        ok?: boolean;
        counts?: AssetCounts;
        source?: string;
      };
      if (data?.counts && data.source === 'database') {
        store.applyRemoteCounts(data.counts);
      }
    }
  } catch {
    /* ignore */
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

export async function ensureCanUploadImage(): Promise<boolean> {
  const counts = await refreshAssetCounts();
  if (isImageAtCap(counts)) {
    toast(MSG_IMAGE_CAP);
    return false;
  }
  return true;
}

export async function ensureCanEditImage(): Promise<boolean> {
  const counts = await refreshAssetCounts();
  if (isImageAtCap(counts)) {
    toast(MSG_IMAGE_CAP);
    return false;
  }
  return true;
}

export async function ensureCanAddModel(): Promise<boolean> {
  const counts = await refreshAssetCounts();
  if (isModelAtCap(counts)) {
    toast(MSG_MODEL_CAP);
    return false;
  }
  return true;
}
