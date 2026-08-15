import type { Request, Response } from 'express';
import {
  saveFormalProject,
  saveProjectArchive,
  getResolvedProject,
  listResolvedProjects,
  deleteProject,
  type ProjectAssetIn,
} from './projectStore';
import { verifyToken } from './authTokens';

function authOf(req: Request) {
  return verifyToken((req.headers.authorization || '') as string);
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
    const m = await getResolvedProject(pid, auth.sub);
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
    const projects = await listResolvedProjects(auth.sub);
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
