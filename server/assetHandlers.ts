import type { Request, Response } from 'express';
import oss, { publicObjectUrl } from './ossStore';

const IMAGE_EXT = ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg', '.bmp'];
const MODEL_EXT = ['.glb', '.gltf'];

function classifyKey(key: string): 'image' | 'model' | 'other' {
  const lower = key.toLowerCase();
  if (MODEL_EXT.some((e) => lower.endsWith(e))) return 'model';
  if (IMAGE_EXT.some((e) => lower.endsWith(e))) return 'image';
  return 'other';
}

// Return a simple asset manifest by listing OSS prefix 'assets/'
export async function handleListAssets(req: Request, res: Response) {
  try {
    const prefix = String(req.query.prefix || 'assets/');
    const max = Number(req.query.max || 1000);
    const objs = await oss.listObjects(prefix, max);
    const entries = (objs || []).map((o) => {
      const meta = o as { name?: string; key?: string; size?: number; lastModified?: string; time?: string };
      const key = meta.name || meta.key || '';
      return {
        key,
        size: meta.size,
        lastModified: meta.lastModified || meta.time || null,
        url: publicObjectUrl(key),
        kind: classifyKey(key),
      };
    });
    res.json({ ok: true, entries });
  } catch (e) {
    console.error('[assets] list', e);
    res.status(500).json({ error: e instanceof Error ? e.message : 'failed' });
  }
}

/**
 * Lightweight counts — avoids shipping full manifest to the client.
 * Query: ?prefix=assets/ (optional)
 */
export async function handleAssetCounts(req: Request, res: Response) {
  try {
    const prefix = String(req.query.prefix || 'assets/');
    const max = Number(req.query.max || 10000);
    const objs = await oss.listObjects(prefix, max);
    let image = 0;
    let model = 0;
    for (const o of objs || []) {
      const key = String((o as { name?: string; key?: string }).name || (o as { key?: string }).key || '');
      const kind = classifyKey(key);
      if (kind === 'image') image += 1;
      else if (kind === 'model') model += 1;
    }
    res.json({
      ok: true,
      counts: { image, model },
      limits: { image: 20, model: 2 },
    });
  } catch (e) {
    console.error('[assets] counts', e);
    res.status(500).json({ error: e instanceof Error ? e.message : 'failed' });
  }
}
