import type { Request, Response } from 'express';
import { verifyToken } from './authTokens';
import { listAssetsForOwner } from './projectStore';

const DEFAULT_LIMITS = { image: 20, model: 2 };

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

function resolveOpts(req: Request) {
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
      `${origin}/api/projects/media?key=${encodeURIComponent(key)}&t=${encodeURIComponent(token)}`,
  };
}

/** 资产列表：仅来自 Postgres projects（当前登录用户） */
export async function handleListAssets(req: Request, res: Response) {
  try {
    const auth = authOf(req);
    if (!auth) return res.status(401).json({ error: '未认证' });
    const items = await listAssetsForOwner(auth.sub, resolveOpts(req));
    res.json({
      ok: true,
      source: 'database',
      entries: items,
      limits: DEFAULT_LIMITS,
      counts: {
        image: items.filter((x) => x.kind === 'image').length,
        model: items.filter((x) => x.kind === 'model').length,
      },
    });
  } catch (e) {
    console.error('[assets] list', e);
    res.status(500).json({ error: e instanceof Error ? e.message : 'failed' });
  }
}

/** 轻量计数：同源数据库聚合 */
export async function handleAssetCounts(req: Request, res: Response) {
  try {
    const auth = authOf(req);
    if (!auth) return res.status(401).json({ error: '未认证' });
    const items = await listAssetsForOwner(auth.sub, resolveOpts(req));
    const image = items.filter((x) => x.kind === 'image').length;
    const model = items.filter((x) => x.kind === 'model').length;
    res.json({
      ok: true,
      source: 'database',
      counts: { image, model },
      limits: DEFAULT_LIMITS,
    });
  } catch (e) {
    console.error('[assets] counts', e);
    res.status(500).json({ error: e instanceof Error ? e.message : 'failed' });
  }
}
