import { apiUrl } from '../config/api';
import type { AssetItem, AssetKind } from '../store/useAssetStore';

export type AssetRole = 'original' | 'result' | 'model';

function authHeader(token?: string): HeadersInit {
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function readJson(res: Response) {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const raw = (data && (data.error || data.message)) || `请求失败（${res.status}）`;
    const msg = /UserDisable/i.test(String(raw))
      ? '当前账号访问资产服务受限，请联系管理员'
      : raw;
    throw new Error(msg);
  }
  return data;
}

function ossKeyFromUrl(url: string): string | null {
  if (url.startsWith('oss:')) return url.slice(4);
  try {
    const u = new URL(url, window.location.origin);
    const directPath = decodeURIComponent(u.pathname.replace(/^\//, ''));
    if (directPath.startsWith('assets/') || directPath.startsWith('projects/')) {
      return directPath;
    }
    const key = decodeURIComponent(u.searchParams.get('key') || '').replace(/^\//, '');
    if (key.startsWith('assets/') || key.startsWith('projects/')) return key;
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

async function urlToAssetPayload(
  url: string,
): Promise<{ dataUrl?: string; reuseKey?: string }> {
  const raw = String(url || '').trim();
  if (!raw || raw.startsWith('asset:') || /^asset_/i.test(raw)) {
    throw new Error('图片地址无效，无法保存到资产');
  }
  const reuseKey = ossKeyFromUrl(raw);
  if (reuseKey) return { reuseKey };
  if (raw.startsWith('data:')) return { dataUrl: raw };
  if (raw.startsWith('blob:')) {
    const res = await fetch(raw);
    if (!res.ok) throw new Error('读取本地图片失败');
    return { dataUrl: await blobToDataUrl(await res.blob()) };
  }
  const res = await fetch(raw, { credentials: 'include' });
  if (!res.ok) throw new Error(`读取图片失败（${res.status}）`);
  return { dataUrl: await blobToDataUrl(await res.blob()) };
}

export async function apiDeleteAssets(ids: string[], token?: string) {
  const res = await fetch(apiUrl('/api/assets'), {
    method: 'DELETE',
    headers: {
      'Content-Type': 'application/json',
      ...authHeader(token),
    },
    credentials: 'include',
    body: JSON.stringify({ ids }),
  });
  return readJson(res) as Promise<{ ok: boolean; deletedIds?: string[] }>;
}

export async function apiListAssets(
  opts?: { role?: AssetRole; projectId?: string },
  token?: string,
): Promise<AssetItem[]> {
  const q = new URLSearchParams();
  if (opts?.role) q.set('role', opts.role);
  if (opts?.projectId) q.set('projectId', opts.projectId);
  const qs = q.toString();
  const res = await fetch(apiUrl(`/api/assets${qs ? `?${qs}` : ''}`), {
    headers: { ...authHeader(token) },
    credentials: 'include',
  });
  const data = (await readJson(res)) as { entries?: AssetItem[] };
  return Array.isArray(data.entries) ? data.entries : [];
}

export async function apiSaveAsset(
  input: {
    id?: string;
    kind: AssetKind;
    url: string;
    label: string;
    projectId?: string;
    projectName?: string;
    prompt?: string;
    createdAt?: number;
    role?: AssetRole;
  },
  token?: string,
): Promise<AssetItem> {
  const payload = await urlToAssetPayload(input.url);
  const body: Record<string, unknown> = {
    id: input.id,
    kind: input.kind,
    label: input.label,
    projectId: input.projectId,
    projectName: input.projectName,
    prompt: input.prompt,
    createdAt: input.createdAt,
    role: input.role,
    ...payload,
  };
  const res = await fetch(apiUrl('/api/assets'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...authHeader(token),
    },
    credentials: 'include',
    body: JSON.stringify(body),
  });
  const data = (await readJson(res)) as { asset?: AssetItem };
  if (!data.asset) throw new Error('资产保存失败');
  return data.asset;
}
