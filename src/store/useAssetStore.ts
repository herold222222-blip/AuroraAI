import { create } from 'zustand';
import { useAuthStore } from './useAuthStore';

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

const USER_IMAGE_CAP = 20;
const USER_MODEL_CAP = 2;

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

function pruneOldest(items: AssetItem[], kind: AssetKind, max: number): {
  kept: AssetItem[];
  removedIds: string[];
} {
  if (!Number.isFinite(max)) return { kept: items, removedIds: [] };
  const ofKind = items
    .filter((x) => x.kind === kind)
    .sort((a, b) => a.createdAt - b.createdAt);
  if (ofKind.length <= max) return { kept: items, removedIds: [] };
  const drop = ofKind.slice(0, ofKind.length - max).map((x) => x.id);
  const dropSet = new Set(drop);
  return {
    kept: items.filter((x) => !dropSet.has(x.id)),
    removedIds: drop,
  };
}

interface AssetState {
  items: AssetItem[];
  loaded: boolean;
  load: () => Promise<void>;
  addImageAsset: (input: {
    id?: string;
    url: string;
    label: string;
    projectId: string;
    projectName: string;
    prompt?: string;
    createdAt?: number;
  }) => Promise<AssetItem | null>;
  addModelAsset: (input: {
    id?: string;
    url: string;
    label: string;
    projectId: string;
    projectName: string;
    createdAt?: number;
  }) => Promise<AssetItem | null>;
  removeAssets: (ids: string[]) => Promise<AssetItem[]>;
  renameAsset: (id: string, label: string) => Promise<boolean>;
  counts: () => { image: number; model: number };
  limits: () => { image: number; model: number };
}

export const useAssetStore = create<AssetState>((set, get) => ({
  items: [],
  loaded: false,

  load: async () => {
    // 1) load cached items from IndexedDB
    const cached = await idbGetAll();
    cached.sort((a, b) => b.createdAt - a.createdAt);
    set({ items: cached, loaded: true });

    // 2) in background, fetch manifest from server and merge
    void (async () => {
      try {
        const res = await fetch('/api/assets/manifest');
        if (!res.ok) return;
        const data = await res.json();
        if (!data?.entries || !Array.isArray(data.entries)) return;
        const entries: any[] = data.entries;
        const mapped: AssetItem[] = entries.map((e) => ({
          id: `asset_${encodeURIComponent(e.key)}`,
          kind: e.key.endsWith('.glb') || e.key.endsWith('.gltf') ? 'model' : 'image',
          url: e.url,
          label: e.key.split('/').pop() || e.key,
          createdAt: e.lastModified ? new Date(e.lastModified).getTime() : Date.now(),
          projectId: '',
          projectName: '',
        }));

        // Merge with existing cached items: prefer cached items (local edits), add new ones
        const existing = (get().items || []) as any[];
        const existingKeys = new Set(existing.map((x) => x.url || x.id));
        const toAdd = mapped.filter((m) => !existingKeys.has(m.url));
        if (toAdd.length) {
          for (const a of toAdd) {
            try {
              await idbPut(a);
            } catch (e) {
              // ignore
            }
          }
          const all = [...toAdd, ...existing].sort((a, b) => b.createdAt - a.createdAt);
          set({ items: all });
        }
      } catch (e) {
        // ignore network errors
      }
    })();
  },

  counts: () => {
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

  addImageAsset: async (input) => {
    if (!get().loaded) await get().load();
    const existing = get().items.find(
      (x) => x.kind === 'image' && (x.id === input.id || x.url === input.url),
    );
    if (existing) return existing;

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

    let next = [item, ...get().items];
    const { kept, removedIds } = pruneOldest(next, 'image', caps().image);
    next = kept;
    try {
      await idbPut(item);
      if (removedIds.length) await idbDelete(removedIds);
    } catch (err) {
      console.error('[assets] save image failed', err);
    }
    set({ items: next.sort((a, b) => b.createdAt - a.createdAt) });
    return item;
  },

  addModelAsset: async (input) => {
    if (!get().loaded) await get().load();
    const existing = get().items.find(
      (x) => x.kind === 'model' && (x.id === input.id || x.url === input.url),
    );
    if (existing) return existing;

    const item: AssetItem = {
      id: input.id || uid('mdl'),
      kind: 'model',
      url: input.url,
      label: input.label,
      createdAt: input.createdAt ?? Date.now(),
      projectId: input.projectId,
      projectName: input.projectName,
    };

    let next = [item, ...get().items];
    const { kept, removedIds } = pruneOldest(next, 'model', caps().model);
    next = kept;
    try {
      await idbPut(item);
      if (removedIds.length) await idbDelete(removedIds);
    } catch (err) {
      console.error('[assets] save model failed', err);
    }
    set({ items: next.sort((a, b) => b.createdAt - a.createdAt) });
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
    set({ items: next });
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
    // Keep image workbench result labels in sync when ids match.
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
