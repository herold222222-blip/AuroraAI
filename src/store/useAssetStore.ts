import { create } from 'zustand';
import { apiDeleteAssets, apiSaveAsset } from '../api/assetsApi';
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
  pendingSync?: boolean;
}

function normalizeAssetUrl(url: string): string {
  const raw = String(url || '');
  if (!raw) return raw;
  try {
    const u = new URL(raw, window.location.origin);
    const key = decodeURIComponent(u.searchParams.get('key') || '').replace(/^\//, '');
    if (/^asset_/i.test(key) || raw.startsWith('asset:') || /^asset_/i.test(raw)) return '';
    if (
      /\/api\/projects\/media$/i.test(u.pathname) &&
      /^assets\//i.test(key)
    ) {
      u.pathname = u.pathname.replace(/\/api\/projects\/media$/i, '/api/assets/media');
      return u.toString();
    }
    return raw;
  } catch {
    return /^asset_/i.test(raw) || raw.startsWith('asset:') ? '' : raw;
  }
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
  loadSeq: number;
  /** 仅从数据库 /api/assets 拉取；切换项目/用户时调用 */
  load: (opts?: { projectId?: string }) => Promise<void>;
  clear: () => void;
  resetForUserSwitch: () => void;
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
  loadSeq: 0,

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

  resetForUserSwitch: () => {
    set((state) => ({
      items: [],
      loaded: false,
      loading: true,
      remoteCounts: null,
      loadSeq: state.loadSeq + 1,
    }));
  },

  load: async (opts) => {
    const token = useAuthStore.getState().token;
    void import('./useAppStore').then(({ useAppStore }) => {
      useAppStore.getState().setCloudSyncStatus('syncing', '正在加载当前用户资产…');
    });
    if (!token) {
      set((state) => ({
        items: [],
        loaded: true,
        loading: false,
        remoteCounts: null,
        loadSeq: state.loadSeq + 1,
      }));
      return;
    }
    const seq = get().loadSeq + 1;
    set({ loading: true, loaded: false, loadSeq: seq });
    try {
      const q = opts?.projectId
        ? `?projectId=${encodeURIComponent(opts.projectId)}`
        : '';
      const res = await fetch(apiUrl(`/api/assets${q}`), {
        headers: { Authorization: `Bearer ${token}` },
        credentials: 'include',
      });
      if (get().loadSeq !== seq) return;
      if (res.status === 401) {
        set({ items: [], loaded: true, loading: false, remoteCounts: null });
        void import('./useAppStore').then(({ useAppStore }) => {
          useAppStore.getState().setCloudSyncStatus('error', '资产鉴权失效，请重新登录');
        });
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
      if (get().loadSeq !== seq) return;
      const entries = Array.isArray(data.entries) ? data.entries : [];
      const items: AssetItem[] = entries
        .map((e): AssetItem => ({
          id: String(e.id || uid(e.kind === 'model' ? 'mdl' : 'img')),
          kind: e.kind === 'model' ? ('model' as const) : ('image' as const),
          url: normalizeAssetUrl(String(e.url || '')),
          label: String(e.label || ''),
          createdAt: Number(e.createdAt) || Date.now(),
          projectId: String(e.projectId || ''),
          projectName: String(e.projectName || ''),
          prompt: e.prompt ? String(e.prompt) : undefined,
          pendingSync: false,
        }))
        .filter((x) => x.url && !/key=asset_/i.test(x.url));
      const pending = get().items.filter((x) => x.pendingSync);
      const currentById = new Map(get().items.map((x) => [x.id, x]));
      const merged = items.map((x) => {
        const cur = currentById.get(x.id);
        return cur ? { ...x, url: normalizeAssetUrl(x.url || cur.url) } : x;
      });
      const seen = new Set(merged.map((x) => `${x.id}::${x.url}`));
      for (const item of pending) {
        const key = `${item.id}::${item.url}`;
        if (seen.has(key)) continue;
        seen.add(key);
        merged.push(item);
      }
      merged.sort((a, b) => b.createdAt - a.createdAt);
      set({
        items: merged,
        loaded: true,
        loading: false,
        remoteCounts: data.counts
          ? {
              image: Number(data.counts.image) || 0,
              model: Number(data.counts.model) || 0,
            }
          : null,
      });
      void import('./useAppStore').then(({ useAppStore }) => {
        useAppStore.getState().setCloudSyncStatus('success', '当前用户资产已同步');
      });
    } catch (e) {
      console.error('[assets] load from db', e);
      if (get().loadSeq !== seq) return;
      const msg = e instanceof Error ? e.message : '资产加载失败';
      set({ items: get().items.filter((x) => x.pendingSync), loaded: true, loading: false, remoteCounts: null });
      void import('./useAppStore').then(({ useAppStore }) => {
        useAppStore.getState().setCloudSyncStatus(
          'error',
          /UserDisable/i.test(msg)
            ? '当前账号访问资产服务受限，请联系管理员'
            : msg,
        );
      });
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
      pendingSync: true,
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
    const token = useAuthStore.getState().token;
    const idSet = new Set(ids);
    const removed = get().items.filter((x) => idSet.has(x.id));
    const next = get().items.filter((x) => !idSet.has(x.id));
    set({ items: next, remoteCounts: null });
    try {
      if (token) await apiDeleteAssets(ids, token);
    } catch (err) {
      set({ items: get().items.concat(removed).sort((a, b) => b.createdAt - a.createdAt) });
      throw err;
    }
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
  void Promise.all([
    import('./useAppStore'),
    import('./projectBag'),
  ]).then(([{ useAppStore }, { isScratchProjectId }]) => {
    void (async () => {
      try {
        const app = useAppStore.getState();
        const formal = !isScratchProjectId(app.activeProjectId);
        const token = useAuthStore.getState().token;
        const projectId = formal ? app.activeProjectId : '';
        const projectName = formal ? app.projectName : '';

        const added = await useAssetStore.getState().addImageAsset({
          ...input,
          projectId,
          projectName,
        });
        if (!added) return;

        if (token) {
          console.info('[assets] registerGeneratedImage', {
            id: input.id,
            url: input.url,
            label: input.label,
            projectId,
            projectName,
          });
          const remote = await apiSaveAsset(
            {
              ...input,
              kind: 'image',
              projectId,
              projectName,
            },
            token,
          );
          console.info('[assets] registerGeneratedImage remote', remote);
          const remoteUrl = normalizeAssetUrl(remote.url);
          useAssetStore.setState({
            items: [
              {
                ...remote,
                url: remoteUrl || input.url,
                pendingSync: false,
              },
              ...useAssetStore
                .getState()
                .items.filter((x) => x.id !== remote.id),
            ].sort((a, b) => b.createdAt - a.createdAt),
            remoteCounts: null,
          });
          await useAssetStore.getState().load();
        }
      } catch (err) {
        useAppStore.getState().pushToast(
          err instanceof Error ? err.message : '资产自动保存失败',
          'error',
        );
        void useAssetStore.getState().addImageAsset(
          {
            ...input,
            projectId: '',
            projectName: '',
          },
          { skipQuota: true },
        );
      }
    })();
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
