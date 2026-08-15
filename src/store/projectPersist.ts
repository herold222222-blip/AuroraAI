import {
  apiDeleteProject,
  apiListMyProjects,
  apiSaveProject,
  type ProjectAssetPayload,
  type RemoteProject,
} from '../api/projectApi';
import type { ProjectBag } from './projectBag';
import { emptyImageBag, isScratchProjectId } from './projectBag';

/** 解析失败时仍可出现在项目列表里的占位袋（避免「库里有、界面无」） */
function stubBag(): ProjectBag {
  return {
    model: {
      view: 'upload',
      lastModelView: 'upload',
      image: null,
      grid: null,
      layers: [],
      selectedLayerId: null,
      selectedLayerIds: [],
      layerFilter: 'all',
      config: {} as ProjectBag['model']['config'],
      viewport: {} as ProjectBag['model']['viewport'],
      exportSettings: {} as ProjectBag['model']['exportSettings'],
      materialLibrary: [],
      activePaint: null,
      materialTool: 'none',
      editTool: 'select',
      cameraMode: false,
      snapshots: [],
      viewingSnapshotId: null,
      imageSessionSnapshotIds: null,
      meshyModelUrl: null,
    },
    image: emptyImageBag(),
  };
}

const LAST_FORMAL_KEY = 'aurora-last-formal-project';

export function readLastFormalProjectId(): string | null {
  try {
    return localStorage.getItem(LAST_FORMAL_KEY);
  } catch {
    return null;
  }
}

export function writeLastFormalProjectId(id: string | null) {
  try {
    if (!id || isScratchProjectId(id)) localStorage.removeItem(LAST_FORMAL_KEY);
    else localStorage.setItem(LAST_FORMAL_KEY, id);
  } catch {
    /* ignore */
  }
}

function ossKeyFromUrl(url: string): string | null {
  if (url.startsWith('oss:')) return url.slice(4);
  try {
    const u = new URL(url);
    const path = decodeURIComponent(u.pathname.replace(/^\//, ''));
    if (path.startsWith('projects/')) return path;
  } catch {
    /* ignore */
  }
  return null;
}

async function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result || ''));
    r.onerror = () => reject(r.error || new Error('读取文件失败'));
    r.readAsDataURL(blob);
  });
}

async function urlToPayload(
  url: string,
): Promise<{ dataUrl?: string; reuseKey?: string } | null> {
  const reuse = ossKeyFromUrl(url);
  if (reuse) return { reuseKey: reuse };
  if (url.startsWith('data:')) return { dataUrl: url };
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const blob = await res.blob();
    if (!blob.size) return null;
    return { dataUrl: await blobToDataUrl(blob) };
  } catch {
    return null;
  }
}

function serializeGrid(bag: ProjectBag): unknown {
  const g = bag.model.grid;
  return {
    ...bag,
    image: {
      ...bag.image,
      past: [],
      future: [],
    },
    model: {
      ...bag.model,
      grid: g
        ? {
            width: g.width,
            height: g.height,
            cells: Array.from(g.cells),
            depth: Array.from(g.depth),
          }
        : null,
    },
  };
}

export function reviveProjectBag(raw: unknown): ProjectBag {
  const bag = (raw || {}) as Partial<ProjectBag>;
  if (!bag.model || !bag.image) {
    throw new Error('项目数据不完整');
  }
  const g = bag.model.grid as
    | {
        width: number;
        height: number;
        cells: ArrayLike<number>;
        depth: ArrayLike<number>;
      }
    | null
    | undefined;
  return {
    model: {
      ...bag.model,
      layers: bag.model.layers || [],
      selectedLayerIds: bag.model.selectedLayerIds || [],
      snapshots: bag.model.snapshots || [],
      materialLibrary: bag.model.materialLibrary || [],
      grid: g
        ? {
            width: g.width,
            height: g.height,
            cells: Int16Array.from(g.cells || []),
            depth: Float32Array.from(g.depth || []),
          }
        : null,
    },
    image: {
      ...bag.image,
      materials: bag.image.materials || [],
      savedImages: bag.image.savedImages || [],
      sourceAlbums: bag.image.sourceAlbums || [],
      past: bag.image.past || [],
      future: bag.image.future || [],
    },
  };
}

export async function buildProjectSavePayload(bag: ProjectBag): Promise<{
  bag: unknown;
  assets: ProjectAssetPayload[];
}> {
  const serial = serializeGrid(bag);
  const collected = new Map<string, string>();

  const walk = (value: unknown): unknown => {
    if (typeof value === 'string') {
      if (
        value.startsWith('data:') ||
        value.startsWith('blob:') ||
        value.startsWith('http://') ||
        value.startsWith('https://') ||
        value.startsWith('oss:')
      ) {
        let id = collected.get(value);
        if (!id) {
          id = `a${collected.size + 1}`;
          collected.set(value, id);
        }
        return `asset:${id}`;
      }
      return value;
    }
    if (Array.isArray(value)) return value.map(walk);
    if (value && typeof value === 'object') {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        out[k] = walk(v);
      }
      return out;
    }
    return value;
  };

  const slimBag = walk(serial);
  const assets: ProjectAssetPayload[] = [];
  for (const [url, id] of collected) {
    const payload = await urlToPayload(url);
    if (!payload) continue;
    assets.push({ id, ...payload });
  }
  return { bag: slimBag, assets };
}

export async function saveFormalProjectToCloud(input: {
  projectId: string;
  name: string;
  bag: ProjectBag;
  token: string;
}) {
  if (isScratchProjectId(input.projectId)) return;
  const payload = await buildProjectSavePayload(input.bag);
  return apiSaveProject(
    input.projectId,
    { ...payload, name: input.name },
    input.token,
  );
}

export async function loadRemoteProjects(
  token: string,
): Promise<RemoteProject[]> {
  const res = await apiListMyProjects(token);
  const out: RemoteProject[] = [];
  for (const p of res.projects || []) {
    try {
      out.push({ ...p, bag: reviveProjectBag(p.bag) });
    } catch (err) {
      // 仍保留列表项，避免「接口有项目、界面空白」；打开时用空袋
      console.error('[projects] revive failed', p.id, p.name, err);
      out.push({ ...p, bag: stubBag() });
    }
  }
  return out;
}

export async function deleteFormalProjectRemote(
  projectId: string,
  token: string,
) {
  if (isScratchProjectId(projectId)) return;
  return apiDeleteProject(projectId, token);
}
