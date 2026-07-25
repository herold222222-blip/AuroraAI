import { create } from 'zustand';
import type { Crop } from 'react-image-crop';
import { compressDataUrl } from './padImage';

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

  customStyles: CustomStyle[];
  selectedStyleId: string | null;

  savedImages: SavedEditImage[];
  sidebarTab: 'snapshots' | 'saved';

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
  setSidebarTab: (t: 'snapshots' | 'saved') => void;
  setShowCompare: (v: boolean) => void;
  setCropAspect: (a: number | undefined) => void;
  setCropSelection: (c: Crop | undefined) => void;

  openFromUrl: (url: string, opts?: { snapshotId?: string }) => void;
  clearEditor: () => void;
  commitImage: (url: string, opts?: { compareFrom?: string; skipCompare?: boolean }) => void;
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

  customStyles: loadStyles(),
  selectedStyleId: null,

  savedImages: [],
  sidebarTab: 'snapshots',

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
  setSidebarTab: (t) => set({ sidebarTab: t }),
  setShowCompare: (v) => set({ showCompare: v }),
  setCropAspect: (a) => set({ cropAspect: a, cropSelection: undefined }),
  setCropSelection: (c) => set({ cropSelection: c }),

  openFromUrl: (url, opts) =>
    set({
      originalUrl: url,
      currentUrl: url,
      sourceSnapshotId: opts?.snapshotId ?? null,
      compareBeforeUrl: null,
      showCompare: false,
      hotspots: [],
      brushRegions: [],
      hasMask: false,
      past: [],
      future: [],
      prompt: '',
      tab: 'retouch',
      cropSelection: undefined,
      cropAspect: undefined,
    }),

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
      busy: false,
      cropSelection: undefined,
      cropAspect: undefined,
    }),

  commitImage: (url, opts) => {
    const cur = get().currentUrl;
    const past = cur ? [...get().past, { url: cur }] : get().past;
    const skipCompare = Boolean(opts?.skipCompare);
    const before = opts?.compareFrom ?? cur;
    set({
      currentUrl: url,
      past: past.slice(-40),
      future: [],
      // Keep before-url for footer「前后对比」even when we don't auto-open compare.
      compareBeforeUrl: before ?? null,
      showCompare: skipCompare ? false : Boolean(before),
      hotspots: [],
      brushRegions: [],
      hasMask: false,
      cropSelection: undefined,
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
      label: label || `缂栬緫 ${n}`,
      createdAt: Date.now(),
      sourceSnapshotId: get().sourceSnapshotId ?? undefined,
    };
    set({
      savedImages: [...get().savedImages, shot],
      sidebarTab: 'saved',
    });
  },

  overwriteSnapshot: (updateSnapshot) => {
    const { sourceSnapshotId, currentUrl } = get();
    if (!sourceSnapshotId || !currentUrl) return false;
    updateSnapshot(sourceSnapshotId, currentUrl);
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
      materials: s.materials.map((m) => ({ ...m })),
      savedImages: s.savedImages.map((x) => ({ ...x })),
      sidebarTab: s.sidebarTab,
      past: s.past.map((x) => ({ ...x })),
      future: s.future.map((x) => ({ ...x })),
    };
  },

  importBag: (bag) => {
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
      materials: bag.materials.map((m) => ({ ...m })),
      savedImages: bag.savedImages.map((x) => ({ ...x })),
      sidebarTab: bag.sidebarTab,
      past: bag.past.map((x) => ({ ...x })),
      future: bag.future.map((x) => ({ ...x })),
      hotspots: [],
      brushRegions: [],
      hasMask: false,
      busy: false,
      cropAspect: undefined,
      cropSelection: undefined,
      materialDrawerOpen: false,
    });
  },
}));
