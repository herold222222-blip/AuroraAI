import { create } from 'zustand';
import { apiUrl } from '../config/api';
import { useAuthStore } from './useAuthStore';
import {
  USER_IMAGE_CAP,
  USER_MODEL_CAP,
  type AssetCounts,
} from './assetCaps';

export type AssetKind = 'image' | 'model';

export interface AssetItem {
  id: string;
  kind: AssetKind;
  url: string;
  label: string;
  createdAt: number;
  projectId: string;
  projectName: string;
  prompt?: string;
}

function uid(prefix = 'asset'): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function caps() {
  const admin = useAuthStore.getState().isAdmin();
  return {
    image: admin ? Infinity : USER_IMAGE_CAP,
    model: admin ? Infinity : USER_MODEL_CAP,
  };
}

interface AssetState {
  items: AssetItem[];
  loaded: boolean;
  loading: boolean;
  remoteCounts: AssetCounts | null;
  /** 仅从数据库 /api/assets 拉取；切换项目/用户时调用 */
  load: (opts?: { projectId?: string }) => Promise<void>;
  clear: () => void;
  applyRemoteCounts: (counts: AssetCounts) => void;
  addImageAsset: (
    input: {
      id?: string;
      url: string;
      label: string;
      projectId: string;
      projectName: string;
      prompt?: string;
      createdAt?: number;
    },
    opts?: { skipQuota?: boolean },
  ) => Promise<AssetItem | null>;
  addModelAsset: (
    input: {
      id?: string;
      url: string;
      label: string;
      projectId: string;
      projectName: string;
      createdAt?: number;
    },
    opts?: { skipQuota?: boolean },
  ) => Promise<AssetItem | null>;
  removeAssets: (ids: string[]) => Promise<AssetItem[]>;
  renameAsset: (id: string, label: string) => Promise<boolean>;
  counts: () => AssetCounts;
  limits: () => { image: number; model: number };
}

