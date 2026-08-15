import type { Request, Response } from 'express';
import {
  saveFormalProject,
  saveProjectArchive,
  getResolvedProject,
  listResolvedProjects,
  deleteProject,
  type ProjectAssetIn,
  type ResolveUrlOptions,
} from './projectStore';
import { verifyToken } from './authTokens';
import { getObjectBuffer, isOssConfigured } from './ossStore';

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
  // 本机 curl 127.0.0.1 时不要生成 127.0.0.1 的媒体地址给浏览器用
  if (/^(127\.0\.0\.1|localhost)(:\d+)?$/i.test(host)) {
    return 'https://www.gnoverse.cn';
  }
  const safeProto = proto === 'http' && !/^(127\.|localhost)/i.test(host) ? 'https' : proto;
  return `${safeProto}://${host}`;
}

function resolveOpts(req: Request): ResolveUrlOptions {
  const token = rawTokenOf(req);
  const origin = publicOriginOf(req);
  if (!token || !origin) return {};
  return {
    mediaUrlForKey: (key: string) =>
      `${origin}/api/projects/media?key=${encodeURIComponent(key)}&t=${encodeURIComponent(token)}`,
  };
}

export async function handleSaveProject(req: Request, res: Response) {
  try {
    const auth = authOf(req);
    if (!auth) return res.status(401).json({ error: '未认证' });
    const body = req.body || {};
    const projectId = String(body.projectId || '').trim();
    const name = String(body.name || '').trim();
    if (!projectId) return res.status(400).json({ error: 'projectId 必需' });

    if (body.bag) {
      const assets = Array.isArray(body.assets)
        ? (body.assets as ProjectAssetIn[])
        : [];
      const r = await saveFormalProject({
        ownerId: auth.sub,
        projectId,
        name: name || '未命名项目',
        bag: body.bag,
        assets,
      });
      return res.json({ ok: true, key: r.key, version: r.version });
    }

    const manifest = body.manifest || {};
    const archiveBase64 = body.archiveBase64 || null;
    if (!archiveBase64) return res.status(400).json({ error: 'bag 或 archiveBase64 必需' });
    const buf = Buffer.from(String(archiveBase64), 'base64');
    const r = await saveProjectArchive(auth.sub, projectId, buf, {
      ...manifest,
      name: name || manifest.name,
    });
    res.json({ ok: true, key: r.key });
  } catch (e) {
    console.error('[projects] save', e);
    res.status(500).json({ error: e instanceof Error ? e.message : '保存失败' });
  }
}

export async function handleGetProject(req: Request, res: Response) {
  try {
    const auth = authOf(req);
    if (!auth) return res.status(401).json({ error: '未认证' });
    const pid = String(req.params.id || '').trim();
    if (!pid) return res.status(400).json({ error: 'id 必需' });
    const m = await getResolvedProject(pid, auth.sub, resolveOpts(req));
    if (m === 'forbidden') return res.status(403).json({ error: '无权查看该项目' });
    if (!m) return res.status(404).json({ error: '项目未找到' });
    res.json({ ok: true, project: m });
  } catch (e) {
    console.error('[projects] get', e);
    res.status(500).json({ error: e instanceof Error ? e.message : '读取失败' });
  }
}

export async function handleListMyProjects(req: Request, res: Response) {
  try {
    const auth = authOf(req);
    if (!auth) return res.status(401).json({ error: '未认证' });
    const projects = await listResolvedProjects(auth.sub, resolveOpts(req));
    res.json({ ok: true, projects });
  } catch (e) {
    console.error('[projects] list', e);
    res.status(500).json({ error: e instanceof Error ? e.message : '读取失败' });
  }
}

export async function handleDeleteProject(req: Request, res: Response) {
  try {
    const auth = authOf(req);
    if (!auth) return res.status(401).json({ error: '未认证' });
    const pid = String(req.params.id || '').trim();
    if (!pid) return res.status(400).json({ error: 'id 必需' });
    const ok = await deleteProject(auth.sub, pid);
    if (!ok) return res.status(404).json({ error: '项目未找到' });
    res.json({ ok: true });
  } catch (e) {
    console.error('[projects] delete', e);
    const message = e instanceof Error ? e.message : '删除失败';
    const status = message.startsWith('无权') ? 403 : 500;
    res.status(status).json({ error: message });
  }
}

/** <img src> 可用的鉴权读图（query t=JWT）；仅允许读取本人 projects/{userId}/ 前缀 */
export async function handleProjectMedia(req: Request, res: Response) {
  try {
    const auth = authOf(req);
    if (!auth) return res.status(401).json({ error: '未认证' });
    const key = String(req.query.key || '').trim().replace(/^\/+/, '');
    if (!key || key.includes('..')) {
      return res.status(400).json({ error: 'key 无效' });
    }
    const allowed = `projects/${auth.sub}/`;
    if (!key.startsWith(allowed)) {
      return res.status(403).json({ error: '无权访问该资源' });
    }
    if (!isOssConfigured()) {
      return res.status(503).json({ error: 'OSS 未配置' });
    }
    const { buffer, contentType } = await getObjectBuffer(key);
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'private, max-age=300');
    res.send(buffer);
  } catch (e) {
    console.error('[projects] media', e);
    res.status(500).json({ error: e instanceof Error ? e.message : '读取失败' });
  }
}
