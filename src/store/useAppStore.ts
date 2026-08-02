import { create } from 'zustand';
import type {
  ExportSettings,
  Layer,
  ModelConfig,
  SceneGrid,
  ToastMessage,
  ViewId,
  ViewportSettings,
  Dimension,
  MaterialConfig,
  TopologyType,
  FaceQuality,
  OpRecord,
  MaterialSwatch,
  EditTool,
  ModelSnapshot,
  SnapshotCameraPose,
} from '../types';
import { uid, newLayerMaterial, MATERIAL_LIBRARY, matchLibrarySwatch, materialFromSwatch, isMeshyModel, DEFAULT_AI_MODEL, resolveAiModel } from '../data/defaultLayers';
import { runSceneAI } from '../ai/pipeline';
import { generateFallbackScene } from '../ai/fallback';
import { buildScene } from '../ai/scene';
import { useImageStore } from '../image/useImageStore';
import { useAuthStore } from './useAuthStore';
import { createMeshyImageTo3d, pollMeshyImageTo3d } from '../ai/meshyApi';
import { viewportController } from '../components/workbench/viewportController';
import {
  cloneGrid,
  cloneLayers,
  defaultFormalProjectName,
  emptyImageBag,
  emptyModelBag,
  isScratchProjectId,
  newProjectId,
  projectBags,
  SCRATCH_PROJECT_ID,
  SCRATCH_PROJECT_NAME,
  splitImageBagForTo3dPromote,
  type ProjectBag,
  type ProjectMeta,
} from './projectBag';

export type PendingPromoteAction =
  | null
  | { kind: 'toImage'; snapshotIds: string[] }
  | { kind: 'to3d' };

const HISTORY_LIMIT = 50;

export type LayerFilter = 'all' | '2D' | '3D' | 'hidden';

export const matchesFilter = (l: Layer, f: LayerFilter): boolean => {
  if (f === 'all') return true;
  if (f === 'hidden') return !l.visible;
  // 2D / 3D: only visible layers in that dimension
  return l.visible && l.dimension === f;
};

interface UploadedImage {
  url: string;
  name: string;
  size: number;
}

interface HistoryEntry {
  layers: Layer[];
  cells: Int16Array;
}

interface AppState {
  view: ViewId;
  transitionTo: ViewId | null;

  image: UploadedImage | null;

  grid: SceneGrid | null;
  layers: Layer[];
  selectedLayerId: string | null;
  selectedLayerIds: string[];
  layerFilter: LayerFilter;

  projectName: string;
  /** all projects (meta only); bags live in projectBags Map */
  projects: ProjectMeta[];
  activeProjectId: string;
  /** Cross-module handoff waiting for promote confirm (scratch only). */
  pendingPromote: PendingPromoteAction;

  // AI analysis status
  aiRunning: boolean;
  aiStage: string;
  aiProgress: number;
  aiError: string | null;
  aiUsedFallback: boolean;

  config: ModelConfig;
  /**
   * Face density currently baked into the viewport mesh.
   * `config.faceQuality` is the pending generation setting until rebuild.
   */
  appliedFaceQuality: FaceQuality;
  viewport: ViewportSettings;
  exportSettings: ExportSettings;

  toasts: ToastMessage[];

  past: HistoryEntry[];
  future: HistoryEntry[];
  /** labeled operation log for the history panel (newest last) */
  opLog: OpRecord[];

  /** material tool: eyedropper samples, bucket paints faces */
  materialTool: 'none' | 'eyedropper' | 'bucket';
  /** last sampled / selected paint material */
  activePaint: MaterialSwatch | null;
  /** mutable material library shown in the right sidebar */
  materialLibrary: MaterialSwatch[];

  /** 3D viewport edit tool */
  editTool: EditTool;

  /** camera mode: right sidebar shows snapshot history */
  cameraMode: boolean;
  snapshots: ModelSnapshot[];
  /** snapshot currently enlarged over the viewport (null = show 3D) */
  viewingSnapshotId: string | null;
  /** snapshot image previewed full-size over the canvas (magnifier) */
  previewingSnapshotId: string | null;
  /**
   * Snapshot ids handed to the image editor (send order).
   * When set, image sidebar lists these synced model shots.
   */
  imageSessionSnapshotIds: string[] | null;
  /** last model-module view before entering image */
  lastModelView: ViewId;
  /** Meshy Image-to-3D GLB URL when using Meshy model */
  meshyModelUrl: string | null;
  /** After analysis completes, auto-run build3D (used by「重新分层再构建」). */
  pendingBuildAfterAnalysis: boolean;

  goto: (view: ViewId) => void;
  startTransition: (progressView: ViewId, target: ViewId) => void;
  logoReset: () => void;
  back: () => void;

  setImage: (img: UploadedImage) => void;
  clearImage: () => void;

  analyze: () => void;
  resegment: () => void;
  runAnalysis: () => Promise<void>;
  /** Rebuild 3D; pass resegmentFirst to re-run semantic layering first. */
  build3D: (opts?: { resegmentFirst?: boolean }) => void;
  runMeshyBuild: () => Promise<void>;
  setMeshyModelUrl: (url: string | null) => void;

  selectLayer: (id: string | null, additive?: boolean) => void;
  selectAllLayers: () => void;
  clearSelection: () => void;
  setLayerFilter: (f: LayerFilter) => void;
  setProjectName: (name: string) => void;
  switchProject: (id: string) => void;
  /**
   * Promote current work into a new formal project and enter it.
   * If active is scratch, scratch is reset to empty (unless retainOtherImageAlbumsInScratch);
   * otherwise current project is kept (另存副本).
   */
  promoteCurrentToProject: (
    name?: string,
    opts?: { retainOtherImageAlbumsInScratch?: boolean },
  ) => string | null;
  /** @deprecated alias — use promoteCurrentToProject */
  createProject: (name?: string) => void;
  /** Create an empty formal project and switch to it (keeps current project). */
  createBlankProject: (name?: string) => string | null;
  /** Delete a formal project (scratch cannot be deleted). */
  removeProject: (id: string) => boolean;
  /** capture active project into projectBags */
  saveActiveProjectBag: () => void;
  requestPromoteForToImage: (snapshotIds: string[]) => void;
  requestPromoteForTo3d: () => void;
  confirmPendingPromote: (name?: string) => void;
  cancelPendingPromote: () => void;
  addLayer: (name: string, dimension: Dimension) => void;
  removeLayer: (id: string) => void;
  toggleVisibility: (id: string) => void;
  setDimension: (id: string, dimension: Dimension) => void;
  setTopology: (id: string, topology: TopologyType) => void;
  /** Apply topology to all layers and update generation config */
  retopologizeAll: (topology: TopologyType) => void;
  renameLayer: (id: string, name: string) => void;
  splitLayer: (sourceId: string, name: string, dimension: Dimension) => void;
  mergeLayers: (
    sourceIds: string[],
    name: string,
    materialStrategy: string,
  ) => void;
  updateMaterial: (id: string, material: Partial<MaterialConfig>) => void;
  /** Edit a material-library entry (and sync linked layers / active paint). */
  updateLibraryMaterial: (
    swatchId: string,
    patch: Partial<MaterialSwatch>,
  ) => void;
  applyPaintToLayer: (layerId: string) => void;
  selectPaintMaterial: (swatch: MaterialSwatch) => void;
  setMaterialTool: (tool: 'none' | 'eyedropper' | 'bucket') => void;
  sampleMaterialFromLayer: (sourceId: string) => void;
  setEditTool: (tool: EditTool) => void;
  setCameraMode: (on: boolean) => void;
  toggleCameraMode: () => void;
  addSnapshot: (dataUrl: string, cameraPose?: SnapshotCameraPose) => void;
  removeSnapshot: (id: string) => void;
  renameSnapshot: (id: string, label: string) => void;
  reorderSnapshots: (fromId: string, toId: string) => void;
  updateSnapshotUrl: (id: string, url: string) => void;
  setViewingSnapshot: (id: string | null) => void;
  setPreviewingSnapshot: (id: string | null) => void;
  /** Attach / refresh camera pose on the source-image snapshot (first slot). */
  attachCameraPoseToSourceSnapshot: (pose: SnapshotCameraPose) => void;
  /**
   * Ensure the generating image is the first model snapshot.
   * Clones blob URLs so later revoke won't break the thumb.
   */
  ensureSourceImageSnapshot: (opts?: {
    url?: string;
    label?: string;
    force?: boolean;
  }) => Promise<void>;
  enterImageModule: () => void;
  enterModelModule: () => void;
  enterAdminModule: () => void;
  /** Send selected model snapshots into the image editor (single or multi). */
  sendSnapshotsToImage: (ids: string[]) => void;
  /** Hand off image-editor `currentUrl` into 图生模型 (analyze → 2D → 3D). */
  start3DFromImageEditor: () => void;
  /** Internal: run after promote gate. */
  executeSendSnapshotsToImage: (ids: string[]) => void;
  executeStart3DFromImageEditor: () => void;
  updateLayerTransform: (
    id: string,
    patch: Partial<{
      x: number;
      y: number;
      z: number;
      scale: number;
      rx: number;
      ry: number;
      rz: number;
    }>,
    opts?: { commit?: boolean; label?: string },
  ) => void;
  regenerateLayer: (id: string) => void;
  duplicateLayer: (id: string) => void;