export const useAssetStore = create<AssetState>((set, get) => ({
  items: [],
  loaded: false,
  loading: false,
  remoteCounts: null,

  applyRemoteCounts: (counts) => {
    set({
      remoteCounts: {
        image: Math.max(0, Number(counts.image) || 0),
        model: Math.max(0, Number(counts.model) || 0),
      },
    });
  },

  clear: () => {
    set({ items: [], loaded: true, loading: false, remoteCounts: null });
  },

  load: async (opts) => {
    const token = useAuthStore.getState().token;
    if (!token) {
      set({ items: [], loaded: true, loading: false, remoteCounts: null });
      return;
    }
    set({ loading: true });
    try {
      const q = opts?.projectId
        ? `?projectId=${encodeURIComponent(opts.projectId)}`
        : '';
      const res = await fetch(apiUrl(`/api/assets${q}`), {
        headers: { Authorization: `Bearer ${token}` },
        credentials: 'include',
      });
      if (res.status === 401) {
        set({ items: [], loaded: true, loading: false, remoteCounts: null });
        return;
      }
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(
          (err as { error?: string }).error || `资产加载失败（${res.status}）`,
        );
      }
      const data = (await res.json()) as {
        entries?: AssetItem[];
        counts?: AssetCounts;
      };
      const entries = Array.isArray(data.entries) ? data.entries : [];
      const items: AssetItem[] = entries
        .map((e): AssetItem => ({
          id: String(e.id || uid(e.kind === 'model' ? 'mdl' : 'img')),
          kind: e.kind === 'model' ? ('model' as const) : ('image' as const),
          url: String(e.url || ''),
          label: String(e.label || ''),
          createdAt: Number(e.createdAt) || Date.now(),
          projectId: String(e.projectId || ''),
          projectName: String(e.projectName || ''),
          prompt: e.prompt ? String(e.prompt) : undefined,
        }))
        .filter((x) => x.url)
        .sort((a, b) => b.createdAt - a.createdAt);
      set({
        items,
        loaded: true,
        loading: false,
        remoteCounts: data.counts
          ? {
              image: Number(data.counts.image) || 0,
              model: Number(data.counts.model) || 0,
            }
          : null,
      });
    } catch (e) {
      console.error('[assets] load from db', e);
      set({ loaded: true, loading: false });
    }
  },

  counts: () => {
    const remote = get().remoteCounts;
    if (remote) return { ...remote };
    const items = get().items;
    return {
      image: items.filter((x) => x.kind === 'image').length,
      model: items.filter((x) => x.kind === 'model').length,
    };
  },

  limits: () => {
    const c = caps();
    return {
      image: Number.isFinite(c.image) ? c.image : Number.POSITIVE_INFINITY,
      model: Number.isFinite(c.model) ? c.model : Number.POSITIVE_INFINITY,
    };
  },

  addImageAsset: async (input, opts) => {
    if (!get().loaded) await get().load();
    const existing = get().items.find(
      (x) => x.kind === 'image' && (x.id === input.id || x.url === input.url),
    );
    if (existing) return existing;

    if (!opts?.skipQuota) {
      const lim = get().limits();
      const c = get().counts();
      if (c.image >= lim.image) return null;
    }

    const item: AssetItem = {
      id: input.id || uid('img'),
      kind: 'image',
      url: input.url,
      label: input.label,
      createdAt: input.createdAt ?? Date.now(),
      projectId: input.projectId,
      projectName: input.projectName,
      prompt: input.prompt,
    };

    set({
      items: [item, ...get().items].sort((a, b) => b.createdAt - a.createdAt),
      remoteCounts: null,
    });
    return item;
  },

  addModelAsset: async (input, opts) => {
    if (!get().loaded) await get().load();
    const existing = get().items.find(
      (x) => x.kind === 'model' && (x.id === input.id || x.url === input.url),
    );
    if (existing) return existing;

    if (!opts?.skipQuota) {
      const lim = get().limits();
      const c = get().counts();
      if (c.model >= lim.model) return null;
    }

    const item: AssetItem = {
      id: input.id || uid('mdl'),
      kind: 'model',
      url: input.url,
      label: input.label,
      createdAt: input.createdAt ?? Date.now(),
      projectId: input.projectId,
      projectName: input.projectName,
    };

    set({
      items: [item, ...get().items].sort((a, b) => b.createdAt - a.createdAt),
      remoteCounts: null,
    });
    return item;
  },

  removeAssets: async (ids) => {
    if (!ids.length) return [];
    const idSet = new Set(ids);
    const removed = get().items.filter((x) => idSet.has(x.id));
    const next = get().items.filter((x) => !idSet.has(x.id));
    set({ items: next, remoteCounts: null });
    return removed;
  },

  renameAsset: async (id, label) => {
    const nextLabel = label.trim();
    if (!nextLabel) return false;
    const item = get().items.find((x) => x.id === id);
    if (!item || item.label === nextLabel) return false;
    const updated: AssetItem = { ...item, label: nextLabel };
    set({
      items: get().items.map((x) => (x.id === id ? updated : x)),
    });
    void import('../image/useImageStore').then(({ useImageStore }) => {
      try {
        useImageStore.getState().renameSavedImage(id, nextLabel);
      } catch {
        /* ignore */
      }
    });
    return true;
  },
}));

/** 登录/切用户/切项目后：强制从数据库刷新资产 */
export async function reloadAssetsFromDatabase(opts?: {
  projectId?: string;
}) {
  await useAssetStore.getState().load(opts);
}

/** Fire-and-forget helper used from image/model stores. */
export function registerGeneratedImage(input: {
  id?: string;
  url: string;
  label: string;
  prompt?: string;
  createdAt?: number;
}) {
  void import('./useAppStore').then(({ useAppStore }) => {
    const app = useAppStore.getState();
    void useAssetStore.getState().addImageAsset({
      ...input,
      projectId: app.activeProjectId,
      projectName: app.projectName,
    });
  });
}

export function registerGeneratedModel(input: {
  id?: string;
  url: string;
  label: string;
  createdAt?: number;
}) {
  void import('./useAppStore').then(({ useAppStore }) => {
    const app = useAppStore.getState();
    void useAssetStore.getState().addModelAsset({
      ...input,
      projectId: app.activeProjectId,
      projectName: app.projectName,
    });
  });
}

/**
 * @deprecated 资产以数据库为准；保留空实现以免旧调用报错。
 */
export async function syncProjectBagToAssets(
  _bag: unknown,
  _projectId: string,
  _projectName: string,
) {
  await reloadAssetsFromDatabase();
}
