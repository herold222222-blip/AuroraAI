import { apiUrl } from '../config/api';
import type { ProjectBag } from '../store/projectBag';

function authHeader(token?: string): HeadersInit {
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export type ProjectAssetPayload = {
  id: string;
  dataUrl?: string;
  reuseKey?: string;
};

export type RemoteProject = {
  id: string;
  name: string;
  updatedAt: number;
  version?: number;
  storagePath?: string;
  bag: ProjectBag;
};

async function readJson(res: Response) {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(
      (data && (data.error || data.message)) || `请求失败（${res.status}）`,
    );
  }
  return data;
}

export async function apiSaveProject(
  projectId: string,
  payload: {
    name: string;
    bag: unknown;
    assets: ProjectAssetPayload[];
  },
  token?: string,
) {
  const res = await fetch(apiUrl('/api/projects/save'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...authHeader(token),
    },
    body: JSON.stringify({
      projectId,
      name: payload.name,
      bag: payload.bag,
      assets: payload.assets,
    }),
  });
  return readJson(res);
}

export async function apiGetProject(projectId: string, token?: string) {
  const res = await fetch(apiUrl(`/api/projects/${encodeURIComponent(projectId)}`), {
    headers: { ...authHeader(token) },
  });
  return readJson(res) as Promise<{ ok: boolean; project: RemoteProject }>;
}

export async function apiListMyProjects(token?: string) {
  const res = await fetch(apiUrl('/api/projects'), {
    headers: { ...authHeader(token) },
  });
  return readJson(res) as Promise<{ ok: boolean; projects: RemoteProject[] }>;
}

export async function apiDeleteProject(projectId: string, token?: string) {
  const res = await fetch(apiUrl(`/api/projects/${encodeURIComponent(projectId)}`), {
    method: 'DELETE',
    headers: { ...authHeader(token) },
  });
  return readJson(res);
}