  setConfig: (patch: Partial<ModelConfig>) => void;
  setViewport: (patch: Partial<ViewportSettings>) => void;
  setExportSettings: (patch: Partial<ExportSettings>) => void;

  pushToast: (text: string, tone?: ToastMessage['tone']) => void;
  dismissToast: (id: string) => void;

  undo: () => void;
  redo: () => void;
}

const DEFAULT_CONFIG: ModelConfig = {
  aiModel: DEFAULT_AI_MODEL,
  textureGen: true,
  textureQuality: '2K',
  pbr: true,
  topology: 'triangle',
  faceQuality: 'auto',
};

const DEFAULT_VIEWPORT: ViewportSettings = {
  grid: true,
  surfaceMode: 'shaded',
  pbrPreview: true,
  ambientLight: true,
};

const DEFAULT_EXPORT: ExportSettings = {
  previewStyle: 'shaded',
  pbr: true,
  format: 'obj',
};

const PALETTE = ['#00D2FF', '#7B61FF', '#FF6B9D', '#FFB020', '#4ECB71', '#F97316'];

const maxKey = (layers: Layer[]) =>
  layers.reduce((m, l) => Math.max(m, l.key), 0);

export const useAppStore = create<AppState>((set, get) => {
  const commit = (label = '编辑') => {
    const { layers, grid, past, opLog } = get();
    set({
      past: [
        ...past,
        {
          layers: layers.map((l) => ({
            ...l,
            material: { ...l.material },
          })),
          cells: grid ? Int16Array.from(grid.cells) : new Int16Array(0),
        },
      ].slice(-HISTORY_LIMIT),
      future: [],
      opLog: [
        ...opLog,
        { id: uid('op'), label, at: Date.now() },
      ].slice(-HISTORY_LIMIT),
    });
  };

  const withCells = (cells: Int16Array): SceneGrid | null => {
    const g = get().grid;
    return g ? { ...g, cells } : null;
  };

  // when the acted-on layer is part of a multi-selection, edits apply to every
  // selected layer; otherwise they apply only to that single layer
  const syncTargets = (id: string): Set<string> => {
    const sel = get().selectedLayerIds;
    return new Set(sel.length > 1 && sel.includes(id) ? sel : [id]);
  };

  const captureBag = (): ProjectBag => {
    const s = get();
    return {
      model: {
        view: s.view,
        lastModelView: s.lastModelView,
        image: s.image ? { ...s.image } : null,
        grid: cloneGrid(s.grid),
        layers: cloneLayers(s.layers),
        selectedLayerId: s.selectedLayerId,
        selectedLayerIds: [...s.selectedLayerIds],
        layerFilter: s.layerFilter,
        config: { ...s.config },
        viewport: { ...s.viewport },
        exportSettings: { ...s.exportSettings },
        materialLibrary: s.materialLibrary.map((m) => ({ ...m })),
        activePaint: s.activePaint ? { ...s.activePaint } : null,
        materialTool: s.materialTool,
        editTool: s.editTool,
        cameraMode: s.cameraMode,
        snapshots: s.snapshots.map((x) => ({ ...x })),
        viewingSnapshotId: s.viewingSnapshotId,
        imageSessionSnapshotIds: s.imageSessionSnapshotIds
          ? [...s.imageSessionSnapshotIds]
          : null,
        meshyModelUrl: s.meshyModelUrl,
      },
      image: useImageStore.getState().exportBag(),
    };
  };

  const emptyBag = (): ProjectBag => ({
    model: emptyModelBag({
      config: DEFAULT_CONFIG,
      viewport: DEFAULT_VIEWPORT,
      exportSettings: DEFAULT_EXPORT,
      materialLibrary: MATERIAL_LIBRARY,
    }),
    image: emptyImageBag(),
  });

  const ensureScratchMeta = (list: ProjectMeta[]): ProjectMeta[] => {
    const scratch: ProjectMeta = {
      id: SCRATCH_PROJECT_ID,
      name: SCRATCH_PROJECT_NAME,
      updatedAt: Date.now(),
      kind: 'scratch',
    };
    const rest = list
      .filter((p) => !isScratchProjectId(p.id))
      .map((p) => ({ ...p, kind: p.kind ?? ('project' as const) }));
    return [scratch, ...rest];
  };

  const hydrateBag = (bag: ProjectBag, projectName: string) => {
    const m = bag.model;
    set({
      view: m.view,
      transitionTo: null,
      lastModelView: m.lastModelView,
      image: m.image ? { ...m.image } : null,
      grid: cloneGrid(m.grid),
      layers: cloneLayers(m.layers),
      selectedLayerId: m.selectedLayerId,
      selectedLayerIds: [...m.selectedLayerIds],
      layerFilter: m.layerFilter,
      projectName,
      aiRunning: false,
      aiStage: '',
      aiProgress: 0,
      aiError: null,
      aiUsedFallback: false,
      config: {
        ...m.config,
        aiModel: resolveAiModel(m.config.aiModel),
      },
      appliedFaceQuality: m.config.faceQuality ?? 'auto',
      viewport: { ...m.viewport },
      exportSettings: { ...m.exportSettings },
      past: [],
      future: [],
      opLog: [],
      materialLibrary: m.materialLibrary.map((x) => ({ ...x })),
      activePaint: m.activePaint ? { ...m.activePaint } : null,
      materialTool: m.materialTool,
      editTool: m.editTool,
      cameraMode: m.cameraMode,
      snapshots: m.snapshots.map((x) => ({ ...x })),
      viewingSnapshotId: m.viewingSnapshotId,
      previewingSnapshotId: null,
      imageSessionSnapshotIds: m.imageSessionSnapshotIds
        ? [...m.imageSessionSnapshotIds]
        : null,
      meshyModelUrl: m.meshyModelUrl ?? null,
      pendingBuildAfterAnalysis: false,
    });
    useImageStore.getState().importBag(bag.image);
  };

  projectBags.set(SCRATCH_PROJECT_ID, emptyBag());

  return {
    view: 'upload',
    transitionTo: null,
    image: null,
    grid: null,
    layers: [],
    selectedLayerId: null,
    selectedLayerIds: [],
    layerFilter: 'all',
    projectName: SCRATCH_PROJECT_NAME,
    projects: [
      {
        id: SCRATCH_PROJECT_ID,
        name: SCRATCH_PROJECT_NAME,
        updatedAt: Date.now(),
        kind: 'scratch',
      },
    ],
    activeProjectId: SCRATCH_PROJECT_ID,
    pendingPromote: null,
    aiRunning: false,
    aiStage: '',
    aiProgress: 0,
    aiError: null,
    aiUsedFallback: false,
    config: { ...DEFAULT_CONFIG },
    appliedFaceQuality: DEFAULT_CONFIG.faceQuality,
    viewport: { ...DEFAULT_VIEWPORT },
    exportSettings: { ...DEFAULT_EXPORT },
    toasts: [],
    past: [],
    future: [],
    opLog: [],
    materialTool: 'none' as const,
    activePaint: null,
    materialLibrary: MATERIAL_LIBRARY.map((s) => ({ ...s })),
    editTool: 'select' as const,
    cameraMode: false,
    snapshots: [],
    viewingSnapshotId: null,
    previewingSnapshotId: null,
    imageSessionSnapshotIds: null,
    lastModelView: 'upload' as ViewId,
    meshyModelUrl: null,
    pendingBuildAfterAnalysis: false,

    goto: (view) => set({ view, transitionTo: null }),
    startTransition: (progressView, target) =>
      set({ view: progressView, transitionTo: target }),

    enterImageModule: () => {
      const cur = get().view;
      if (cur !== 'image') {
        set({ lastModelView: cur, view: 'image', transitionTo: null });
      }
    },
    enterModelModule: () => {
      const target = get().lastModelView || 'upload';
      set({
        view: target === 'image' || target === 'admin' ? 'upload' : target,
        transitionTo: null,
      });
    },
    enterAdminModule: () => {
      const cur = get().view;
      if (cur !== 'admin' && cur !== 'image') {
        set({ lastModelView: cur });
      }
      set({ view: 'admin', transitionTo: null });
    },

    sendSnapshotsToImage: (ids) => {
      const unique = [...new Set(ids.filter(Boolean))];
      if (!unique.length) {
        get().pushToast('请先选择至少一张模型快照', 'info');
        return;
      }
      if (isScratchProjectId(get().activeProjectId)) {
        set({ pendingPromote: { kind: 'toImage', snapshotIds: unique } });
        return;
      }
      get().executeSendSnapshotsToImage(unique);
    },

    start3DFromImageEditor: () => {
      if (isScratchProjectId(get().activeProjectId)) {
        set({ pendingPromote: { kind: 'to3d' } });
        return;
      }
      get().executeStart3DFromImageEditor();
    },

    requestPromoteForToImage: (snapshotIds) => {
      const unique = [...new Set(snapshotIds.filter(Boolean))];
      if (!unique.length) {
        get().pushToast('请先选择至少一张模型快照', 'info');
        return;
      }
      set({ pendingPromote: { kind: 'toImage', snapshotIds: unique } });
    },

    requestPromoteForTo3d: () => set({ pendingPromote: { kind: 'to3d' } }),

    cancelPendingPromote: () => set({ pendingPromote: null }),

    confirmPendingPromote: (name) => {
      const pending = get().pendingPromote;
      if (!pending) return;
      const id = get().promoteCurrentToProject(
        name?.trim() || defaultFormalProjectName(),
        {
          // 图生模型：只带走当前原图，其余原图留在未立项空间
          retainOtherImageAlbumsInScratch: pending.kind === 'to3d',
        },
      );
      if (!id) {
        set({ pendingPromote: null });
        return;
      }
      const action = pending;
      set({ pendingPromote: null });
      if (action.kind === 'toImage') {
        get().executeSendSnapshotsToImage(action.snapshotIds);
      } else {
        get().executeStart3DFromImageEditor();
      }
    },

    executeSendSnapshotsToImage: (ids) => {
      const unique = [...new Set(ids.filter(Boolean))];
      if (!unique.length) {
        get().pushToast('请先选择至少一张模型快照', 'info');
        return;
      }
      const shots = get().snapshots;
      const ordered = unique
        .map((id) => shots.find((s) => s.id === id))
        .filter((s): s is ModelSnapshot => Boolean(s));
      if (!ordered.length) {
        get().pushToast('所选快照已不存在，请重新选择', 'warning');
        return;
      }
      const first = ordered[0];
      const cur = get().view;
      set({
        imageSessionSnapshotIds: ordered.map((s) => s.id),
        viewingSnapshotId: null,
        previewingSnapshotId: null,
        lastModelView: cur !== 'image' ? cur : get().lastModelView,
        view: 'image',
        transitionTo: null,
      });
      useImageStore.getState().importSnapshotAlbums(
        ordered.map((s) => ({ id: s.id, url: s.url, label: s.label })),
      );
      get().pushToast(
        ordered.length === 1
          ? `已同步「${first.label}」到图片工具`
          : `已同步 ${ordered.length} 张模型截图到图片工具`,
        'success',
      );
    },

    executeStart3DFromImageEditor: () => {
      void (async () => {
        const img = useImageStore.getState();
        let url = await img.getWorkingImageUrl();
        if (!url) {
          get().pushToast('请先在图片模块载入一张图片', 'info');
          return;
        }
        if (img.overlays.length) {
          await img.flattenOverlays();
          url = useImageStore.getState().currentUrl ?? url;
        }
        let handoff = url;
        if (url.startsWith('blob:')) {
          try {
            const res = await fetch(url);
            const blob = await res.blob();
            handoff = URL.createObjectURL(blob);
          } catch {
            /* keep original */
          }
        }

        const albumLabel =
          img.sourceAlbums.find((a) => a.id === img.activeSourceId)?.label ||
          '来源原图';

        get().setImage({
          url: handoff,
          name: '图片模块-图生模型.png',
          size: 0,
        });
        await get().ensureSourceImageSnapshot({
          url: handoff,
          label: albumLabel,
          force: true,
        });
        get().pushToast('已进入图生模型流程，原图已写入模型快照', 'success');
        get().analyze();
      })();
    },

    logoReset: () => {
      const { image, activeProjectId } = get();
      if (image?.url?.startsWith('blob:')) URL.revokeObjectURL(image.url);
      const bag = emptyBag();
      projectBags.set(activeProjectId, bag);
      const name = isScratchProjectId(activeProjectId)
        ? SCRATCH_PROJECT_NAME
        : get().projectName;
      hydrateBag(bag, name);
      get().pushToast('已清空当前项目数据', 'info');
    },

    back: () => {
      const { view } = get();
      if (view === 'image') {
        get().enterModelModule();
        return;
      }
      if (view === 'workbench3d') set({ view: 'workbench2d' });
      else if (view === 'workbench2d') set({ view: 'upload' });
    },

    setImage: (img) => {
      const prev = get().image;
      if (prev?.url?.startsWith('blob:')) URL.revokeObjectURL(prev.url);
      set({ image: img });
    },

    clearImage: () => {
      const prev = get().image;
      if (prev?.url?.startsWith('blob:')) URL.revokeObjectURL(prev.url);
      set({
        image: null,
        grid: null,
        layers: [],
        selectedLayerId: null,
        selectedLayerIds: [],
      });
    },

    analyze: () => {
      set({
        view: 'analysis',
        transitionTo: null,
        aiRunning: true,
        aiStage: '正在初始化 AI 模型',
        aiProgress: 0,
        aiError: null,
        aiUsedFallback: false,
        past: [],
        future: [],
        opLog: [],
        materialTool: 'none',
        activePaint: null,
        editTool: 'select',
      });
      void get().runAnalysis();
    },

    resegment: () => {
      get().analyze();
    },

    runAnalysis: async () => {
      const image = get().image;
      if (!image) return;
      const onProgress = (stage: string, fraction: number) =>
        set({ aiStage: stage, aiProgress: fraction });

      try {
        const raw = await runSceneAI(image.url, onProgress);
        const { grid, layers } = buildScene(raw, get().config.topology);
        set({
          grid,
          layers,
          selectedLayerId: null,
          selectedLayerIds: [],
          aiRunning: false,
          aiUsedFallback: false,
        });
      } catch (e) {
        console.error('[Aurora] AI 分析失败，使用离线分层方案', e);
        const detail = (e as Error)?.message?.trim() || '模型加载或推理失败';
        const raw = generateFallbackScene();
        const { grid, layers } = buildScene(raw, get().config.topology);
        set({
          grid,
          layers,
          selectedLayerId: null,
          selectedLayerIds: [],
          aiRunning: false,
          aiUsedFallback: true,
          aiError: detail,
        });
      }

      // advance once analysis completes
      if (get().pendingBuildAfterAnalysis) {
        set({ pendingBuildAfterAnalysis: false });
        if (get().aiUsedFallback) {
          const detail = get().aiError;
          const short =
            detail && detail.length > 72 ? `${detail.slice(0, 72)}…` : detail;
          get().pushToast(
            short
              ? `AI 分析失败（${short}），已用离线分层继续构建 3D`
              : 'AI 分析失败，已用离线分层继续构建 3D',
            'warning',
          );
        } else {
          get().pushToast('已重新分层，开始构建 3D 模型', 'success');
        }
        get().build3D();
        return;
      }

      set({ view: 'workbench2d' });
      if (get().aiUsedFallback) {
        const detail = get().aiError;
        const short =
          detail && detail.length > 72 ? `${detail.slice(0, 72)}…` : detail;
        get().pushToast(
          short
            ? `AI 分析失败（${short}），已使用离线分层方案`
            : 'AI 分析失败，已使用离线分层方案',
          'warning',
        );
      } else {
        get().pushToast('AI 语义分割与深度估算完成', 'success');
      }
    },

    build3D: (opts) => {
      if (opts?.resegmentFirst) {
        if (!get().image) {
          get().pushToast('请先上传图片', 'info');
          return;
        }
        set({ pendingBuildAfterAnalysis: true });
        get().analyze();
        return;
      }
      if (isMeshyModel(get().config.aiModel)) {
        void get().runMeshyBuild();
        return;
      }
      void (async () => {
        await get().ensureSourceImageSnapshot();
        get().setMeshyModelUrl(null);
        // Apply pending generation settings at rebuild time.
        const topology = get().config.topology ?? 'triangle';
        const faceQuality = get().config.faceQuality ?? 'auto';
        set({
          layers: get().layers.map((l) =>
            l.topology === topology ? l : { ...l, topology },
          ),
          appliedFaceQuality: faceQuality,
          cameraMode: false,
          viewingSnapshotId: null,
          previewingSnapshotId: null,
        });
        const usage = await useAuthStore.getState().trackUsage('modelGen');
        if (!usage.ok) {
          if (!useAuthStore.getState().quotaOpen) {
            get().pushToast(usage.error, 'error');
          }
          return;
        }
        get().startTransition('build', 'workbench3d');
      })();
    },

    setMeshyModelUrl: (url) => set({ meshyModelUrl: url }),

    runMeshyBuild: async () => {
      const image = get().image;
      if (!image?.url) {
        get().pushToast('请先上传图片', 'info');
        return;
      }
      const usage = await useAuthStore.getState().trackUsage('modelGen');
      if (!usage.ok) {
        if (!useAuthStore.getState().quotaOpen) {
          get().pushToast(usage.error, 'error');
        }
        return;
      }
      await get().ensureSourceImageSnapshot({
        url: image.url,
        label: image.name?.replace(/\.[^.]+$/, '') || '来源原图',
      });
      set({
        view: 'build',
        transitionTo: null,
        aiRunning: true,
        aiStage: '正在提交 Meshy Smart Topology 任务…',
        aiProgress: 0.02,
        aiError: null,
      });
      try {
        const { textureGen, textureQuality, pbr } = get().config;
        const taskId = await createMeshyImageTo3d({
          imageUrl: image.url,
          enablePbr: pbr,
          textureQuality: textureGen ? textureQuality : '2K',
        });
        set({ aiStage: 'Meshy 生成中…', aiProgress: 0.08 });
        const { glbUrl } = await pollMeshyImageTo3d(taskId, (progress, status) => {
          set({
            aiStage: `Meshy · ${status}`,
            aiProgress: Math.min(0.98, Math.max(0.08, progress / 100)),
          });
        });
        set({
          meshyModelUrl: glbUrl,
          aiRunning: false,
          aiProgress: 1,
          aiStage: '完成',
          view: 'workbench3d',
          transitionTo: null,
          cameraMode: false,
          viewingSnapshotId: null,
          previewingSnapshotId: null,
        });
        get().pushToast('Meshy 三维模型已生成', 'success');
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        set({
          aiRunning: false,
          aiError: message,
          view: 'workbench2d',
          transitionTo: null,
        });
        get().pushToast(message, 'error');
      }
    },

    selectLayer: (id, additive = false) => {
      if (id === null) {
        set({ selectedLayerIds: [], selectedLayerId: null });
        return;
      }
      if (additive) {
        const cur = get().selectedLayerIds;
        const nextIds = cur.includes(id)
          ? cur.filter((x) => x !== id)
          : [...cur, id];
        set({
          selectedLayerIds: nextIds,
          selectedLayerId: nextIds[nextIds.length - 1] ?? null,
        });
      } else {
        set({ selectedLayerIds: [id], selectedLayerId: id });
      }
    },

    selectAllLayers: () => {
      const { layers, layerFilter } = get();
      const ids = layers
        .filter((l) => matchesFilter(l, layerFilter))
        .map((l) => l.id);
      set({
        selectedLayerIds: ids,
        selectedLayerId: ids[ids.length - 1] ?? null,
      });
    },

    clearSelection: () => set({ selectedLayerIds: [], selectedLayerId: null }),

    setLayerFilter: (f) => set({ layerFilter: f }),

    setProjectName: (name) => {
      if (isScratchProjectId(get().activeProjectId)) {
        get().pushToast('未立项空间不可重命名，请先新立项', 'info');
        return;
      }
      const next = name.trim() || defaultFormalProjectName();
      const id = get().activeProjectId;
      set({
        projectName: next,
        projects: ensureScratchMeta(
          get().projects.map((p) =>
            p.id === id ? { ...p, name: next, updatedAt: Date.now() } : p,
          ),
        ),
      });
    },

    saveActiveProjectBag: () => {
      const id = get().activeProjectId;
      projectBags.set(id, captureBag());
      set({
        projects: ensureScratchMeta(
          get().projects.map((p) =>
            p.id === id ? { ...p, updatedAt: Date.now() } : p,
          ),
        ),
      });
    },

    switchProject: (id) => {
      if (id === get().activeProjectId) return;
      const target = get().projects.find((p) => p.id === id);
      if (!target) return;

      projectBags.set(get().activeProjectId, captureBag());
      set({
        projects: ensureScratchMeta(
          get().projects.map((p) =>
            p.id === get().activeProjectId
              ? { ...p, name: get().projectName, updatedAt: Date.now() }
              : p,
          ),
        ),
        pendingPromote: null,
      });

      const bag = projectBags.get(id) ?? emptyBag();
      projectBags.set(id, bag);

      const displayName = isScratchProjectId(id)
        ? SCRATCH_PROJECT_NAME
        : target.name;
      set({ activeProjectId: id, projectName: displayName });
      hydrateBag(bag, displayName);
      get().pushToast(`已切换到「${displayName}」`, 'info');
    },

    promoteCurrentToProject: (name, opts) => {
      const fromScratch = isScratchProjectId(get().activeProjectId);
      const projectName = (
        name?.trim() || defaultFormalProjectName()
      ).trim();
      if (!projectName) return null;

      const retainOthers =
        fromScratch && Boolean(opts?.retainOtherImageAlbumsInScratch);

      // Snapshot current work twice so bags don't share the same object.
      const workA = captureBag();
      projectBags.set(get().activeProjectId, workA);
      let workB = captureBag();

      if (retainOthers) {
        const { projectImage, scratchImage } =
          splitImageBagForTo3dPromote(workB.image);
        workB = { ...workB, image: projectImage };
        projectBags.set(SCRATCH_PROJECT_ID, {
          ...emptyBag(),
          image: scratchImage,
        });
      }

      const id = newProjectId();
      projectBags.set(id, workB);

      if (fromScratch && !retainOthers) {
        projectBags.set(SCRATCH_PROJECT_ID, emptyBag());
      }

      const prevMeta = get().projects.map((p) =>
        p.id === get().activeProjectId
          ? {
              ...p,
              name: fromScratch
                ? SCRATCH_PROJECT_NAME
                : get().projectName,
              updatedAt: Date.now(),
              kind: fromScratch ? ('scratch' as const) : (p.kind ?? 'project'),
            }
          : p,
      );

      set({
        projects: ensureScratchMeta([
          ...prevMeta,
          {
            id,
            name: projectName,
            updatedAt: Date.now(),
            kind: 'project',
          },
        ]),
        activeProjectId: id,
        projectName,
      });
      hydrateBag(workB, projectName);
      const kept =
        retainOthers &&
        (projectBags.get(SCRATCH_PROJECT_ID)?.image.sourceAlbums?.length ?? 0);
      get().pushToast(
        fromScratch
          ? kept
            ? `已立项「${projectName}」，其余 ${kept} 张原图仍在未立项空间`
            : `已立项「${projectName}」`
          : `已另存副本「${projectName}」`,
        'success',
      );
      return id;
    },

    createProject: (name) => {
      get().promoteCurrentToProject(name);
    },

    createBlankProject: (name) => {
      const projectName = (
        name?.trim() || defaultFormalProjectName()
      ).trim();
      if (!projectName) return null;

      const activeId = get().activeProjectId;
      projectBags.set(activeId, captureBag());

      const id = newProjectId();
      const blank = emptyBag();
      projectBags.set(id, blank);

      const prevMeta = get().projects.map((p) =>
        p.id === activeId
          ? {
              ...p,
              name: isScratchProjectId(activeId)
                ? SCRATCH_PROJECT_NAME
                : get().projectName,
              updatedAt: Date.now(),
            }
          : p,
      );

      set({
        projects: ensureScratchMeta([
          ...prevMeta,
          {
            id,
            name: projectName,
            updatedAt: Date.now(),
            kind: 'project',
          },
        ]),
        activeProjectId: id,
        projectName,
        pendingPromote: null,
      });
      hydrateBag(blank, projectName);
      get().pushToast(`已创建空白项目「${projectName}」`, 'success');
      return id;
    },

    removeProject: (id) => {
      if (isScratchProjectId(id)) {
        get().pushToast('未立项空间不可删除', 'info');
        return false;
      }
      const target = get().projects.find((p) => p.id === id);
      if (!target) return false;

      const wasActive = get().activeProjectId === id;
      if (wasActive) {
        // Persist nothing into deleted bag; switch away first conceptually.
        projectBags.set(SCRATCH_PROJECT_ID, projectBags.get(SCRATCH_PROJECT_ID) ?? emptyBag());
      } else {
        projectBags.set(get().activeProjectId, captureBag());
      }

      projectBags.delete(id);
      const nextProjects = ensureScratchMeta(
        get().projects.filter((p) => p.id !== id),
      );

      if (wasActive) {
        const scratchBag = projectBags.get(SCRATCH_PROJECT_ID) ?? emptyBag();
        projectBags.set(SCRATCH_PROJECT_ID, scratchBag);
        set({
          projects: nextProjects,
          activeProjectId: SCRATCH_PROJECT_ID,
          projectName: SCRATCH_PROJECT_NAME,
          pendingPromote: null,
        });
        hydrateBag(scratchBag, SCRATCH_PROJECT_NAME);
      } else {
        set({ projects: nextProjects });
      }

      get().pushToast(`已删除「${target.name}」`, 'info');
      return true;
    },

    addLayer: (name, dimension) => {
      const { grid } = get();
      if (!grid) return;
      commit('新增图层');
      const key = maxKey(get().layers) + 1;
      const color = PALETTE[get().layers.length % PALETTE.length];
      const layer: Layer = {
        id: uid('layer'),
        key,
        name: name.trim() || '新建图层',
        category: '自定义',
        dimension,
        visible: true,
        color,
        height: dimension === '3D' ? 0.9 : 0.06,
        kind: 'generic',
        material: newLayerMaterial('自定义材质'),
        topology: get().config.topology ?? 'triangle',
        transform: { x: 0, y: 0, z: 0, scale: 1, rx: 0, ry: 0, rz: 0 },
      };
      // stamp a central block into the grid
      const { width, height } = grid;
      const cells = Int16Array.from(grid.cells);
      for (let gy = Math.floor(height * 0.42); gy < height * 0.58; gy++) {
        for (let gx = Math.floor(width * 0.42); gx < width * 0.58; gx++) {
          cells[gy * width + gx] = key;
        }
      }
      set({
        layers: [...get().layers, layer],
        grid: withCells(cells),
        selectedLayerId: layer.id,
        selectedLayerIds: [layer.id],
      });
      get().pushToast(`已新增图层「${layer.name}」`, 'success');
    },

    removeLayer: (id) => {
      const { grid, layers, selectedLayerIds } = get();
      const ids =
        selectedLayerIds.length > 1 && selectedLayerIds.includes(id)
          ? selectedLayerIds
          : [id];
      const victims = layers.filter((l) => ids.includes(l.id));
      if (victims.length === 0) return;
      commit(
        victims.length === 1
          ? `删除「${victims[0].name}」`
          : `删除 ${victims.length} 个组件`,
      );
      const victimKeys = new Set(victims.map((l) => l.key));
      const victimIds = new Set(victims.map((l) => l.id));
      const ground = layers.find(
        (l) => l.kind === 'ground' && !victimIds.has(l.id),
      );
      const fill = ground ? ground.key : -1;
      let nextGrid = grid;
      if (grid) {
        const cells = Int16Array.from(grid.cells);
        for (let i = 0; i < cells.length; i++) {
          if (victimKeys.has(cells[i])) cells[i] = fill;
        }
        nextGrid = { ...grid, cells };
      }
      set({
        grid: nextGrid,
        layers: layers.filter((l) => !victimIds.has(l.id)),
        selectedLayerIds: [],
        selectedLayerId: null,
      });
    },

    toggleVisibility: (id) => {
      const target = get().layers.find((l) => l.id === id);
      if (!target) return;
      commit(target.visible ? `隐藏「${target.name}」` : `显示「${target.name}」`);
      const nextVisible = !target.visible;
      const ids = syncTargets(id);
      set({
        layers: get().layers.map((l) =>
          ids.has(l.id) ? { ...l, visible: nextVisible } : l,
        ),
      });
    },

    setDimension: (id, dimension) => {
      const layer = get().layers.find((l) => l.id === id);
      commit(
        layer
          ? `切换「${layer.name}」为 ${dimension}`
          : `切换为 ${dimension}`,
      );
      const ids = syncTargets(id);
      set({
        layers: get().layers.map((l) =>
          ids.has(l.id)
            ? {
                ...l,
                dimension,
                height: dimension === '3D' ? Math.max(l.height, 0.4) : 0.06,
              }
            : l,
        ),
      });
    },

    setTopology: (id, topology) => {
      const layer = get().layers.find((l) => l.id === id);
      const label = topology === 'quad' ? '四边面' : '三角面';
      commit(
        layer ? `「${layer.name}」拓扑 → ${label}` : `拓扑 → ${label}`,
      );
      const ids = syncTargets(id);
      set({
        layers: get().layers.map((l) =>
          ids.has(l.id) ? { ...l, topology } : l,
        ),
      });
    },

    retopologizeAll: (topology) => {
      const label = topology === 'quad' ? '四边面' : '三角面';
      commit(`重拓扑 → ${label}`);
      set({
        config: { ...get().config, topology },
        layers: get().layers.map((l) => ({ ...l, topology })),
      });
      get().pushToast(`已重拓扑为${label}`, 'success');
    },

    renameLayer: (id, name) => {
      const layer = get().layers.find((l) => l.id === id);
      commit(
        layer
          ? `重命名「${layer.name}」→「${name.trim() || layer.name}」`
          : '重命名图层',
      );
      set({
        layers: get().layers.map((l) =>
          l.id === id ? { ...l, name: name.trim() || l.name } : l,
        ),
      });
    },

    splitLayer: (sourceId, name, dimension) => {
      const { grid, layers } = get();
      const source = layers.find((l) => l.id === sourceId);
      if (!grid || !source) return;
      commit(`拆分「${source.name}」`);
      const { width, height } = grid;
      // find the horizontal median column of the source cells
      const xs: number[] = [];
      for (let gy = 0; gy < height; gy++) {
        for (let gx = 0; gx < width; gx++) {
          if (grid.cells[gy * width + gx] === source.key) xs.push(gx);
        }
      }
      if (xs.length === 0) return;
      xs.sort((a, b) => a - b);
      const median = xs[Math.floor(xs.length / 2)];

      const key = maxKey(layers) + 1;
      const child: Layer = {
        ...source,
        id: uid('layer'),
        key,
        name: name.trim() || `${source.name}-拆分`,
        dimension,
        height: dimension === '3D' ? Math.max(source.height, 0.4) : 0.06,
        color: '#7B61FF',
        material: { ...source.material },
      };
      const cells = Int16Array.from(grid.cells);
      for (let gy = 0; gy < height; gy++) {
        for (let gx = median; gx < width; gx++) {
          if (cells[gy * width + gx] === source.key) cells[gy * width + gx] = key;
        }
      }
      const idx = layers.findIndex((l) => l.id === sourceId);
      const next = [...layers];
      next.splice(idx + 1, 0, child);
      set({
        grid: withCells(cells),
        layers: next,
        selectedLayerId: child.id,
        selectedLayerIds: [child.id],
      });
      get().pushToast(`已拆分出图层「${child.name}」`, 'success');
    },

    mergeLayers: (sourceIds, name, materialStrategy) => {
      const { grid, layers } = get();
      if (!grid || sourceIds.length < 2) return;
      const sources = layers.filter((l) => sourceIds.includes(l.id));
      if (sources.length < 2) return;
      commit(`合并 ${sources.length} 个图层`);
      const has2D = sources.some((l) => l.dimension === '2D');
      const has3D = sources.some((l) => l.dimension === '3D');
      const target = sources[0];
      const others = sources.slice(1);
      const otherKeys = new Set(others.map((l) => l.key));

      const cells = Int16Array.from(grid.cells);
      for (let i = 0; i < cells.length; i++) {
        if (otherKeys.has(cells[i])) cells[i] = target.key;
      }

      const merged: Layer = {
        ...target,
        name: name.trim() || '合并图层',
        category: '合并',
        dimension: has3D ? '3D' : '2D',
        height: Math.max(...sources.map((l) => l.height)),
        material: {
          ...target.material,
          preset:
            materialStrategy === 'keep-base'
              ? target.material.preset
              : materialStrategy,
        },
      };

      const otherIds = new Set(others.map((l) => l.id));
      const nextLayers = layers
        .filter((l) => !otherIds.has(l.id))
        .map((l) => (l.id === target.id ? merged : l));

      set({
        grid: withCells(cells),
        layers: nextLayers,
        selectedLayerId: merged.id,
        selectedLayerIds: [merged.id],
      });
      get().pushToast(
        has2D && has3D
          ? '已合并 2D/3D 混合图层，请注意核对结果'
          : `已合并为「${merged.name}」`,
        has2D && has3D ? 'warning' : 'success',
      );
    },

    updateMaterial: (id, material) => {
      const layer = get().layers.find((l) => l.id === id);
      const label =
        material.name && material.name !== layer?.material.name
          ? `重命名材质为「${material.name}」`
          : layer
            ? `修改「${layer.name}」材质`
            : '修改材质';
      commit(label);
      const ids = syncTargets(id);
      const nextName = material.name?.trim();

      let library = get().materialLibrary;
      let activePaint = get().activePaint;
      let linkedSwatchId = material.swatchId ?? layer?.material.swatchId;

      if (nextName && layer) {
        const sw =
          matchLibrarySwatch(library, {
            swatchId: linkedSwatchId,
            color: material.diffuse ?? layer.color ?? layer.material.diffuse,
            preset: material.preset ?? layer.material.preset,
          }) ?? null;
        if (sw) {
          linkedSwatchId = sw.id;
          library = library.map((s) =>
            s.id === sw.id ? { ...s, name: nextName } : s,
          );
          if (activePaint?.id === sw.id) {
            activePaint = { ...activePaint, name: nextName };
          }
          // Keep other layers linked to the same swatch in sync.
          set({
            materialLibrary: library,
            activePaint,
            layers: get().layers.map((l) => {
              if (ids.has(l.id)) {
                const prev = {
                  ...l.material,
                  name: l.material.name || l.material.preset,
                };
                return {
                  ...l,
                  color: material.diffuse ?? l.color,
                  material: {
                    ...prev,
                    ...material,
                    name: nextName,
                    swatchId: linkedSwatchId,
                  },
                };
              }
              if (l.material.swatchId === sw.id) {
                return {
                  ...l,
                  material: { ...l.material, name: nextName },
                };
              }
              return l;
            }),
          });
          return;
        }
      }

      set({
        layers: get().layers.map((l) => {
          if (!ids.has(l.id)) return l;
          const prev = {
            ...l.material,
            name: l.material.name || l.material.preset,
          };
          return {
            ...l,
            color: material.diffuse ?? l.color,
            material: { ...prev, ...material },
          };
        }),
      });
    },

    updateLibraryMaterial: (swatchId, patch) => {
      const prev = get().materialLibrary.find((s) => s.id === swatchId);
      if (!prev) return;
      const next: MaterialSwatch = {
        ...prev,
        ...patch,
        id: swatchId,
        name: (patch.name ?? prev.name).trim() || prev.name,
      };
      const label =
        patch.name && patch.name.trim() !== prev.name
          ? `重命名材质为「${next.name}」`
          : `修改材质「${next.name}」`;
      commit(label);
      const activePaint = get().activePaint;
      set({
        materialLibrary: get().materialLibrary.map((s) =>
          s.id === swatchId ? next : s,
        ),
        activePaint: activePaint?.id === swatchId ? { ...next } : activePaint,
        layers: get().layers.map((l) => {
          if (l.material.swatchId !== swatchId) return l;
          return {
            ...l,
            color: next.color,
            material: {
              ...l.material,
              name: next.name,
              preset: next.preset,
              diffuse: next.color,
              normal: next.normal ?? l.material.normal,
              roughness: next.roughness ?? l.material.roughness,
              metalness: next.metalness ?? l.material.metalness,
              resolution: next.resolution ?? l.material.resolution,
              swatchId,
            },
          };
        }),
      });
    },

    selectPaintMaterial: (swatch) => {
      set({ activePaint: swatch });
    },

    setMaterialTool: (tool) => {
      if (tool === 'bucket' && !get().activePaint) {
        get().pushToast('请先在材质库中选择一种材质', 'info');
        return;
      }
      set({
        materialTool: tool,
        ...(tool !== 'none' ? { editTool: 'select' as const } : {}),
      });
    },

    applyPaintToLayer: (layerId) => {
      const paint = get().activePaint;
      if (!paint) {
        get().pushToast('请先选择一种材质', 'info');
        return;
      }
      const layer = get().layers.find((l) => l.id === layerId);
      if (!layer) return;
      commit(`油漆桶：应用「${paint.name}」到「${layer.name}」`);
      const mat = materialFromSwatch(paint);
      set({
        layers: get().layers.map((l) =>
          l.id === layerId
            ? {
                ...l,
                color: paint.color,
                material: mat,
              }
            : l,
        ),
      });
      get().pushToast(`已将「${paint.name}」应用到「${layer.name}」`, 'success');
    },

    sampleMaterialFromLayer: (sourceId) => {
      const source = get().layers.find((l) => l.id === sourceId);
      if (!source) return;
      const paint: MaterialSwatch = {
        id: `sampled_${source.id}`,
        name: `${source.name}（吸取）`,
        color: source.color,
        preset: source.material.preset,
      };
      set({ activePaint: paint, materialTool: 'none' });
      get().pushToast(
        `已吸取「${source.name}」材质，可切换油漆桶后点击面进行涂刷`,
        'success',
      );
    },

    setEditTool: (tool) => set({ editTool: tool, materialTool: 'none' }),

    setCameraMode: (on) =>
      set({
        cameraMode: on,
        viewingSnapshotId: on ? get().viewingSnapshotId : null,
        previewingSnapshotId: on ? get().previewingSnapshotId : null,
      }),

    toggleCameraMode: () => {
      const next = !get().cameraMode;
      set({
        cameraMode: next,
        viewingSnapshotId: next ? get().viewingSnapshotId : null,
        previewingSnapshotId: next ? get().previewingSnapshotId : null,
      });
    },

    addSnapshot: (dataUrl, cameraPose) => {
      const n = get().snapshots.length + 1;
      const shot: ModelSnapshot = {
        id: uid('snap'),
        url: dataUrl,
        createdAt: Date.now(),
        label: `快照 ${n}`,
        ...(cameraPose ? { cameraPose } : {}),
      };
      set({
        snapshots: [...get().snapshots, shot],
        cameraMode: true,
      });
      get().pushToast(`已添加「${shot.label}」`, 'success');
    },

    removeSnapshot: (id) => {
      const next = get().snapshots.filter((s) => s.id !== id);
      const viewing = get().viewingSnapshotId;
      const previewing = get().previewingSnapshotId;
      const session = get().imageSessionSnapshotIds;
      set({
        snapshots: next,
        viewingSnapshotId: viewing === id ? null : viewing,
        previewingSnapshotId: previewing === id ? null : previewing,
        imageSessionSnapshotIds: session
          ? session.filter((x) => x !== id)
          : null,
      });
      get().pushToast('已删除快照', 'info');
    },

    renameSnapshot: (id, label) => {
      const next = label.trim();
      if (!next) return;
      set({
        snapshots: get().snapshots.map((s) =>
          s.id === id ? { ...s, label: next } : s,
        ),
      });
    },

    reorderSnapshots: (fromId, toId) => {
      if (fromId === toId) return;
      const list = [...get().snapshots];
      const from = list.findIndex((s) => s.id === fromId);
      const to = list.findIndex((s) => s.id === toId);
      if (from < 0 || to < 0) return;
      const [item] = list.splice(from, 1);
      list.splice(to, 0, item);
      set({ snapshots: list });
    },

    setViewingSnapshot: (id) => {
      set({ viewingSnapshotId: id });
      if (!id) return;
      const shot = get().snapshots.find((s) => s.id === id);
      // Defer one frame so the viewport is free of any snapshot preview overlay.
      requestAnimationFrame(() => {
        const pose = shot?.cameraPose;
        if (pose) viewportController.setCameraPose(pose);
        // No recorded pose (older snapshot): fall back to the default overview.
        else viewportController.setView('perspective');
      });
    },

    setPreviewingSnapshot: (id) => set({ previewingSnapshotId: id }),

    attachCameraPoseToSourceSnapshot: (pose) => {
      const list = get().snapshots;
      const idx = list.findIndex((s) => s.fromSourceImage);
      if (idx < 0) return;
      const prev = list[idx].cameraPose;
      const same =
        prev &&
        prev.position.every((v, i) => Math.abs(v - pose.position[i]) < 1e-3) &&
        prev.target.every((v, i) => Math.abs(v - pose.target[i]) < 1e-3);
      if (same) return;
      const next = [...list];
      next[idx] = { ...next[idx], cameraPose: pose };
      set({ snapshots: next });
    },

    ensureSourceImageSnapshot: async (opts) => {
      const imageUrl = opts?.url ?? get().image?.url;
      if (!imageUrl) return;
      if (!opts?.force && get().snapshots.some((s) => s.fromSourceImage)) {
        return;
      }

      let sourceSnapUrl = imageUrl;
      try {
        const res = await fetch(imageUrl);
        const blob = await res.blob();
        sourceSnapUrl = URL.createObjectURL(blob);
      } catch {
        sourceSnapUrl = imageUrl;
      }

      const prevSource = get().snapshots.filter((s) => s.fromSourceImage);
      prevSource.forEach((s) => {
        if (s.url.startsWith('blob:') && s.url !== sourceSnapUrl) {
          try {
            URL.revokeObjectURL(s.url);
          } catch {
            /* ignore */
          }
        }
      });

      const label =
        opts?.label?.trim() ||
        get().image?.name?.replace(/\.[^.]+$/, '') ||
        '来源原图';

      const keptPose = prevSource[0]?.cameraPose;
      const sourceShot: ModelSnapshot = {
        id: uid('snap'),
        url: sourceSnapUrl,
        createdAt: Date.now(),
        label,
        fromSourceImage: true,
        ...(keptPose && !opts?.force ? { cameraPose: keptPose } : {}),
      };

      set({
        snapshots: [
          sourceShot,
          ...get().snapshots.filter((s) => !s.fromSourceImage),
        ],
      });
    },

    updateSnapshotUrl: (id, url) => {
      set({
        snapshots: get().snapshots.map((s) =>
          s.id === id ? { ...s, url } : s,
        ),
      });
      get().pushToast('已覆盖保存到模型快照', 'success');
    },

    updateLayerTransform: (id, patch, opts) => {
      const shouldCommit = opts?.commit !== false;
      if (shouldCommit) commit(opts?.label ?? '变换组件');
      const ids = syncTargets(id);
      set({
        layers: get().layers.map((l) => {
          if (!ids.has(l.id)) return l;
          const t = l.transform ?? {
            x: 0,
            y: 0,
            z: 0,
            scale: 1,
            rx: 0,
            ry: 0,
            rz: 0,
          };
          return {
            ...l,
            transform: {
              x: patch.x ?? t.x,
              y: patch.y ?? t.y ?? 0,
              z: patch.z ?? t.z,
              scale: Math.max(0.15, Math.min(6, patch.scale ?? t.scale)),
              rx: patch.rx ?? t.rx ?? 0,
              ry: patch.ry ?? t.ry ?? 0,
              rz: patch.rz ?? t.rz ?? 0,
            },
          };
        }),
      });
    },

    regenerateLayer: (id) => {
      const layer = get().layers.find((l) => l.id === id);
      if (layer) get().pushToast(`已重新生成「${layer.name}」的网格`, 'success');
    },

    duplicateLayer: (id) => {
      const { grid, layers } = get();
      const src = layers.find((l) => l.id === id);
      if (!grid || !src) return;
      commit(`复制「${src.name}」`);
      const key = maxKey(layers) + 1;
      const copy: Layer = {
        ...src,
        id: uid('layer'),
        key,
        name: `${src.name} 副本`,
        material: { ...src.material },
        transform: {
          ...(src.transform ?? {
            x: 0,
            y: 0,
            z: 0,
            scale: 1,
            rx: 0,
            ry: 0,
            rz: 0,
          }),
        },
      };
      const { width, height } = grid;
      const dx = Math.round(width * 0.05);
      const dy = -Math.round(height * 0.05);
      const cells = Int16Array.from(grid.cells);
      // stamp a shifted copy of the source footprint
      for (let gy = 0; gy < height; gy++) {
        for (let gx = 0; gx < width; gx++) {
          if (grid.cells[gy * width + gx] === src.key) {
            const nx = gx + dx;
            const ny = gy + dy;
            if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
              cells[ny * width + nx] = key;
            }
          }
        }
      }
      const idx = layers.findIndex((l) => l.id === id);
      const next = [...layers];
      next.splice(idx + 1, 0, copy);
      set({
        grid: withCells(cells),
        layers: next,
        selectedLayerId: copy.id,
        selectedLayerIds: [copy.id],
      });
      get().pushToast(`已复制「${src.name}」`, 'success');
    },

    setConfig: (patch) => {
      const next = { ...get().config, ...patch };
      if (patch.aiModel !== undefined) {
        next.aiModel = resolveAiModel(patch.aiModel);
      }
      set({ config: next });
    },
    setViewport: (patch) => set({ viewport: { ...get().viewport, ...patch } }),
    setExportSettings: (patch) =>
      set({ exportSettings: { ...get().exportSettings, ...patch } }),

    pushToast: (text, tone = 'info') => {
      // Quota exhausted uses a dedicated modal; skip duplicate toasts.
      if (
        typeof text === 'string' &&
        (text.includes('限额已经使用完') || text.includes('次数已用完'))
      ) {
        useAuthStore.getState().notifyQuotaError(text);
        return;
      }
      const id = uid('toast');
      set({ toasts: [...get().toasts, { id, text, tone }] });
      setTimeout(() => get().dismissToast(id), 3000);
    },
    dismissToast: (id) =>
      set({ toasts: get().toasts.filter((t) => t.id !== id) }),

    undo: () => {
      const { past, layers, grid, future, opLog } = get();
      if (past.length === 0) {
        get().pushToast('没有可撤销的操作', 'info');
        return;
      }
      const prev = past[past.length - 1];
      set({
        layers: prev.layers,
        grid: grid ? { ...grid, cells: prev.cells } : null,
        past: past.slice(0, -1),
        future: [
          {
            layers,
            cells: grid ? Int16Array.from(grid.cells) : new Int16Array(0),
          },
          ...future,
        ].slice(0, HISTORY_LIMIT),
        opLog: opLog.slice(0, -1),
      });
    },

    redo: () => {
      const { past, layers, grid, future } = get();
      if (future.length === 0) {
        get().pushToast('没有可重做的操作', 'info');
        return;
      }
      const next = future[0];
      set({
        layers: next.layers,
        grid: grid ? { ...grid, cells: next.cells } : null,
        past: [
          ...past,
          {
            layers,
            cells: grid ? Int16Array.from(grid.cells) : new Int16Array(0),
          },
        ].slice(-HISTORY_LIMIT),
        future: future.slice(1),
        opLog: [
          ...get().opLog,
          { id: uid('op'), label: '重做', at: Date.now() },
        ].slice(-HISTORY_LIMIT),
      });
    },
  };
});
