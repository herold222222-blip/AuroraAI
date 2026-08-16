import { createHash } from 'crypto';
import { getPool } from './db';
import oss, {
  isOssConfigured,
  resolveObjectUrl,
  publicObjectUrl,
} from './ossStore';

export type ProjectAssetIn = {
  id: string;
  dataUrl?: string;
  reuseKey?: string;
};

export type StoredProject = {
  id: string;
  ownerId: string;
  name: string;
  storagePath: string;
  manifest: Record<string, unknown>;
  version: number;
  createdAt: number;
  updatedAt: number;
};

export type ResolveUrlOptions = {
  /** 签名失败时的同源代理（带 token，可供 <img src> 使用） */
  mediaUrlForKey?: (key: string) => string;
};

let schemaReady = false;

async function ensureProjectsSchema() {
  if (schemaReady) return;
  if (!process.env.DATABASE_URL) {
    throw new Error('未配置 DATABASE_URL，无法保存项目');
  }
  const pool = getPool();
  await pool.query(`
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL,
      name TEXT,
      storage_path TEXT,
      manifest JSONB DEFAULT '{}'::jsonb,
      version BIGINT DEFAULT 0,
      created_at BIGINT DEFAULT (extract(epoch from now()) * 1000),
      updated_at BIGINT DEFAULT (extract(epoch from now()) * 1000)
    )
  `);
  await pool.query(`
    DO $$ BEGIN
      IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'projects'
          AND column_name = 'id' AND data_type = 'uuid'
      ) THEN
        ALTER TABLE projects DROP CONSTRAINT IF EXISTS projects_pkey;
        ALTER TABLE projects DROP CONSTRAINT IF EXISTS projects_owner_id_fkey;
        ALTER TABLE projects ALTER COLUMN id TYPE text USING id::text;
        ALTER TABLE projects ALTER COLUMN owner_id TYPE text USING owner_id::text;
        ALTER TABLE projects ADD PRIMARY KEY (id);
      END IF;
    END $$
  `);
  await pool.query(
    `CREATE INDEX IF NOT EXISTS projects_owner_id_idx ON projects (owner_id)`,
  );
  schemaReady = true;
}

function parseDataUrl(dataUrl: string): { mime: string; buf: Buffer } {
  const m = /^data:([^;]+);base64,(.+)$/s.exec(dataUrl);
  if (!m) throw new Error('无效的图片数据');
  return { mime: m[1], buf: Buffer.from(m[2], 'base64') };
}

function extOf(mime: string): string {
  if (mime.includes('jpeg') || mime.includes('jpg')) return 'jpg';
  if (mime.includes('webp')) return 'webp';
  if (mime.includes('gif')) return 'gif';
  if (mime.includes('gltf-binary') || mime.includes('glb')) return 'glb';
  if (mime.includes('gltf')) return 'gltf';
  return 'png';
}

function walkReplace(value: unknown, fn: (url: string) => string): unknown {
  if (typeof value === 'string') {
    if (
      value.startsWith('asset:') ||
      value.startsWith('oss:') ||
      value.startsWith('data:') ||
      value.startsWith('blob:') ||
      value.startsWith('http://') ||
      value.startsWith('https://')
    ) {
      return fn(value);
    }
    return value;
  }
  if (Array.isArray(value)) return value.map((v) => walkReplace(v, fn));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = walkReplace(v, fn);
    }
    return out;
  }
  return value;
}

async function uploadAssets(
  ownerId: string,
  projectId: string,
  assets: ProjectAssetIn[],
): Promise<Record<string, string>> {
  const keys: Record<string, string> = {};
  const needUpload = assets.filter((a) => a.dataUrl && !a.reuseKey);
  if (needUpload.length && !isOssConfigured()) {
    throw new Error('未配置 OSS，无法保存项目图片。请在环境变量中填写 OSS / ALIYUN_OSS 密钥。');
  }
  for (const a of assets) {
    if (a.reuseKey?.startsWith('projects/')) {
      keys[a.id] = a.reuseKey;
      continue;
    }
    if (!a.dataUrl) continue;
    const { mime, buf } = parseDataUrl(a.dataUrl);
    const hash = createHash('sha256').update(buf).digest('hex').slice(0, 16);
    const key = `projects/${ownerId}/${projectId}/${hash}.${extOf(mime)}`;
    await oss.uploadBuffer(buf, key, mime);
    keys[a.id] = key;
  }
  return keys;
}

