import type { Request, Response } from 'express';
import { createHash } from 'crypto';
import { verifyToken } from './authTokens';
import { getPool } from './db';
import oss, { isOssConfigured } from './ossStore';
import { type ResolveUrlOptions } from './projectStore';

const DEFAULT_LIMITS = { image: 20, model: 2 };
const UNASSIGNED_PROJECT_ID = '__unassigned';

export type AssetKind = 'image' | 'model';

export type AssetRole = 'original' | 'result' | 'model' | string;

export type DirectAsset = {
  id: string;
  kind: AssetKind;
  url: string;
  label: string;
  createdAt: number;
  projectId: string;
  projectName: string;
  prompt?: string;
  role?: AssetRole;
};

let assetsSchemaReady = false;

function authOf(req: Request) {
  const header = (req.headers.authorization || '') as string;
  const q = typeof req.query.t === 'string' ? req.query.t : '';
  return verifyToken(header || q || null);
}

function rawTokenOf(req: Request): string {
  const header = String(req.headers.authorization || '');
  if (header.startsWith('Bearer ')) return header.slice(7).trim();
  if (typeof req.query.t === 'string') return req.query.t.trim();
  return '';
}

function publicOriginOf(req: Request): string {
  const fromEnv = (
    process.env.PUBLIC_WEB_ORIGIN ||
    process.env.AUTH_API_ORIGIN ||
    process.env.VITE_API_ORIGIN ||
    ''
  ).replace(/\/$/, '');
  if (fromEnv) return fromEnv;
  const proto = String(
    req.headers['x-forwarded-proto'] || req.protocol || 'https',
  )
    .split(',')[0]
    .trim();
  const host = String(
    req.headers['x-forwarded-host'] || req.headers.host || '',
  )
    .split(',')[0]
    .trim();
  if (!host) return '';
  if (/^(127\.0\.0\.1|localhost)(:\d+)?$/i.test(host)) {
    return 'https://www.gnoverse.cn';
  }
  const safeProto =
    proto === 'http' && !/^(127\.|localhost)/i.test(host) ? 'https' : proto;
  return `${safeProto}://${host}`;
}

function resolveOpts(req: Request): ResolveUrlOptions & { projectId?: string } {
  const token = rawTokenOf(req);
  const origin = publicOriginOf(req);
  const projectId =
    typeof req.query.projectId === 'string' ? req.query.projectId.trim() : '';
  const base = {
    ...(projectId ? { projectId } : {}),
  };
  if (!token || !origin) return base;
  return {
    ...base,
    mediaUrlForKey: (key: string) =>
      `${origin}/api/assets/media?key=${encodeURIComponent(key)}&t=${encodeURIComponent(token)}`,
  };
}

