import { create } from 'zustand';
import type { Crop } from 'react-image-crop';
import { compressDataUrl } from './padImage';
import {
  flattenOverlaysOntoImage,
  measureSticker,
  type ImageOverlay,
} from './overlayCompose';

export type { ImageOverlay };

export type ImageEditorTab =
  | 'retouch'
  | 'crop'
  | 'adjust'
  | 'filter'
  | 'style';

export type RetouchTool = 'select' | 'point' | 'brush' | 'eraser';

export interface HotspotPoint {
  id: string;
  /** 1-based display number, always contiguous after edits */
  n: number;
  x: number;
  y: number;
  prompt: string;
}

/** Independent connected brush region */
export interface BrushRegion {
  id: string;
  n: number;
  prompt: string;
  /** Natural-resolution white/black PNG mask */
  maskDataUrl: string;
  cx: number;
  cy: number;
}

export interface MaterialItem {
  id: string;
  url: string;
  selected: boolean;
}

export interface CustomStyle {
  id: string;
  name: string;
  prompt: string;
  refs: string[];
}

export interface SavedEditImage {
  id: string;
  url: string;
  label: string;
  createdAt: number;
  sourceSnapshotId?: string;
  /** Prompt used when this result was generated (for 重新生成). */
  prompt?: string;
}

/** One uploaded / synced original + its generation results. */
export interface SourceAlbum {
  id: string;
  url: string;
  label: string;
  createdAt: number;
  results: SavedEditImage[];
  /** When set, this album came from a 3D model snapshot. */
  sourceSnapshotId?: string;
}

interface HistorySnap {
  url: string;
}

const CUSTOM_STYLE_KEY = 'aurora-custom-styles';

