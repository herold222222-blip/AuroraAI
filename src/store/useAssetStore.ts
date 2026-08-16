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

const DB_NAME = 'aurora-assets';
const DB_VERSION = 1;
const STORE = 'items';

function uid(prefix = 'asset'): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const os = db.createObjectStore(STORE, { keyPath: 'id' });
        os.createIndex('kind', 'kind', { unique: false });
        os.createIndex('createdAt', 'createdAt', { unique: false });
        os.createIndex('projectId', 'projectId', { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('IndexedDB open failed'));
  });
}

async function idbGetAll(): Promise<AssetItem[]> {
  try {
    const db = await openDb();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).getAll();
      req.onsuccess = () => resolve((req.result || []) as AssetItem[]);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return [];
  }
}

async function idbPut(item: AssetItem): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(item);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function idbDelete(ids: string[]): Promise<void> {
  if (!ids.length) return;
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    const os = tx.objectStore(STORE);
    for (const id of ids) os.delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
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
  /** 服务端 counts 覆盖（有则优先于本地 items 统计） */
  remoteCounts: AssetCounts | null;
  load: () => Promise<void>;
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
  remoteCounts: null,

  applyRemoteCounts: (counts) => {
    set({
      remoteCounts: {
        image: Math.max(0, Number(counts.image) || 0),
        model: Math.max(0, Number(counts.model) || 0),
      },
    });
  },

  load: async () => {
    const cached = await idbGetAll();
    cached.sort((a, b) => b.createdAt - a.createdAt);
    set({ items: cached, loaded: true });

    try {
      const res = await fetch(apiUrl('/api/assets/manifest'), {
        credentials: 'include',
      });
      if (res.ok) {
        const data = await res.json();
        if (data?.entries && Array.isArray(data.entries)) {
          const entries: {
            key?: string;
            url?: string;
            lastModified?: string;
          }[] = data.entries;
          const mapped: AssetItem[] = entries.map((e) => {
            const key = String(e.key || '');
            const lower = key.toLowerCase();
            return {
              id: `asset_${encodeURIComponent(key)}`,
              kind:
                lower.endsWith('.glb') || lower.endsWith('.gltf')
                  ? 'model'
                  : 'image',
              url: String(e.url || ''),
              label: key.split('/').pop() || key,
              createdAt: e.lastModified
                ? new Date(e.lastModified).getTime()
                : Date.now(),
              projectId: '',
              projectName: '',
            };
          });
          const existing = get().items || [];
          const serverUrls = new Set(mapped.map((x) => x.url).filter(Boolean));
          const localOnly = existing.filter((x) => !serverUrls.has(x.url));
          const all = [...mapped, ...localOnly].sort(
            (a, b) => b.createdAt - a.createdAt,
          );
          set({ items: all, remoteCounts: null });
          try {
            const db = await openDb();
            const tx = db.transaction(STORE, 'readwrite');
            const os = tx.objectStore(STORE);
            const req = os.clear();
            await new Promise((r, rej) => {
              req.onsuccess = () => r(undefined);
              req.onerror = () => rej(req.error);
            });
            for (const a of all) {
              await idbPut(a);
            }
          } catch {
            /* ignore idb sync errors */
          }
        }
      }
    } catch {
      /* ignore network errors */
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

    const next = [item, ...get().items];
    try {
      await idbPut(item);
    } catch (err) {
      console.error('[assets] save image failed', err);
    }
    set({
      items: next.sort((a, b) => b.createdAt - a.createdAt),
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

    const next = [item, ...get().items];
    try {
      await idbPut(item);
    } catch (err) {
      console.error('[assets] save model failed', err);
    }
    set({
      items: next.sort((a, b) => b.createdAt - a.createdAt),
      remoteCounts: null,
    });
    return item;
  },

  removeAssets: async (ids) => {
    if (!ids.length) return [];
    const idSet = new Set(ids);
    const removed = get().items.filter((x) => idSet.has(x.id));
    const next = get().items.filter((x) => !idSet.has(x.id));
    try {
      await idbDelete(ids);
    } catch (err) {
      console.error('[assets] delete failed', err);
    }
    set({ items: next, remoteCounts: null });
    return removed;
  },

  renameAsset: async (id, label) => {
    const nextLabel = label.trim();
    if (!nextLabel) return false;
    const item = get().items.find((x) => x.id === id);
    if (!item || item.label === nextLabel) return false;
    const updated: AssetItem = { ...item, label: nextLabel };
    try {
      await idbPut(updated);
    } catch (err) {
      console.error('[assets] rename failed', err);
      return false;
    }
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

function isAssetableUrl(url: string | null | undefined): url is string {
  if (!url) return false;
  if (url.startsWith('blob:')) return false;
  if (url.startsWith('asset:')) return false;
  if (url.startsWith('oss:')) return false;
  return (
    url.startsWith('data:') ||
    url.startsWith('http://') ||
    url.startsWith('https://')
  );
}

/**
 * 云端/切换项目时：改图袋里有图，但资产库是本机 IndexedDB，不会自动带上。
 * 把项目袋中的图片/模型补登记到资产（按 url 去重）；达上限则停止继续登记。
 */
export async function syncProjectBagToAssets(
  bag: {
    image: {
      originalUrl?: string | null;
      currentUrl?: string | null;
      materials?: { id: string; url: string }[];
      savedImages?: {
        id: string;
        url: string;
        label: string;
        createdAt: number;
        prompt?: string;
      }[];
      sourceAlbums?: {
        id: string;
        url: string;
        label: string;
        createdAt: number;
        results?: {
          id: string;
          url: string;
          label: string;
          createdAt: number;
          prompt?: string;
        }[];
      }[];
    };
    model: { meshyModelUrl?: string | null };
  },
  projectId: string,
  projectName: string,
) {
  const store = useAssetStore.getState();
  if (!store.loaded) await store.load();

  type Cand = {
    id?: string;
    url: string;
    label: string;
    createdAt?: number;
    prompt?: string;
  };
  const candidates: Cand[] = [];
  const seen = new Set(
    store.items.filter((x) => x.kind === 'image').map((x) => x.url),
  );

  const push = (c: Cand) => {
    if (!isAssetableUrl(c.url)) return;
    if (seen.has(c.url)) return;
    seen.add(c.url);
    candidates.push(c);
  };

  const img = bag.image;
  for (const s of img.savedImages || []) {
    push({
      id: s.id,
      url: s.url,
      label: s.label || '结果',
      createdAt: s.createdAt,
      prompt: s.prompt,
    });
  }
  for (const a of img.sourceAlbums || []) {
    push({
      id: a.id,
      url: a.url,
      label: a.label || '原图',
      createdAt: a.createdAt,
    });
    for (const r of a.results || []) {
      push({
        id: r.id,
        url: r.url,
        label: r.label || '结果',
        createdAt: r.createdAt,
        prompt: r.prompt,
      });
    }
  }
  push({ url: img.originalUrl || '', label: '原图' });
  push({ url: img.currentUrl || '', label: '当前图' });
  for (const m of img.materials || []) {
    push({ id: m.id, url: m.url, label: '素材' });
  }

  for (const c of candidates) {
    const added = await store.addImageAsset({
      ...c,
      projectId,
      projectName,
    });
    if (!added && store.counts().image >= store.limits().image) break;
  }

  const modelUrl = bag.model?.meshyModelUrl;
  if (isAssetableUrl(modelUrl)) {
    await store.addModelAsset({
      url: modelUrl,
      label: `${projectName || '项目'} · 3D`,
      projectId,
      projectName,
    });
  }
}