async function ensureAssetsSchema() {
  if (assetsSchemaReady) return;
  if (!process.env.DATABASE_URL) {
    throw new Error('未配置 DATABASE_URL，无法保存资产');
  }
  const pool = getPool();
  await pool.query(`
    CREATE TABLE IF NOT EXISTS assets (
      id TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      label TEXT,
      url TEXT NOT NULL,
      oss_key TEXT,
      project_id TEXT,
      project_name TEXT,
      prompt TEXT,
      created_at BIGINT DEFAULT (extract(epoch from now()) * 1000),
      updated_at BIGINT DEFAULT (extract(epoch from now()) * 1000)
    )
  `);
  await pool.query(`
    ALTER TABLE assets
    ADD COLUMN IF NOT EXISTS oss_key TEXT
  `);
  await pool.query(`
    ALTER TABLE assets
    ADD COLUMN IF NOT EXISTS role TEXT
  `);
  await pool.query(
    `CREATE INDEX IF NOT EXISTS assets_owner_id_idx ON assets (owner_id)`,
  );
  await pool.query(
    `CREATE INDEX IF NOT EXISTS assets_project_id_idx ON assets (project_id)`,
  );
  await pool.query(
    `CREATE INDEX IF NOT EXISTS assets_owner_role_idx ON assets (owner_id, role)`,
  );
  assetsSchemaReady = true;
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

async function resolveAssetUrl(
  url: string,
  opts?: ResolveUrlOptions,
  explicitKey?: string | null,
): Promise<string> {
  const fromExplicit = String(explicitKey || '').trim().replace(/^\/+/, '');
  const fromUrl = url.startsWith('oss:')
    ? url.slice(4).trim().replace(/^\/+/, '')
    : '';
  const key = fromExplicit || fromUrl;
  if (key) {
    if (/^asset_/i.test(key)) return '';
    if (opts?.mediaUrlForKey) return opts.mediaUrlForKey(key);
    try {
      return (await oss.resolveObjectUrl(key)).replace(/^http:\/\//i, 'https://');
    } catch {
      return '';
    }
  }
  if (!url || url.startsWith('asset:') || /^asset_/i.test(url)) return '';
  return url.replace(/^http:\/\//i, 'https://');
}

async function directAssetsForOwner(
  ownerId: string,
  opts?: ResolveUrlOptions & { projectId?: string; role?: string },
): Promise<DirectAsset[]> {
  await ensureAssetsSchema();
  const pool = getPool();
  const params: string[] = [ownerId];
  let where = 'owner_id=$1';
  if (opts?.projectId === UNASSIGNED_PROJECT_ID) {
    where += ` AND COALESCE(project_id, '') = ''`;
  } else if (opts?.projectId) {
    params.push(opts.projectId);
    where += ` AND project_id=$${params.length}`;
  }
  if (opts?.role) {
    params.push(opts.role);
    where += ` AND role=$${params.length}`;
  }
  const res = await pool.query(
    `SELECT id, kind, label, url, oss_key, project_id, project_name, prompt, role, created_at
     FROM assets
     WHERE ${where}
     ORDER BY created_at DESC`,
    params,
  );
  return (await Promise.all(
    (res.rows || []).map(async (row): Promise<DirectAsset> => ({
      id: String(row.id),
      kind: row.kind === 'model' ? 'model' : 'image',
      url: await resolveAssetUrl(
        String(row.url || ''),
        opts,
        row.oss_key ? String(row.oss_key) : null,
      ),
      label: String(row.label || ''),
      createdAt: Number(row.created_at) || Date.now(),
      projectId: String(row.project_id || ''),
      projectName: String(row.project_name || ''),
      prompt: row.prompt ? String(row.prompt) : undefined,
      role: row.role ? String(row.role) : undefined,
    })),
  )).filter((item) => Boolean(item.url));
}

async function listAllAssetsForOwner(
  ownerId: string,
  opts?: ResolveUrlOptions & { projectId?: string; role?: string },
) {
  const direct = await directAssetsForOwner(ownerId, opts);
  direct.sort((a, b) => b.createdAt - a.createdAt);
  return direct.filter((item) => item.url && !/key=asset_/i.test(item.url));
}

export async function handleSaveAsset(req: Request, res: Response) {
  try {
    console.info('[assets] handleSaveAsset hit');
    const auth = authOf(req);
    if (!auth) return res.status(401).json({ error: '未认证' });
    await ensureAssetsSchema();
    const body = req.body || {};
    const id = String(body.id || '').trim() || `asset_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    const kind: AssetKind = body.kind === 'model' ? 'model' : 'image';
    const label = String(body.label || (kind === 'image' ? '图片' : '模型')).trim();
    const projectId = String(body.projectId || '').trim();
    const projectName = projectId ? String(body.projectName || '').trim() : '';
    const prompt = body.prompt ? String(body.prompt) : null;
    const roleRaw = String(body.role || '').trim().toLowerCase();
    const role =
      kind === 'model'
        ? 'model'
        : roleRaw === 'original'
          ? 'original'
          : roleRaw === 'result'
            ? 'result'
            : kind === 'image'
              ? 'result'
              : null;
    const now = Number(body.createdAt) || Date.now();
    const existing = await getPool().query(
      'SELECT id FROM assets WHERE id=$1 AND owner_id=$2',
      [id, auth.sub],
    );
    if (auth.role !== 'admin' && kind === 'image' && !existing.rows?.length) {
      const current = await listAllAssetsForOwner(auth.sub, resolveOpts(req));
      if (current.filter((x) => x.kind === 'image').length >= DEFAULT_LIMITS.image) {
        return res.status(429).json({
          error:
            '图片数量已达上限（20 张），无法继续上传或 AI 改图。请到「资产」删除部分图片后重试。',
        });
      }
    }

    let url = String(body.url || '').trim();
    let ossKey: string | null = null;
    if (body.reuseKey) {
      ossKey = String(body.reuseKey).trim().replace(/^\/+/, '');
      if (!/^assets\//i.test(ossKey) && !/^projects\//i.test(ossKey)) {
        return res.status(400).json({ error: 'reuseKey 无效' });
      }
      url = `oss:${ossKey}`;
    } else if (body.dataUrl) {
      if (!isOssConfigured()) {
        return res.status(503).json({ error: 'OSS 未配置，无法保存资产图片' });
      }
      const { mime, buf } = parseDataUrl(String(body.dataUrl));
      // 业务上限 10MB（客户端会先压缩；此处兜底拒绝过大上传）
      if (buf.length > 10 * 1024 * 1024) {
        return res.status(413).json({
          error: '图片超过 10MB，请压缩后再上传',
        });
      }
      const hash = createHash('sha256').update(buf).digest('hex').slice(0, 16);
      const scope = projectId || 'unassigned';
      const folder = role === 'original' ? 'originals' : 'results';
      ossKey = `assets/${auth.sub}/${scope}/${folder}/${hash}.${extOf(mime)}`;
      await oss.uploadBuffer(buf, ossKey, mime);
      url = `oss:${ossKey}`;
    }
    if (!url || url.startsWith('asset:') || /^asset_/i.test(url)) {
      return res.status(400).json({ error: 'url 或 dataUrl 必需' });
    }

    const pool = getPool();
    await pool.query(
      `INSERT INTO assets
       (id, owner_id, kind, label, url, oss_key, project_id, project_name, prompt, role, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$11)
       ON CONFLICT (id) DO UPDATE SET
         label=EXCLUDED.label,
         url=EXCLUDED.url,
         oss_key=EXCLUDED.oss_key,
         project_id=EXCLUDED.project_id,
         project_name=EXCLUDED.project_name,
         prompt=EXCLUDED.prompt,
         role=COALESCE(EXCLUDED.role, assets.role),
         updated_at=EXCLUDED.updated_at
       WHERE assets.owner_id = EXCLUDED.owner_id`,
      [
        id,
        auth.sub,
        kind,
        label,
        url,
        ossKey,
        projectId || null,
        projectName || null,
        prompt,
        role,
        now,
      ],
    );
    console.info('[assets] save payload', {
      ownerId: auth.sub,
      id,
      bodyId: body.id,
      bodyUrl: body.url,
      reuseKey: body.reuseKey,
      hasDataUrl: Boolean(body.dataUrl),
      finalUrl: url,
      ossKey,
    });
    const saved = await pool.query(
      `SELECT id, kind, label, url, oss_key, project_id, project_name, prompt, role, created_at
       FROM assets
       WHERE id=$1 AND owner_id=$2
       LIMIT 1`,
      [id, auth.sub],
    );
    const row = saved.rows?.[0];
    const resolvedUrl = await resolveAssetUrl(
      row ? String(row.url || '') : url,
      resolveOpts(req),
      row?.oss_key ? String(row.oss_key) : ossKey,
    );
    res.json({
      ok: true,
      asset: {
        id,
        kind: row?.kind === 'model' ? 'model' : kind,
        url: resolvedUrl,
        label: row?.label ? String(row.label) : label,
        createdAt: row ? Number(row.created_at) || now : now,
        projectId: row?.project_id ? String(row.project_id) : projectId,
        projectName: row?.project_name ? String(row.project_name) : projectName,
        prompt: row?.prompt ? String(row.prompt) : prompt || undefined,
        role: row?.role ? String(row.role) : role || undefined,
      },
    });
  } catch (e) {
    const err = e as {
      message?: string;
      code?: string;
      name?: string;
      status?: number;
      statusCode?: number;
      requestId?: string;
      res?: { status?: number; headers?: unknown };
    };
    console.error('[assets] save', {
      message: err?.message || String(e),
      code: err?.code,
      name: err?.name,
      status: err?.status || err?.statusCode || err?.res?.status,
      requestId: err?.requestId,
      raw: e,
    });
    res.status(500).json({ error: e instanceof Error ? e.message : '保存资产失败' });
  }
}

/** 资产列表：来自独立 assets 表 + 兼容旧 projects 聚合（当前登录用户） */
export async function handleListAssets(req: Request, res: Response) {
  try {
    console.info('[assets] handleListAssets hit');
    const auth = authOf(req);
    if (!auth) return res.status(401).json({ error: '未认证' });
    const role =
      typeof req.query.role === 'string' ? req.query.role.trim() : '';
    const items = await listAllAssetsForOwner(auth.sub, {
      ...resolveOpts(req),
      ...(role ? { role } : {}),
    });
    // 计数始终按全部资产，避免 role 过滤导致配额展示不准
    const allForCounts = role
      ? await listAllAssetsForOwner(auth.sub, resolveOpts(req))
      : items;
    res.json({
      ok: true,
      source: 'database',
      entries: items,
      limits: DEFAULT_LIMITS,
      counts: {
        image: allForCounts.filter((x) => x.kind === 'image').length,
        model: allForCounts.filter((x) => x.kind === 'model').length,
      },
    });
  } catch (e) {
    const err = e as {
      message?: string;
      code?: string;
      name?: string;
      status?: number;
      statusCode?: number;
      requestId?: string;
      res?: { status?: number; headers?: unknown };
    };
    console.error('[assets] list', {
      message: err?.message || String(e),
      code: err?.code,
      name: err?.name,
      status: err?.status || err?.statusCode || err?.res?.status,
      requestId: err?.requestId,
      raw: e,
    });
    res.status(500).json({ error: e instanceof Error ? e.message : 'failed' });
  }
}

/** 轻量计数：同源数据库聚合 */
export async function handleAssetMedia(req: Request, res: Response) {
  try {
    const auth = authOf(req);
    if (!auth) return res.status(401).json({ error: '未认证' });
    const key = String(req.query.key || '').trim().replace(/^\/+/, '');
    if (!key || key.includes('..')) {
      return res.status(400).json({ error: 'key 无效' });
    }
    const allowAssets = `assets/${auth.sub}/`;
    const allowProjects = `projects/${auth.sub}/`;
    if (!key.startsWith(allowAssets) && !key.startsWith(allowProjects)) {
      return res.status(403).json({ error: '无权访问该资源' });
    }
    if (!isOssConfigured()) {
      return res.status(503).json({ error: 'OSS 未配置' });
    }
    const wRaw = Number(req.query.w);
    const w =
      Number.isFinite(wRaw) && wRaw > 0
        ? Math.min(2048, Math.max(64, Math.floor(wRaw)))
        : 0;
    // 列表缩略图：走 OSS 图片处理，显著减小传输体积
    const process = w
      ? `image/resize,w_${w}/quality,q_72`
      : undefined;
    const etag = `"${createHash('sha1').update(`${key}|${process || ''}`).digest('hex')}"`;
    if (req.headers['if-none-match'] === etag) {
      res.status(304).end();
      return;
    }
    let buffer: Buffer;
    let contentType: string;
    try {
      ({ buffer, contentType } = await oss.getObjectBuffer(key, { process }));
    } catch (err) {
      if (process) {
        console.warn('[assets] media process failed, fallback full', key, err);
        ({ buffer, contentType } = await oss.getObjectBuffer(key));
      } else {
        throw err;
      }
    }
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Length', String(buffer.length));
    res.setHeader('ETag', etag);
    // 同用户媒体可长缓存；URL 含 token 时仅当前会话复用，仍能显著加速列表回访
    res.setHeader('Cache-Control', 'private, max-age=604800, immutable');
    res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*');
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    res.end(buffer);
  } catch (e) {
    const err = e as {
      message?: string;
      code?: string;
      name?: string;
      status?: number;
      statusCode?: number;
      requestId?: string;
      res?: { status?: number; headers?: unknown };
    };
    console.error('[assets] media', {
      message: err?.message || String(e),
      code: err?.code,
      name: err?.name,
      status: err?.status || err?.statusCode || err?.res?.status,
      requestId: err?.requestId,
      raw: e,
    });
    res.status(500).json({ error: e instanceof Error ? e.message : '读取失败' });
  }
}

export async function handleAssetDebug(req: Request, res: Response) {
  try {
    const auth = authOf(req);
    if (!auth) return res.status(401).json({ error: '未认证' });
    await ensureAssetsSchema();
    const id = String(req.query.id || '').trim();
    const key = String(req.query.key || '').trim().replace(/^\/+/, '');
    const pool = getPool();
    if (id) {
      const result = await pool.query(
        `SELECT id, owner_id, kind, label, url, oss_key, project_id, project_name, prompt, created_at, updated_at
         FROM assets WHERE id=$1 AND owner_id=$2 LIMIT 1`,
        [id, auth.sub],
      );
      const row = result.rows?.[0];
      if (!row) return res.status(404).json({ error: '资产未找到' });
      const resolvedUrl = await resolveAssetUrl(
        String(row.url || ''),
        resolveOpts(req),
        row.oss_key ? String(row.oss_key) : null,
      );
      return res.json({
        ok: true,
        asset: row,
        resolvedUrl,
      });
    }
    if (!key) return res.status(400).json({ error: 'id 或 key 必需' });
    const allowAssets = `assets/${auth.sub}/`;
    const allowProjects = `projects/${auth.sub}/`;
    if (!key.startsWith(allowAssets) && !key.startsWith(allowProjects)) {
      return res.status(403).json({ error: '无权访问该资源' });
    }
    if (!isOssConfigured()) {
      return res.json({ ok: true, key, exists: false, reason: 'OSS 未配置' });
    }
    const { buffer, contentType } = await oss.getObjectBuffer(key);
    return res.json({
      ok: true,
      key,
      exists: true,
      contentType,
      contentLength: buffer.length,
    });
  } catch (e) {
    const err = e as {
      message?: string;
      code?: string;
      name?: string;
      status?: number;
      statusCode?: number;
      requestId?: string;
      res?: { status?: number; headers?: unknown };
    };
    console.error('[assets] debug', {
      message: err?.message || String(e),
      code: err?.code,
      name: err?.name,
      status: err?.status || err?.statusCode || err?.res?.status,
      requestId: err?.requestId,
      raw: e,
    });
    res.status(500).json({ error: e instanceof Error ? e.message : '调试失败' });
  }
}

export async function handleCleanupBadAssets(req: Request, res: Response) {
  try {
    const auth = authOf(req);
    if (!auth) return res.status(401).json({ error: '未认证' });
    await ensureAssetsSchema();
    const pool = getPool();
    const result = await pool.query(
      `DELETE FROM assets
       WHERE owner_id=$1
         AND (
           url ~* '(^asset_|^asset:|key=asset_)'
           OR oss_key ~* '^asset_'
         )
       RETURNING id, oss_key`,
      [auth.sub],
    );
    const rows = result.rows || [];
    await Promise.all(
      rows
        .map((r) => String(r.oss_key || '').trim())
        .filter((key) => key && !/^asset_/i.test(key))
        .map(async (key) => {
          try {
            await oss.deletePrefix(key);
          } catch (e) {
            console.warn('[assets] cleanup delete oss failed', key, e);
          }
        }),
    );
    return res.json({
      ok: true,
      deletedIds: rows.map((r) => String(r.id || '')),
      count: rows.length,
    });
  } catch (e) {
    const err = e as {
      message?: string;
      code?: string;
      name?: string;
      status?: number;
      statusCode?: number;
      requestId?: string;
      res?: { status?: number; headers?: unknown };
    };
    console.error('[assets] cleanup', {
      message: err?.message || String(e),
      code: err?.code,
      name: err?.name,
      status: err?.status || err?.statusCode || err?.res?.status,
      requestId: err?.requestId,
      raw: e,
    });
    res.status(500).json({ error: e instanceof Error ? e.message : '清理失败' });
  }
}

export async function handleDeleteAssets(req: Request, res: Response) {
  try {
    const auth = authOf(req);
    if (!auth) return res.status(401).json({ error: '未认证' });
    await ensureAssetsSchema();
    const ids = Array.isArray(req.body?.ids)
      ? (req.body.ids as unknown[])
          .map((x) => String(x || '').trim())
          .filter(Boolean)
      : [];
    if (!ids.length) return res.status(400).json({ error: 'ids 必需' });
    const pool = getPool();
    const resDb = await pool.query(
      'DELETE FROM assets WHERE owner_id=$1 AND id = ANY($2::text[]) RETURNING id, oss_key',
      [auth.sub, ids],
    );
    const rows = resDb.rows || [];
    await Promise.all(
      rows
        .map((r) => String(r.oss_key || '').trim())
        .filter(Boolean)
        .map(async (key) => {
          try {
            await oss.deleteObject(key);
          } catch (e) {
            console.warn('[assets] delete oss failed', key, e);
          }
        }),
    );
    return res.json({
      ok: true,
      deletedIds: rows.map((r) => String(r.id)),
    });
  } catch (e) {
    const err = e as {
      message?: string;
      code?: string;
      name?: string;
      status?: number;
      statusCode?: number;
      requestId?: string;
      res?: { status?: number; headers?: unknown };
    };
    console.error('[assets] delete', {
      message: err?.message || String(e),
      code: err?.code,
      name: err?.name,
      status: err?.status || err?.statusCode || err?.res?.status,
      requestId: err?.requestId,
      raw: e,
    });
    res.status(500).json({ error: e instanceof Error ? e.message : '删除失败' });
  }
}

export async function handleAssetCounts(req: Request, res: Response) {
  try {
    const auth = authOf(req);
    if (!auth) return res.status(401).json({ error: '未认证' });
    const items = await listAllAssetsForOwner(auth.sub, resolveOpts(req));
    const image = items.filter((x) => x.kind === 'image').length;
    const model = items.filter((x) => x.kind === 'model').length;
    res.json({
      ok: true,
      source: 'database',
      counts: { image, model },
      limits: DEFAULT_LIMITS,
    });
  } catch (e) {
    const err = e as {
      message?: string;
      code?: string;
      name?: string;
      status?: number;
      statusCode?: number;
      requestId?: string;
      res?: { status?: number; headers?: unknown };
    };
    console.error('[assets] counts', {
      message: err?.message || String(e),
      code: err?.code,
      name: err?.name,
      status: err?.status || err?.statusCode || err?.res?.status,
      requestId: err?.requestId,
      raw: e,
    });
    res.status(500).json({ error: e instanceof Error ? e.message : 'failed' });
  }
}
