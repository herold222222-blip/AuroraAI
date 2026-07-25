import type {
  ExportSettings,
  Layer,
  ModelConfig,
  ModelSnapshot,
  SceneGrid,
  ViewId,
  ViewportSettings,
  MaterialSwatch,
  EditTool,
} from '../types';

export type ProjectLayerFilter = 'all' | '2D' | '3D' | 'hidden';

export interface ProjectMeta {
  id: string;
  name: string;
  updatedAt: number;
}

export interface ModelProjectBag {
  view: ViewId;
  lastModelView: ViewId;
  image: { url: string; name: string; size: number } | null;
  grid: SceneGrid | null;
  layers: Layer[];
  selectedLayerId: string | null;
  selectedLayerIds: string[];
  layerFilter: ProjectLayerFilter;
  config: ModelConfig;
  viewport: ViewportSettings;
  exportSettings: ExportSettings;
  materialLibrary: MaterialSwatch[];
  activePaint: MaterialSwatch | null;
  materialTool: 'none' | 'eyedropper' | 'bucket';
  editTool: EditTool;
  cameraMode: boolean;
  snapshots: ModelSnapshot[];
  viewingSnapshotId: string | null;
}

export interface ImageProjectBag {
  originalUrl: string | null;
  currentUrl: string | null;
  sourceSnapshotId: string | null;
  compareBeforeUrl: string | null;
  showCompare: boolean;
  tab: 'retouch' | 'crop' | 'adjust' | 'filter' | 'style';
  retouchTool: 'select' | 'point' | 'brush' | 'eraser';
  brushSize: number;
  prompt: string;
  materials: { id: string; url: string; selected: boolean }[];
  savedImages: {
    id: string;
    url: string;
    label: string;
    createdAt: number;
    sourceSnapshotId?: string;
  }[];
  sidebarTab: 'snapshots' | 'saved';
  past: { url: string }[];
  future: { url: string }[];
}

export interface ProjectBag {
  model: ModelProjectBag;
  image: ImageProjectBag;
}

/** In-memory bags keyed by project id (not reactive). */
export const projectBags = new Map<string, ProjectBag>();

export function emptyImageBag(): ImageProjectBag {
  return {
    originalUrl: null,
    currentUrl: null,
    sourceSnapshotId: null,
    compareBeforeUrl: null,
    showCompare: false,
    tab: 'retouch',
    retouchTool: 'select',
    brushSize: 28,
    prompt: '',
    materials: [],
    savedImages: [],
    sidebarTab: 'snapshots',
    past: [],
    future: [],
  };
}

export function emptyModelBag(defaults: {
  config: ModelConfig;
  viewport: ViewportSettings;
  exportSettings: ExportSettings;
  materialLibrary: MaterialSwatch[];
}): ModelProjectBag {
  return {
    view: 'upload',
    lastModelView: 'upload',
    image: null,
    grid: null,
    layers: [],
    selectedLayerId: null,
    selectedLayerIds: [],
    layerFilter: 'all',
    config: { ...defaults.config },
    viewport: { ...defaults.viewport },
    exportSettings: { ...defaults.exportSettings },
    materialLibrary: defaults.materialLibrary.map((s) => ({ ...s })),
    activePaint: null,
    materialTool: 'none',
    editTool: 'select',
    cameraMode: false,
    snapshots: [],
    viewingSnapshotId: null,
  };
}

export function cloneGrid(grid: SceneGrid | null): SceneGrid | null {
  if (!grid) return null;
  return {
    ...grid,
    cells: Int16Array.from(grid.cells),
  };
}

export function cloneLayers(layers: Layer[]): Layer[] {
  return layers.map((l) => ({
    ...l,
    material: { ...l.material },
    transform: l.transform
      ? { ...l.transform }
      : { x: 0, y: 0, z: 0, scale: 1, rx: 0, ry: 0, rz: 0 },
  }));
}

export function newProjectId() {
  return `proj_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}
