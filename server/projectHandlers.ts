import type { Request, Response } from 'express';
import { saveProjectArchive, getProjectManifest, listProjectsByOwner } from './projectStore';
import { verifyToken } from './authTokens';

export async function handleSaveProject(req: Request, res: Response) {
  try {
    const auth = verifyToken((req.headers.authorization || '') as string);
    if (!auth) return res.status(401).json({ error: '未认证' });
    const body = req.body || {};
    const projectId = String(body.projectId || '').trim();
    const manifest = body.manifest || {};
    const archiveBase64 = body.archiveBase64 || null;
    if (!projectId) return res.status(400).json({ error: 'projectId 必需' });
    if (!archiveBase64) return res.status(400).json({ error: 'archiveBase64 必需' });
    const buf = Buffer.from(String(archiveBase64), 'base64');
    const r = await saveProjectArchive(auth.sub, projectId, buf, manifest);
    res.json({ ok: true, key: r.key });
  } catch (e) {
    console.error('[projects] save', e);
    res.status(500).json({ error: e instanceof Error ? e.message : '保存失败' });
  }
}

export async function handleGetProject(req: Request, res: Response) {
  try {
    const pid = String(req.params.id || '').trim();
    if (!pid) return res.status(400).json({ error: 'id 必需' });
    const m = await getProjectManifest(pid);
    if (!m) return res.status(404).json({ error: '项目未找到' });
    res.json({ ok: true, manifest: m.manifest, storagePath: m.storage_path, version: m.version });
  } catch (e) {
    console.error('[projects] get', e);
    res.status(500).json({ error: e instanceof Error ? e.message : '读取失败' });
  }
}

export async function handleListMyProjects(req: Request, res: Response) {
  try {
    const auth = verifyToken((req.headers.authorization || '') as string);
    if (!auth) return res.status(401).json({ error: '未认证' });
    const rows = await listProjectsByOwner(auth.sub);
    res.json({ ok: true, projects: rows });
  } catch (e) {
    console.error('[projects] list', e);
    res.status(500).json({ error: e instanceof Error ? e.message : '读取失败' });
  }
}
