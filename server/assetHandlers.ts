import type { Request, Response } from 'express';
import oss from './ossStore';

// Return a simple asset manifest by listing OSS prefix 'assets/'
export async function handleListAssets(req: Request, res: Response) {
  try {
    const prefix = String(req.query.prefix || 'assets/');
    const max = Number(req.query.max || 1000);
    const objs = await oss.listObjects(prefix, max);
    // Map to a minimal manifest entry
    const entries = (objs || []).map((o: any) => ({
      key: o.name || o.key || o.name,
      size: o.size,
      lastModified: o.lastModified || o.time || null,
      url: `https://${process.env.OSS_BUCKET}.${process.env.OSS_ENDPOINT || process.env.OSS_REGION || 'oss-cn-hangzhou'}/${encodeURIComponent(o.name || o.key)}`,
    }));
    res.json({ ok: true, entries });
  } catch (e) {
    console.error('[assets] list', e);
    res.status(500).json({ error: e instanceof Error ? e.message : 'failed' });
  }
}