function loadStyles(): CustomStyle[] {
  try {
    const raw = localStorage.getItem(CUSTOM_STYLE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as CustomStyle[];
  } catch {
    return [];
  }
}

function saveStyles(list: CustomStyle[]) {
  try {
    localStorage.setItem(CUSTOM_STYLE_KEY, JSON.stringify(list));
  } catch {
    /* quota */
  }
}

function uid(prefix: string) {
  return `${prefix}_${Math.random().toString(36).slice(2, 9)}`;
}

/** Create a new 原图 album from a url and focus it for editing. */
function promoteUrlAsNewAlbum(
  get: () => ImageState,
  set: (
    partial:
      | Partial<ImageState>
      | ((state: ImageState) => Partial<ImageState>),
  ) => void,
  url: string,
  labelHint?: string,
): boolean {
  if (!url) return false;
  const existing = get().sourceAlbums.find((a) => a.url === url);
  if (existing) {
    get().openSourceAlbum(existing.id);
    return true;
  }
  const n = get().sourceAlbums.length + 1;
  const fromResult =
    labelHint && !/^结果\s*\d+$/i.test(labelHint.trim())
      ? labelHint.trim()
      : null;
  const album: SourceAlbum = {
    id: uid('src'),
    url,
    label: fromResult || `原图 ${n}`,
    createdAt: Date.now(),
    results: [],
  };
  set({
    sourceAlbums: [...get().sourceAlbums, album],
    activeSourceId: album.id,
    sourceSidebarMode: 'detail',
    originalUrl: url,
    currentUrl: url,
    sourceSnapshotId: null,
    savedImages: [],
    past: [],
    future: [],
    compareBeforeUrl: null,
    showCompare: false,
    hotspots: [],
    brushRegions: [],
    hasMask: false,
    overlays: [],
    selectedOverlayId: null,
    cropSelection: undefined,
    tab: 'retouch',
  });
  return true;
}

function renumber(list: HotspotPoint[]): HotspotPoint[] {
  return list.map((p, i) => ({ ...p, n: i + 1 }));
}

function renumberBrush(list: BrushRegion[]): BrushRegion[] {
  return list.map((p, i) => ({ ...p, n: i + 1 }));
}

interface ImageState {
  originalUrl: string | null;
  currentUrl: string | null;
  sourceSnapshotId: string | null;
  compareBeforeUrl: string | null;
  showCompare: boolean;

  tab: ImageEditorTab;
  retouchTool: RetouchTool;
  brushSize: number;
  /** Multi-point selection for local retouch (numbered). */
  hotspots: HotspotPoint[];
  /** Independent brush stroke regions (numbered). */
  brushRegions: BrushRegion[];
  hasMask: boolean;
  busy: boolean;
  prompt: string;

  cropAspect: number | undefined;
  cropSelection: Crop | undefined;

  materials: MaterialItem[];
  materialDrawerOpen: boolean;
  /** 2D cutout stickers placed on the canvas (plants / people / custom PNG). */
  overlays: ImageOverlay[];
  selectedOverlayId: string | null;

  customStyles: CustomStyle[];
  selectedStyleId: string | null;

  savedImages: SavedEditImage[];
  /** Uploaded originals; each holds its own generation list. */
  sourceAlbums: SourceAlbum[];
  /** Currently focused album (kept even when sidebar shows the list). */
  activeSourceId: string | null;
  /** Right sidebar: originals list vs album detail. */
  sourceSidebarMode: 'list' | 'detail';
  sidebarTab: 'snapshots' | 'saved';
  /** Last successful generate prompt (for 重新生成). */
  lastGeneratePrompt: string | null;

  past: HistorySnap[];
  future: HistorySnap[];

  setTab: (t: ImageEditorTab) => void;
  setRetouchTool: (t: RetouchTool) => void;
  setBrushSize: (n: number) => void;
  /** Click canvas: additive=Shift add; clicking near existing removes it; else replace with one */
  placeHotspot: (
    x: number,
    y: number,
    opts?: { additive?: boolean; hitRadius?: number },
  ) => void;
  removeHotspot: (id: string) => void;
  undoLastHotspot: () => void;
  clearHotspots: () => void;
  setHotspotPrompt: (id: string, prompt: string) => void;
  commitBrushStroke: (region: Omit<BrushRegion, 'n'> | BrushRegion[]) => void;
  setBrushRegions: (regions: BrushRegion[]) => void;
  removeBrushRegion: (id: string) => void;
  undoLastBrushRegion: () => void;
  clearBrushRegions: () => void;
  setBrushRegionPrompt: (id: string, prompt: string) => void;
  setHasMask: (v: boolean) => void;
  setBusy: (v: boolean) => void;
  setPrompt: (v: string) => void;
  setMaterialDrawerOpen: (v: boolean) => void;
  addOverlayFromUrl: (url: string, label?: string) => Promise<void>;
  updateOverlay: (id: string, patch: Partial<ImageOverlay>) => void;
  removeOverlay: (id: string) => void;
  selectOverlay: (id: string | null) => void;
  clearOverlays: () => void;
  /** Flatten stickers onto current image (no-op if empty). */
  flattenOverlays: () => Promise<string | null>;
  /** Working pixels for AI / download / 3D (includes stickers if any). */
  getWorkingImageUrl: () => Promise<string | null>;
  setSidebarTab: (t: 'snapshots' | 'saved') => void;
  setShowCompare: (v: boolean) => void;
  setCropAspect: (a: number | undefined) => void;
  setCropSelection: (c: Crop | undefined) => void;

  openFromUrl: (url: string, opts?: { snapshotId?: string; label?: string }) => void;
  /** Import one or more model snapshots as 原图 albums; focus the first. */
  importSnapshotAlbums: (
    shots: { id: string; url: string; label: string }[],
  ) => void;
  /** Switch canvas to the pinned original without resetting the session. */
  focusOriginal: () => void;
  /** Load a past generation result while keeping the original pin. */
  focusSavedResult: (url: string) => void;
  openSourceAlbum: (id: string) => void;
  backToSourceList: () => void;
  renameSourceAlbum: (id: string, label: string) => void;
  removeSourceAlbum: (id: string) => void;
  renameSavedImage: (id: string, label: string) => void;
  removeSavedImage: (id: string) => void;
  /**
   * Add a generation result as a new entry in 原图列表 and switch to it.
   * Keeps the previous album and its results intact.
   */
  setResultAsOriginal: (id: string) => boolean;
  /** Add the current canvas image as a new original (when it differs from 原图). */
  setCurrentAsNewOriginal: () => boolean;
  /** Replace current album/original url with a generation result (and sync snapshot if any). */
  overwriteOriginalWithResult: (
    resultId: string,
    updateSnapshot?: (id: string, url: string) => void,
  ) => boolean;
  clearEditor: () => void;
  commitImage: (
    url: string,
    opts?: { compareFrom?: string; skipCompare?: boolean; prompt?: string },
  ) => void;
  setLastGeneratePrompt: (p: string | null) => void;
  undo: () => void;
  redo: () => void;
  resetToOriginal: () => void;

  addMaterial: (url: string) => Promise<boolean>;
  removeMaterial: (id: string) => void;
  toggleMaterial: (id: string) => void;
  clearMaterials: () => void;
  selectedMaterialUrls: () => string[];

  upsertCustomStyle: (style: Omit<CustomStyle, 'id'> & { id?: string }) => void;
  removeCustomStyle: (id: string) => void;
  setSelectedStyleId: (id: string | null) => void;

  saveAsNew: (label?: string) => void;
  overwriteSnapshot: (
    updateSnapshot: (id: string, url: string) => void,
  ) => boolean;

  exportBag: () => import('../store/projectBag').ImageProjectBag;
  importBag: (bag: import('../store/projectBag').ImageProjectBag) => void;
}

export const useImageStore = create<ImageState>((set, get) => ({
  originalUrl: null,
  currentUrl: null,
  sourceSnapshotId: null,
  compareBeforeUrl: null,
  showCompare: false,

  tab: 'retouch',
  retouchTool: 'select',
  brushSize: 28,
  hotspots: [],
  brushRegions: [],
  hasMask: false,
  busy: false,
  prompt: '',

  cropAspect: undefined,
  cropSelection: undefined,

  materials: [],
  materialDrawerOpen: false,
  overlays: [],
  selectedOverlayId: null,

  customStyles: loadStyles(),
  selectedStyleId: null,

  savedImages: [],
  sourceAlbums: [],
  activeSourceId: null,
  sourceSidebarMode: 'list',
  sidebarTab: 'snapshots',
  lastGeneratePrompt: null,

  past: [],
  future: [],

  setTab: (t) =>
    set({
      tab: t,
      ...(t === 'crop'
        ? { cropSelection: undefined, showCompare: false }
        : {}),
    }),
  setRetouchTool: (t) =>
    set({
      retouchTool: t,
      // Leave compare so point/brush can hit the live image immediately.
      ...(t === 'point' || t === 'brush' ? { showCompare: false } : {}),
    }),
  setBrushSize: (n) => set({ brushSize: n }),

  placeHotspot: (x, y, opts) => {
    const list = get().hotspots;
    const hitR = opts?.hitRadius ?? 28;
    const hit = list.find((p) => {
      const dx = p.x - x;
      const dy = p.y - y;
      return Math.hypot(dx, dy) <= hitR;
    });
    if (hit) {
      const next = renumber(list.filter((p) => p.id !== hit.id));
      set({ hotspots: next, hasMask: false, brushRegions: [] });
      return;
    }
    const point: HotspotPoint = {
      id: uid('hp'),
      n: 0,
      x,
      y,
      prompt: '',
    };
    if (opts?.additive && list.length > 0) {
      set({
        hotspots: renumber([...list, point]),
        hasMask: false,
        brushRegions: [],
      });
    } else {
      set({
        hotspots: renumber([point]),
        hasMask: false,
        brushRegions: [],
      });
    }
  },

  removeHotspot: (id) =>
    set({ hotspots: renumber(get().hotspots.filter((p) => p.id !== id)) }),

  undoLastHotspot: () => {
    const list = get().hotspots;
    if (!list.length) return;
    set({ hotspots: renumber(list.slice(0, -1)) });
  },

  clearHotspots: () => set({ hotspots: [] }),

  setHotspotPrompt: (id, prompt) =>
    set({
      hotspots: get().hotspots.map((p) =>
        p.id === id ? { ...p, prompt } : p,
      ),
    }),

  commitBrushStroke: (region) => {
    const incoming = Array.isArray(region) ? region : [region];
    const merged = renumberBrush([
      ...get().brushRegions,
      ...incoming.map((r) => ({
        id: r.id,
        n: 0,
        prompt: r.prompt || '',
        maskDataUrl: r.maskDataUrl,
        cx: r.cx,
        cy: r.cy,
      })),
    ]);
    set({
      brushRegions: merged,
      hasMask: merged.length > 0,
      hotspots: [],
    });
  },

  setBrushRegions: (regions) =>
    set({
      brushRegions: renumberBrush(regions),
      hasMask: regions.length > 0,
      hotspots: regions.length > 0 ? [] : get().hotspots,
    }),

  removeBrushRegion: (id) => {
    const next = renumberBrush(get().brushRegions.filter((r) => r.id !== id));
    set({ brushRegions: next, hasMask: next.length > 0 });
  },

  undoLastBrushRegion: () => {
    const list = get().brushRegions;
    if (!list.length) return;
    const next = renumberBrush(list.slice(0, -1));
    set({ brushRegions: next, hasMask: next.length > 0 });
  },

  clearBrushRegions: () => set({ brushRegions: [], hasMask: false }),

  setBrushRegionPrompt: (id, prompt) =>
    set({
      brushRegions: get().brushRegions.map((r) =>
        r.id === id ? { ...r, prompt } : r,
      ),
    }),

  setHasMask: (v) => set({ hasMask: v }),
  setBusy: (v) => set({ busy: v }),
  setPrompt: (v) => set({ prompt: v }),
  setMaterialDrawerOpen: (v) => set({ materialDrawerOpen: v }),

  addOverlayFromUrl: async (url, label) => {
    const base = get().currentUrl;
    if (!base) return;
    const img = await new Promise<HTMLImageElement>((res, rej) => {
      const el = new Image();
      el.onload = () => res(el);
      el.onerror = () => rej(new Error('base fail'));
      el.src = base;
    });
    const natW = img.naturalWidth;
    const natH = img.naturalHeight;
    const size = await measureSticker(url);
    const aspect = size.w / Math.max(1, size.h);
    const w = Math.max(48, Math.round(natW * 0.18));
    const h = Math.max(48, Math.round(w / aspect));
    const overlay: ImageOverlay = {
      id: uid('ov'),
      url,
      label: label || '素材',
      x: natW / 2,
      y: natH / 2,
      w,
      h,
    };
    set({
      overlays: [...get().overlays, overlay],
      selectedOverlayId: overlay.id,
      materialDrawerOpen: true,
    });
  },

  updateOverlay: (id, patch) =>
    set({
      overlays: get().overlays.map((o) =>
        o.id === id ? { ...o, ...patch } : o,
      ),
    }),

  removeOverlay: (id) =>
    set({
      overlays: get().overlays.filter((o) => o.id !== id),
      selectedOverlayId:
        get().selectedOverlayId === id ? null : get().selectedOverlayId,
    }),

  selectOverlay: (id) => set({ selectedOverlayId: id }),

  clearOverlays: () => set({ overlays: [], selectedOverlayId: null }),

  flattenOverlays: async () => {
    const { currentUrl, overlays } = get();
    if (!currentUrl) return null;
    if (!overlays.length) return currentUrl;
    const flat = await flattenOverlaysOntoImage(currentUrl, overlays);
    // commitImage clears overlays
    get().commitImage(flat, { compareFrom: currentUrl, skipCompare: true });
    return flat;
  },

  getWorkingImageUrl: async () => {
    const { currentUrl, overlays } = get();
    if (!currentUrl) return null;
    if (!overlays.length) return currentUrl;
    return flattenOverlaysOntoImage(currentUrl, overlays);
  },

  setSidebarTab: (t) => set({ sidebarTab: t }),
  setShowCompare: (v) => set({ showCompare: v }),
  setCropAspect: (a) => set({ cropAspect: a, cropSelection: undefined }),
  setCropSelection: (c) => set({ cropSelection: c }),

  openFromUrl: (url, opts) => {
    // Model snapshot → treat as 原图 album with generation history.
    if (opts?.snapshotId) {
      get().importSnapshotAlbums([
        {
          id: opts.snapshotId,
          url,
          label: opts.label || '模型快照',
        },
      ]);
      return;
    }

    const n = get().sourceAlbums.length + 1;
    const album: SourceAlbum = {
      id: uid('src'),
      url,
      label: opts?.label || `原图 ${n}`,
      createdAt: Date.now(),
      results: [],
    };
    set({
      sourceAlbums: [...get().sourceAlbums, album],
      activeSourceId: album.id,
      sourceSidebarMode: 'detail',
      originalUrl: url,
      currentUrl: url,
      sourceSnapshotId: null,
      compareBeforeUrl: null,
      showCompare: false,
      hotspots: [],
      brushRegions: [],
      hasMask: false,
      past: [],
      future: [],
      prompt: '',
      lastGeneratePrompt: null,
      tab: 'retouch',
      cropSelection: undefined,
      cropAspect: undefined,
      overlays: [],
      selectedOverlayId: null,
      savedImages: [],
    });
  },

  importSnapshotAlbums: (shots) => {
    if (!shots.length) return;
    let albums = [...get().sourceAlbums];
    const ensuredIds: string[] = [];
    for (const shot of shots) {
      const existing = albums.find((a) => a.sourceSnapshotId === shot.id);
      if (existing) {
        albums = albums.map((a) =>
          a.id === existing.id
            ? { ...a, url: shot.url, label: shot.label || a.label }
            : a,
        );
        ensuredIds.push(existing.id);
      } else {
        const album: SourceAlbum = {
          id: uid('src'),
          url: shot.url,
          label: shot.label || `快照 ${albums.length + 1}`,
          createdAt: Date.now(),
          results: [],
          sourceSnapshotId: shot.id,
        };
        albums = [...albums, album];
        ensuredIds.push(album.id);
      }
    }
    const firstId = ensuredIds[0];
    const first = albums.find((a) => a.id === firstId);
    if (!first) return;
    set({
      sourceAlbums: albums,
      activeSourceId: first.id,
      sourceSidebarMode: shots.length > 1 ? 'list' : 'detail',
      originalUrl: first.url,
      currentUrl: first.url,
      sourceSnapshotId: first.sourceSnapshotId ?? null,
      savedImages: first.results.map((r) => ({ ...r })),
      compareBeforeUrl: null,
      showCompare: false,
      hotspots: [],
      brushRegions: [],
      hasMask: false,
      past: [],
      future: [],
      prompt: '',
      lastGeneratePrompt: null,
      tab: 'retouch',
      cropSelection: undefined,
      cropAspect: undefined,
      overlays: [],
      selectedOverlayId: null,
    });
  },

  focusOriginal: () => {
    const originalUrl = get().originalUrl;
    if (!originalUrl) return;
    set({
      currentUrl: originalUrl,
      compareBeforeUrl: null,
      showCompare: false,
      hotspots: [],
      brushRegions: [],
      hasMask: false,
      cropSelection: undefined,
    });
  },

  focusSavedResult: (url) => {
    if (!url) return;
    const hit = get().savedImages.find((x) => x.url === url);
    set({
      currentUrl: url,
      compareBeforeUrl: null,
      showCompare: false,
      hotspots: [],
      brushRegions: [],
      hasMask: false,
      cropSelection: undefined,
      ...(hit?.prompt ? { lastGeneratePrompt: hit.prompt } : {}),
    });
  },

  openSourceAlbum: (id) => {
    const album = get().sourceAlbums.find((a) => a.id === id);
    if (!album) return;
    const last = album.results[album.results.length - 1];
    set({
      activeSourceId: id,
      sourceSidebarMode: 'detail',
      originalUrl: album.url,
      currentUrl: album.url,
      savedImages: album.results.map((r) => ({ ...r })),
      sourceSnapshotId: album.sourceSnapshotId ?? null,
      compareBeforeUrl: null,
      showCompare: false,
      hotspots: [],
      brushRegions: [],
      hasMask: false,
      past: [],
      future: [],
      overlays: [],
      selectedOverlayId: null,
      cropSelection: undefined,
      tab: 'retouch',
      lastGeneratePrompt: last?.prompt ?? get().lastGeneratePrompt,
    });
  },

  backToSourceList: () =>
    set({
      sourceSidebarMode: 'list',
      // Keep canvas + activeSourceId so edits still bind to the current album.
      hotspots: [],
      brushRegions: [],
      hasMask: false,
      overlays: [],
      selectedOverlayId: null,
      cropSelection: undefined,
    }),

  renameSourceAlbum: (id, label) =>
    set({
      sourceAlbums: get().sourceAlbums.map((a) =>
        a.id === id ? { ...a, label: label.trim() || a.label } : a,
      ),
    }),

  removeSourceAlbum: (id) => {
    const next = get().sourceAlbums.filter((a) => a.id !== id);
    const wasActive = get().activeSourceId === id;
    set({
      sourceAlbums: next,
      ...(wasActive
        ? {
            activeSourceId: next[0]?.id ?? null,
            sourceSidebarMode: 'list' as const,
            originalUrl: null,
            currentUrl: null,
            savedImages: [],
            past: [],
            future: [],
            overlays: [],
            selectedOverlayId: null,
          }
        : {}),
    });
  },

  renameSavedImage: (id, label) => {
    const savedImages = get().savedImages.map((x) =>
      x.id === id ? { ...x, label: label.trim() || x.label } : x,
    );
    const activeId = get().activeSourceId;
    set({
      savedImages,
      sourceAlbums: get().sourceAlbums.map((a) =>
        a.id === activeId
          ? {
              ...a,
              results: a.results.map((r) =>
                r.id === id ? { ...r, label: label.trim() || r.label } : r,
              ),
            }
          : a,
      ),
    });
  },

  setResultAsOriginal: (id) => {
    const hit = get().savedImages.find((x) => x.id === id);
    if (!hit) return false;
    return promoteUrlAsNewAlbum(get, set, hit.url, hit.label);
  },

  setCurrentAsNewOriginal: () => {
    const { currentUrl, originalUrl } = get();
    if (!currentUrl || currentUrl === originalUrl) return false;
    const hit = get().savedImages.find((x) => x.url === currentUrl);
    return promoteUrlAsNewAlbum(get, set, currentUrl, hit?.label);
  },

  overwriteOriginalWithResult: (resultId, updateSnapshot) => {
    const hit = get().savedImages.find((x) => x.id === resultId);
    const activeId = get().activeSourceId;
    if (!hit || !activeId) return false;
    const snapId = get().sourceSnapshotId;
    const sourceAlbums = get().sourceAlbums.map((a) =>
      a.id === activeId ? { ...a, url: hit.url } : a,
    );
    set({
      sourceAlbums,
      originalUrl: hit.url,
      currentUrl: hit.url,
      compareBeforeUrl: null,
      showCompare: false,
    });
    if (snapId && updateSnapshot) updateSnapshot(snapId, hit.url);
    return true;
  },

  clearEditor: () =>
    set({
      originalUrl: null,
      currentUrl: null,
      sourceSnapshotId: null,
      compareBeforeUrl: null,
      showCompare: false,
      hotspots: [],
      brushRegions: [],
      hasMask: false,
      past: [],
      future: [],
      prompt: '',
      lastGeneratePrompt: null,
      busy: false,
      cropSelection: undefined,
      cropAspect: undefined,
      savedImages: [],
      overlays: [],
      selectedOverlayId: null,
      activeSourceId: null,
      sourceSidebarMode: 'list',
      // Keep sourceAlbums so the originals list survives「上传新图」clear of canvas.
    }),

  setLastGeneratePrompt: (p) => set({ lastGeneratePrompt: p }),

  commitImage: (url, opts) => {
    const cur = get().currentUrl;
    const past = cur ? [...get().past, { url: cur }] : get().past;
    const skipCompare = Boolean(opts?.skipCompare);
    const before = opts?.compareFrom ?? cur;
    let savedImages = get().savedImages;
    let sourceAlbums = get().sourceAlbums;
    const activeId = get().activeSourceId;
    const promptUsed =
      opts?.prompt?.trim() || get().lastGeneratePrompt || get().prompt || undefined;
    const last = savedImages[savedImages.length - 1];
    if (!last || last.url !== url) {
      const n = savedImages.length + 1;
      const shot: SavedEditImage = {
        id: uid('edit'),
        url,
        label: `结果 ${n}`,
        createdAt: Date.now(),
        sourceSnapshotId: get().sourceSnapshotId ?? undefined,
        prompt: promptUsed,
      };
      savedImages = [...savedImages, shot].slice(-40);
      if (activeId) {
        sourceAlbums = sourceAlbums.map((a) =>
          a.id === activeId
            ? { ...a, results: savedImages.map((r) => ({ ...r })) }
            : a,
        );
      }
    }
    set({
      currentUrl: url,
      past: past.slice(-40),
      future: [],
      compareBeforeUrl: before ?? null,
      showCompare: skipCompare ? false : Boolean(before),
      hotspots: [],
      brushRegions: [],
      hasMask: false,
      cropSelection: undefined,
      savedImages,
      sourceAlbums,
      lastGeneratePrompt: promptUsed ?? get().lastGeneratePrompt,
      sidebarTab: 'saved',
      overlays: [],
      selectedOverlayId: null,
    });
  },

  undo: () => {
    const { past, currentUrl, future } = get();
    if (!past.length || !currentUrl) return;
    const prev = past[past.length - 1];
    set({
      past: past.slice(0, -1),
      future: [{ url: currentUrl }, ...future],
      currentUrl: prev.url,
      showCompare: false,
      hotspots: [],
      brushRegions: [],
      hasMask: false,
      cropSelection: undefined,
    });
  },

  redo: () => {
    const { future, currentUrl, past } = get();
    if (!future.length || !currentUrl) return;
    const next = future[0];
    set({
      future: future.slice(1),
      past: [...past, { url: currentUrl }],
      currentUrl: next.url,
      showCompare: false,
      hotspots: [],
      brushRegions: [],
      hasMask: false,
      cropSelection: undefined,
    });
  },

  resetToOriginal: () => {
    const { originalUrl, currentUrl } = get();
    if (!originalUrl || !currentUrl || originalUrl === currentUrl) return;
    set({
      past: [...get().past, { url: currentUrl }],
      future: [],
      currentUrl: originalUrl,
      showCompare: false,
      hotspots: [],
      brushRegions: [],
      hasMask: false,
      cropSelection: undefined,
    });
  },

  addMaterial: async (url) => {
    if (get().materials.length >= 5) return false;
    const compressed = await compressDataUrl(url, 768, 0.7);
    set({
      materials: [
        ...get().materials,
        { id: uid('mat'), url: compressed, selected: true },
      ],
    });
    return true;
  },

  removeMaterial: (id) =>
    set({ materials: get().materials.filter((m) => m.id !== id) }),

  toggleMaterial: (id) =>
    set({
      materials: get().materials.map((m) =>
        m.id === id ? { ...m, selected: !m.selected } : m,
      ),
    }),

  clearMaterials: () => set({ materials: [] }),

  selectedMaterialUrls: () =>
    get()
      .materials.filter((m) => m.selected)
      .map((m) => m.url),

  upsertCustomStyle: (style) => {
    const list = [...get().customStyles];
    if (style.id) {
      const i = list.findIndex((s) => s.id === style.id);
      if (i >= 0) list[i] = { ...list[i], ...style, id: style.id };
    } else {
      list.push({
        id: uid('style'),
        name: style.name,
        prompt: style.prompt,
        refs: style.refs,
      });
    }
    saveStyles(list);
    set({ customStyles: list });
  },

  removeCustomStyle: (id) => {
    const list = get().customStyles.filter((s) => s.id !== id);
    saveStyles(list);
    set({
      customStyles: list,
      selectedStyleId:
        get().selectedStyleId === id ? null : get().selectedStyleId,
    });
  },

  setSelectedStyleId: (id) => set({ selectedStyleId: id }),

  saveAsNew: (label) => {
    const url = get().currentUrl;
    if (!url) return;
    const n = get().savedImages.length + 1;
    const shot: SavedEditImage = {
      id: uid('edit'),
      url,
      label: label || `结果 ${n}`,
      createdAt: Date.now(),
      sourceSnapshotId: get().sourceSnapshotId ?? undefined,
    };
    const savedImages = [...get().savedImages, shot].slice(-40);
    const activeId = get().activeSourceId;
    set({
      savedImages,
      sidebarTab: 'saved',
      sourceAlbums: get().sourceAlbums.map((a) =>
        a.id === activeId
          ? { ...a, results: savedImages.map((r) => ({ ...r })) }
          : a,
      ),
    });
  },

  removeSavedImage: (id) => {
    const savedImages = get().savedImages.filter((x) => x.id !== id);
    const activeId = get().activeSourceId;
    set({
      savedImages,
      sourceAlbums: get().sourceAlbums.map((a) =>
        a.id === activeId
          ? { ...a, results: savedImages.map((r) => ({ ...r })) }
          : a,
      ),
    });
  },

  overwriteSnapshot: (updateSnapshot) => {
    const { sourceSnapshotId, currentUrl, activeSourceId } = get();
    if (!sourceSnapshotId || !currentUrl) return false;
    updateSnapshot(sourceSnapshotId, currentUrl);
    if (activeSourceId) {
      set({
        sourceAlbums: get().sourceAlbums.map((a) =>
          a.id === activeSourceId ? { ...a, url: currentUrl } : a,
        ),
        originalUrl: currentUrl,
      });
    }
    return true;
  },

  exportBag: () => {
    const s = get();
    return {
      originalUrl: s.originalUrl,
      currentUrl: s.currentUrl,
      sourceSnapshotId: s.sourceSnapshotId,
      compareBeforeUrl: s.compareBeforeUrl,
      showCompare: s.showCompare,
      tab: s.tab,
      retouchTool: s.retouchTool,
      brushSize: s.brushSize,
      prompt: s.prompt,
      lastGeneratePrompt: s.lastGeneratePrompt,
      materials: s.materials.map((m) => ({ ...m })),
      savedImages: s.savedImages.map((x) => ({ ...x })),
      sourceAlbums: s.sourceAlbums.map((a) => ({
        ...a,
        results: a.results.map((r) => ({ ...r })),
      })),
      activeSourceId: s.activeSourceId,
      sourceSidebarMode: s.sourceSidebarMode,
      sidebarTab: s.sidebarTab,
      past: s.past.map((x) => ({ ...x })),
      future: s.future.map((x) => ({ ...x })),
    };
  },

  importBag: (bag) => {
    const albums =
      bag.sourceAlbums?.map((a) => ({
        ...a,
        sourceSnapshotId: a.sourceSnapshotId,
        results: (a.results || []).map((r) => ({ ...r })),
      })) ??
      (bag.originalUrl
        ? [
            {
              id: uid('src'),
              url: bag.originalUrl,
              label: '原图 1',
              createdAt: Date.now(),
              results: (bag.savedImages || []).map((x) => ({ ...x })),
              sourceSnapshotId: bag.sourceSnapshotId ?? undefined,
            },
          ]
        : []);
    set({
      originalUrl: bag.originalUrl,
      currentUrl: bag.currentUrl,
      sourceSnapshotId: bag.sourceSnapshotId,
      compareBeforeUrl: bag.compareBeforeUrl,
      showCompare: bag.showCompare,
      tab: bag.tab,
      retouchTool: bag.retouchTool,
      brushSize: bag.brushSize,
      prompt: bag.prompt,
      lastGeneratePrompt: bag.lastGeneratePrompt ?? null,
      materials: bag.materials.map((m) => ({ ...m })),
      savedImages: bag.savedImages.map((x) => ({ ...x })),
      sourceAlbums: albums,
      activeSourceId:
        bag.activeSourceId ??
        (bag.currentUrl || bag.originalUrl ? albums[0]?.id ?? null : null),
      sourceSidebarMode:
        bag.sourceSidebarMode ??
        (bag.currentUrl || bag.originalUrl ? 'detail' : 'list'),
      sidebarTab: bag.sidebarTab,
      past: bag.past.map((x) => ({ ...x })),
      future: bag.future.map((x) => ({ ...x })),
      hotspots: [],
      brushRegions: [],
      hasMask: false,
      busy: false,
      cropAspect: undefined,
      cropSelection: undefined,
      overlays: [],
      selectedOverlayId: null,
      materialDrawerOpen: false,
    });
  },
}));