function bagWithOssKeys(
  bag: unknown,
  assetKeys: Record<string, string>,
): unknown {
  return walkReplace(bag, (url) => {
    if (url.startsWith('asset:')) {
      const id = url.slice('asset:'.length);
      const key = assetKeys[id];
      return key ? `oss:${key}` : url;
    }
    return url;
  });
}

function extractBag(manifest: Record<string, unknown>): unknown {
  const raw = manifest.bag ?? manifest;
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw) as unknown;
    } catch {
      return {};
    }
  }
  return raw ?? {};
}

async function resolveOssKey(
  key: string,
  opts?: ResolveUrlOptions,
): Promise<string> {
  // 优先走同源代理：不依赖 OSS 公私读 / 签名链 / 混合内容，<img> 可直接显示
  if (opts?.mediaUrlForKey) {
    return opts.mediaUrlForKey(key);
  }
  if (isOssConfigured()) {
    try {
      const url = await resolveObjectUrl(key);
      if (url && !url.startsWith('oss:')) {
        return url.replace(/^http:\/\//i, 'https://');
      }
    } catch (err) {
      console.error('[projects] resolveObjectUrl', key, err);
    }
  } else {
    console.warn('[projects] OSS 未配置，无法签名资源', key);
  }
  try {
    return publicObjectUrl(key);
  } catch {
    return `oss:${key}`;
  }
}

async function bagWithResolvedUrls(
  bag: unknown,
  opts?: ResolveUrlOptions,
): Promise<unknown> {
  const cache = new Map<string, string>();
  const forceHttps = (url: string) =>
    url.replace(/^http:\/\//i, 'https://');
  const walk = async (value: unknown): Promise<unknown> => {
    if (typeof value === 'string' && value.startsWith('oss:')) {
      const key = value.slice(4);
      if (!cache.has(key)) {
        cache.set(key, forceHttps(await resolveOssKey(key, opts)));
      }
      return cache.get(key);
    }
    // 库里若已存了 http 签名链，同样升 https
    if (
      typeof value === 'string' &&
      value.startsWith('http://') &&
      /(\.aliyuncs\.com|\.aliyun\.com)\//i.test(value)
    ) {
      return forceHttps(value);
    }
    if (Array.isArray(value)) return Promise.all(value.map(walk));
    if (value && typeof value === 'object') {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        out[k] = await walk(v);
      }
      return out;
    }
    return value;
  };
  return walk(bag);
}

function rowToProject(row: {
  id: string;
  owner_id: string;
  name: string;
  storage_path: string;
  manifest: Record<string, unknown> | string | null;
  version: string | number;
  created_at: string | number;
  updated_at: string | number;
}): StoredProject {
  const manifest =
    typeof row.manifest === 'string'
      ? (JSON.parse(row.manifest) as Record<string, unknown>)
      : row.manifest || {};
  return {
    id: String(row.id),
    ownerId: String(row.owner_id),
    name: row.name || '',
    storagePath: row.storage_path || '',
    manifest,
    version: Number(row.version) || 0,
    createdAt: Number(row.created_at) || 0,
    updatedAt: Number(row.updated_at) || 0,
  };
}

export async function saveProjectArchive(
  ownerId: string,
  projectId: string,
  archiveBuffer: Buffer,
  manifest: Record<string, unknown> | null,
) {
  await ensureProjectsSchema();
  const key = `projects/${ownerId}/${projectId}/snapshot.zip`;
  if (isOssConfigured()) {
    await oss.uploadBuffer(archiveBuffer, key, 'application/zip');
  }
  const pool = getPool();
  const now = Date.now();
  await pool.query(
    `INSERT INTO projects (id, owner_id, name, storage_path, manifest, version, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     ON CONFLICT (id) DO UPDATE SET
       storage_path=EXCLUDED.storage_path,
       manifest=EXCLUDED.manifest,
       name=EXCLUDED.name,
       version=projects.version+1,
       updated_at=EXCLUDED.updated_at
     WHERE projects.owner_id = EXCLUDED.owner_id`,
    [
      projectId,
      ownerId,
      manifest?.name || null,
      key,
      JSON.stringify(manifest || {}),
      1,
      now,
      now,
    ],
  );
  return { key };
}

export async function saveFormalProject(input: {
  ownerId: string;
  projectId: string;
  name: string;
  bag: unknown;
  assets: ProjectAssetIn[];
}): Promise<{ key: string; version: number }> {
  await ensureProjectsSchema();
  const { ownerId, projectId, name } = input;
  if (!projectId) {
    throw new Error('projectId 必需');
  }
  const existing = await getProjectRow(projectId);
  if (existing && existing.ownerId !== ownerId) {
    throw new Error('无权覆盖该项目');
  }
  const assetKeys = await uploadAssets(ownerId, projectId, input.assets || []);
  const storedBag = bagWithOssKeys(input.bag, assetKeys);
  const prefix = `projects/${ownerId}/${projectId}/`;
  const manifest = {
    name,
    bag: storedBag,
    assets: assetKeys,
  };
  const pool = getPool();
  const now = Date.now();
  const res = await pool.query(
    `INSERT INTO projects (id, owner_id, name, storage_path, manifest, version, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5::jsonb,1,$6,$6)
     ON CONFLICT (id) DO UPDATE SET
       name=EXCLUDED.name,
       storage_path=EXCLUDED.storage_path,
       manifest=EXCLUDED.manifest,
       version=projects.version+1,
       updated_at=EXCLUDED.updated_at
     WHERE projects.owner_id = EXCLUDED.owner_id
     RETURNING version`,
    [projectId, ownerId, name, prefix, JSON.stringify(manifest), now],
  );
  return { key: prefix, version: Number(res.rows[0]?.version) || 1 };
}

async function getProjectRow(projectId: string): Promise<StoredProject | null> {
  await ensureProjectsSchema();
  const pool = getPool();
  const res = await pool.query(
    'SELECT id, owner_id, name, storage_path, manifest, version, created_at, updated_at FROM projects WHERE id=$1',
    [projectId],
  );
  if (!res.rows?.length) return null;
  return rowToProject(res.rows[0]);
}

export async function getProjectManifest(projectId: string) {
  const row = await getProjectRow(projectId);
  if (!row) return null;
  return {
    manifest: row.manifest,
    storage_path: row.storagePath,
    version: row.version,
    owner_id: row.ownerId,
    name: row.name,
    updated_at: row.updatedAt,
  };
}

export async function getResolvedProject(
  projectId: string,
  ownerId: string,
  opts?: ResolveUrlOptions,
) {
  const row = await getProjectRow(projectId);
  if (!row) return null;
  if (row.ownerId !== ownerId) return 'forbidden' as const;
  const bag = await bagWithResolvedUrls(extractBag(row.manifest), opts);
  return {
    id: row.id,
    name: row.name,
    updatedAt: row.updatedAt,
    version: row.version,
    storagePath: row.storagePath,
    bag,
  };
}

export async function listProjectsByOwner(ownerId: string) {
  await ensureProjectsSchema();
  const pool = getPool();
  const res = await pool.query(
    `SELECT id, owner_id, name, storage_path, manifest, version, created_at, updated_at
     FROM projects WHERE owner_id=$1 ORDER BY updated_at DESC`,
    [ownerId],
  );
  return (res.rows || []).map(rowToProject);
}

export async function listResolvedProjects(
  ownerId: string,
  opts?: ResolveUrlOptions,
) {
  const rows = await listProjectsByOwner(ownerId);
  const out = [];
  for (const row of rows) {
    const bag = await bagWithResolvedUrls(extractBag(row.manifest), opts);
    out.push({
      id: row.id,
      name: row.name,
      updatedAt: row.updatedAt,
      version: row.version,
      storagePath: row.storagePath,
      bag,
    });
  }
  return out;
}

export async function deleteProject(ownerId: string, projectId: string) {
  await ensureProjectsSchema();
  const row = await getProjectRow(projectId);
  if (!row) return false;
  if (row.ownerId !== ownerId) throw new Error('无权删除该项目');
  const pool = getPool();
  await pool.query('DELETE FROM projects WHERE id=$1 AND owner_id=$2', [
    projectId,
    ownerId,
  ]);
  const prefix = row.storagePath || `projects/${ownerId}/${projectId}/`;
  try {
    await oss.deletePrefix(prefix);
  } catch (err) {
    console.error('[projects] oss delete', err);
  }
  return true;
}

export default {
  saveProjectArchive,
  saveFormalProject,
  getProjectManifest,
  getResolvedProject,
  listProjectsByOwner,
  listResolvedProjects,
  deleteProject,
};
