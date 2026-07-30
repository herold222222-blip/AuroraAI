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

/** Permanent scratch workspace — always exists, cannot be renamed/deleted. */
export const SCRATCH_PROJECT_ID = 'proj_scratch_unassigned';
export const SCRATCH_PROJECT_NAME = '未立项空间';

export interface ProjectMeta {
  id: string;
  name: string;
  updatedAt: number;
  kind?: 'scratch' | 'project';
}

export function isScratchProjectId(id: string) {
  return id === SCRATCH_PROJECT_ID;
}

export function defaultFormalProjectName() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `景观方案 ${y}-${m}-${day}`;
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
  /** Snapshot ids sent to the image editor (order preserved); null = show all. */
  imageSessionSnapshotIds: string[] | null;
  /** Meshy Image-to-3D result GLB URL */
  meshyModelUrl: string | null;
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
    prompt?: string;
  }[];
  sourceAlbums?: {
    id: string;
    url: string;
    label: string;
    createdAt: number;
    sourceSnapshotId?: string;
    results: {
      id: string;
      url: string;
      label: string;
      createdAt: number;
      sourceSnapshotId?: string;
      prompt?: string;
    }[];
  }[];
  activeSourceId?: string | null;
  sourceSidebarMode?: 'list' | 'detail';
  sidebarTab: 'snapshots' | 'saved';
  lastGeneratePrompt?: string | null;
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
    lastGeneratePrompt: null,
    materials: [],
    savedImages: [],
    sourceAlbums: [],
    activeSourceId: null,
    sourceSidebarMode: 'list',
    sidebarTab: 'snapshots',
    past: [],
    future: [],
  };
}

function cloneAlbum(
  a: NonNullable<ImageProjectBag['sourceAlbums']>[number],
): NonNullable<ImageProjectBag['sourceAlbums']>[number] {
  return {
    ...a,
    results: (a.results || []).map((r) => ({ ...r })),
  };
}

/**
 * When promoting scratch → formal for 图生模型: take only the active/current
 * album into the new project; leave other originals in 未立项空间.
 */
export function splitImageBagForTo3dPromote(image: ImageProjectBag): {
  projectImage: ImageProjectBag;
  scratchImage: ImageProjectBag;
} {
  const albums = (image.sourceAlbums ?? []).map(cloneAlbum);
  if (albums.length <= 1) {
    return { projectImage: image, scratchImage: emptyImageBag() };
  }

  const activeId =
    image.activeSourceId ??
    albums.find(
      (a) => a.url === image.originalUrl || a.url === image.currentUrl,
    )?.id ??
    null;

  const taken =
    (activeId ? albums.find((a) => a.id === activeId) : null) ?? albums[0];
  const remaining = albums.filter((a) => a.id !== taken.id);
  if (!remaining.length) {
    return { projectImage: image, scratchImage: emptyImageBag() };
  }

  const projectImage: ImageProjectBag = {
    ...image,
    sourceAlbums: [cloneAlbum(taken)],
    activeSourceId: taken.id,
    sourceSidebarMode: 'detail',
    savedImages: (taken.results || []).map((r) => ({ ...r })),
    sourceSnapshotId: taken.sourceSnapshotId ?? image.sourceSnapshotId,
  };

  const scratchImage: ImageProjectBag = {
    ...emptyImageBag(),
    sourceAlbums: remaining.map(cloneAlbum),
    activeSourceId: null,
    sourceSidebarMode: 'list',
  };

  return { projectImage, scratchImage };
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
    imageSessionSnapshotIds: null,
    meshyModelUrl: null,
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
