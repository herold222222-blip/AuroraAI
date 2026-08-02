import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '..', '.data');
const DATA_FILE = join(DATA_DIR, 'apis.json');

export type ApiKind = 'gemini' | 'qwen' | 'meshy';

export interface StoredApi {
  id: string;
  kind: ApiKind;
  name: string;
  provider: string;
  purpose: string;
  enabled: boolean;
  model: string;
  baseUrl: string;
  note: string;
  /** Optional override; empty means use process.env */
  apiKey: string;
  isPreset: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface PublicApiView {
  id: string;
  kind: ApiKind;
  name: string;
  provider: string;
  purpose: string;
  enabled: boolean;
  model: string;
  baseUrl: string;
  note: string;
  isPreset: boolean;
  hasKey: boolean;
  keyHint: string;
  createdAt: number;
  updatedAt: number;
}

type DbShape = { apis: StoredApi[]; deletedPresetIds: string[] };

const PRESETS: Omit<StoredApi, 'createdAt' | 'updatedAt'>[] = [
  {
    id: 'gemini-image-edit',
    kind: 'gemini',
    name: 'Banana-gemini',
    provider: 'Google Gemini',
    purpose: '图片生成 / 修改',
    enabled: true,
    model: 'gemini-3.1-flash-image',
    baseUrl: '',
    note: '默认改图模型（GEMINI_API_KEY）',
    apiKey: '',
    isPreset: true,
  },
  {
    id: 'qwen-image-edit',
    kind: 'qwen',
    name: 'Qwen-Image',
    provider: '阿里云 DashScope',
    purpose: '图片生成 / 修改',
    enabled: true,
    model: 'qwen-image-edit-plus',
    baseUrl: 'https://dashscope.aliyuncs.com/api/v1',
    note: '千问图像编辑（DASHSCOPE_API_KEY）',
    apiKey: '',
    isPreset: true,
  },
  {
    id: 'meshy-image-to-3d',
    kind: 'meshy',
    name: 'Meshy Image-to-3D',
    provider: 'Meshy',
    purpose: '图生模型',
    enabled: true,
    model: 'meshy-t2',
    baseUrl: 'https://api.meshy.ai/openapi/v1',
    note: '图生三维（MESHY_API_KEY）',
    apiKey: '',
    isPreset: true,
  },
];

function emptyDb(): DbShape {
  return { apis: [], deletedPresetIds: [] };
}

function envKeyFor(kind: ApiKind): string {
  if (kind === 'gemini') {
    return (
      process.env.GEMINI_API_KEY?.trim() ||
      process.env.GOOGLE_API_KEY?.trim() ||
      ''
    );
  }
  if (kind === 'qwen') {
    return (
      process.env.DASHSCOPE_API_KEY?.trim() ||
      process.env.QWEN_API_KEY?.trim() ||
      process.env.QWEN_IMAGE_API_KEY?.trim() ||
      ''
    );
  }
  return process.env.MESHY_API_KEY?.trim() || '';
}

function keyHint(key: string): string {
  if (!key) return '未配置';
  if (key.length <= 8) return '已配置';
  return `****${key.slice(-4)}`;
}

function normalizeApi(raw: Partial<StoredApi>): StoredApi | null {
  const kind = raw.kind;
  if (kind !== 'gemini' && kind !== 'qwen' && kind !== 'meshy') return null;
  const now = Date.now();
  return {
    id: String(raw.id || `${kind}_${now.toString(36)}`),
    kind,
    name: String(raw.name || kind).slice(0, 64),
    provider: String(raw.provider || '').slice(0, 64),
    purpose: String(raw.purpose || '').slice(0, 64),
    enabled: raw.enabled !== false,
    model: String(raw.model || '').slice(0, 120),
    baseUrl: String(raw.baseUrl || '').slice(0, 300),
    note: String(raw.note || '').slice(0, 500),
    apiKey: String(raw.apiKey || ''),
    isPreset: Boolean(raw.isPreset),
    createdAt: Number(raw.createdAt) || now,
    updatedAt: Number(raw.updatedAt) || now,
  };
}

async function readFileDb(): Promise<DbShape> {
  try {
    if (!existsSync(DATA_FILE)) return emptyDb();
    const parsed = JSON.parse(readFileSync(DATA_FILE, 'utf8')) as DbShape;
    const apis = Array.isArray(parsed?.apis)
      ? parsed.apis.map(normalizeApi).filter(Boolean)
      : [];
    return {
      apis: apis as StoredApi[],
      deletedPresetIds: Array.isArray(parsed?.deletedPresetIds)
        ? parsed.deletedPresetIds.map(String)
        : [],
    };
  } catch {
    return emptyDb();
  }
}

async function writeFileDb(db: DbShape): Promise<void> {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(DATA_FILE, JSON.stringify(db, null, 2), 'utf8');
}

async function readBlobDb(): Promise<DbShape | null> {
  try {
    const { getStore } = await import('@netlify/blobs');
    const store = getStore('aurora-apis');
    const raw = await store.get('db', { type: 'text' });
    if (!raw) return emptyDb();
    const parsed = JSON.parse(raw) as DbShape;
    const apis = Array.isArray(parsed?.apis)
      ? parsed.apis.map(normalizeApi).filter(Boolean)
      : [];
    return {
      apis: apis as StoredApi[],
      deletedPresetIds: Array.isArray(parsed?.deletedPresetIds)
        ? parsed.deletedPresetIds.map(String)
        : [],
    };
  } catch {
    return null;
  }
}

async function writeBlobDb(db: DbShape): Promise<boolean> {
  try {
    const { getStore } = await import('@netlify/blobs');
    const store = getStore('aurora-apis');
    await store.set('db', JSON.stringify(db));
    return true;
  } catch {
    return false;
  }
}

async function loadDb(): Promise<DbShape> {
  if (process.env.NETLIFY === 'true' || process.env.NETLIFY_BLOBS) {
    const blob = await readBlobDb();
    if (blob) return blob;
  }
  return readFileDb();
}

async function saveDb(db: DbShape): Promise<void> {
  const usedBlob = await writeBlobDb(db);
  if (!usedBlob) await writeFileDb(db);
}

function seedPresets(db: DbShape): boolean {
  let dirty = false;
  const now = Date.now();
  const deleted = new Set(db.deletedPresetIds || []);
  for (const p of PRESETS) {
    if (deleted.has(p.id)) continue;
    if (db.apis.some((a) => a.id === p.id)) continue;
    db.apis.push({ ...p, createdAt: now, updatedAt: now });
    dirty = true;
  }
  return dirty;
}

export function toPublicApi(api: StoredApi): PublicApiView {
  const effectiveKey = api.apiKey?.trim() || envKeyFor(api.kind);
  return {
    id: api.id,
    kind: api.kind,
    name: api.name,
    provider: api.provider,
    purpose: api.purpose,
    enabled: api.enabled,
    model: api.model,
    baseUrl: api.baseUrl,
    note: api.note,
    isPreset: api.isPreset,
    hasKey: Boolean(effectiveKey),
    keyHint: keyHint(effectiveKey),
    createdAt: api.createdAt,
    updatedAt: api.updatedAt,
  };
}

export async function listApis(): Promise<StoredApi[]> {
  const db = await loadDb();
  if (seedPresets(db)) await saveDb(db);
  return [...db.apis].sort((a, b) => a.createdAt - b.createdAt);
}

export async function listPublicApis(): Promise<PublicApiView[]> {
  const apis = await listApis();
  return apis.map(toPublicApi);
}

export async function findApiById(id: string): Promise<StoredApi | null> {
  const apis = await listApis();
  return apis.find((a) => a.id === id) ?? null;
}

export async function findApiByKind(kind: ApiKind): Promise<StoredApi | null> {
  const apis = await listApis();
  // Prefer enabled entry of this kind; else first match.
  return (
    apis.find((a) => a.kind === kind && a.enabled) ||
    apis.find((a) => a.kind === kind) ||
    null
  );
}

export type ApiRuntime = {
  enabled: boolean;
  model: string;
  baseUrl: string;
  apiKey: string;
  name: string;
};

export async function getApiRuntime(kind: ApiKind): Promise<ApiRuntime> {
  const api = await findApiByKind(kind);
  const envKey = envKeyFor(kind);
  if (!api) {
    return {
      enabled: true,
      model: '',
      baseUrl: '',
      apiKey: envKey,
      name: kind,
    };
  }
  return {
    enabled: api.enabled,
    model: api.model?.trim() || '',
    baseUrl: api.baseUrl?.trim() || '',
    apiKey: api.apiKey?.trim() || envKey,
    name: api.name,
  };
}

export async function assertApiEnabled(kind: ApiKind): Promise<ApiRuntime> {
  const runtime = await getApiRuntime(kind);
  if (!runtime.enabled) {
    throw new Error(`「${runtime.name}」API 已被管理员禁用`);
  }
  return runtime;
}

export async function updateApi(
  id: string,
  patch: Partial<{
    name: string;
    provider: string;
    purpose: string;
    enabled: boolean;
    model: string;
    baseUrl: string;
    note: string;
    apiKey: string | null;
  }>,
): Promise<StoredApi> {
  const db = await loadDb();
  seedPresets(db);
  const idx = db.apis.findIndex((a) => a.id === id);
  if (idx < 0) throw new Error('API 不存在');
  const cur = db.apis[idx];
  const next: StoredApi = {
    ...cur,
    name:
      typeof patch.name === 'string' ? patch.name.trim().slice(0, 64) || cur.name : cur.name,
    provider:
      typeof patch.provider === 'string'
        ? patch.provider.trim().slice(0, 64)
        : cur.provider,
    purpose:
      typeof patch.purpose === 'string'
        ? patch.purpose.trim().slice(0, 64)
        : cur.purpose,
    enabled: typeof patch.enabled === 'boolean' ? patch.enabled : cur.enabled,
    model:
      typeof patch.model === 'string' ? patch.model.trim().slice(0, 120) : cur.model,
    baseUrl:
      typeof patch.baseUrl === 'string'
        ? patch.baseUrl.trim().slice(0, 300)
        : cur.baseUrl,
    note:
      typeof patch.note === 'string' ? patch.note.trim().slice(0, 500) : cur.note,
    updatedAt: Date.now(),
  };
  if (typeof patch.apiKey === 'string') {
    // Empty string clears override (fall back to env).
    next.apiKey = patch.apiKey.trim();
  } else if (patch.apiKey === null) {
    next.apiKey = '';
  }
  db.apis[idx] = next;
  await saveDb(db);
  return next;
}

export async function deleteApi(id: string): Promise<void> {
  const db = await loadDb();
  seedPresets(db);
  const idx = db.apis.findIndex((a) => a.id === id);
  if (idx < 0) throw new Error('API 不存在');
  const target = db.apis[idx];
  db.apis.splice(idx, 1);
  if (target.isPreset && !db.deletedPresetIds.includes(id)) {
    db.deletedPresetIds.push(id);
  }
  await saveDb(db);
}
