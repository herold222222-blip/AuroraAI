const MESHY_BASE = 'https://api.meshy.ai/openapi/v1';

function apiKey() {
  const key = process.env.MESHY_API_KEY?.trim();
  if (!key) {
    throw new Error('未配置 MESHY_API_KEY，请在 .env 中设置');
  }
  return key;
}

export interface MeshyCreateBody {
  imageDataUrl: string;
  enablePbr?: boolean;
  shouldTexture?: boolean;
  textureResolution?: '2k' | '4k' | '8k';
  aiModel?: string;
}

export async function createImageTo3dTask(body: MeshyCreateBody) {
  const image_url = body.imageDataUrl;
  if (!image_url?.startsWith('data:image/')) {
    throw new Error('Meshy 需要 data:image 格式的图片');
  }

  const payload: Record<string, unknown> = {
    image_url,
    ai_model: body.aiModel ?? 'latest',
    should_texture: body.shouldTexture ?? true,
    enable_pbr: Boolean(body.enablePbr),
  };
  if (body.textureResolution) {
    payload.texture_resolution = body.textureResolution;
  }

  const res = await fetch(`${MESHY_BASE}/image-to-3d`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
  const data = (await res.json().catch(() => ({}))) as {
    result?: string;
    id?: string;
    message?: string;
    error?: string;
  };
  if (!res.ok) {
    throw new Error(
      data.message || data.error || `Meshy 创建任务失败 (${res.status})`,
    );
  }
  const id = data.result || data.id;
  if (!id) throw new Error('Meshy 未返回任务 ID');
  return { taskId: id };
}

export async function getImageTo3dTask(taskId: string) {
  const res = await fetch(`${MESHY_BASE}/image-to-3d/${encodeURIComponent(taskId)}`, {
    headers: { Authorization: `Bearer ${apiKey()}` },
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const msg =
      (data.message as string) ||
      (data.error as string) ||
      `Meshy 查询失败 (${res.status})`;
    throw new Error(msg);
  }
  return data;
}

/** Proxy Meshy CDN assets so the browser can load GLB without CORS errors. */
export async function fetchMeshyAsset(url: string): Promise<{
  buffer: Buffer;
  contentType: string;
}> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error('非法资源地址');
  }
  const host = parsed.hostname.toLowerCase();
  const allowed =
    host === 'meshy.ai' ||
    host.endsWith('.meshy.ai') ||
    host.endsWith('.meshy.dev') ||
    host.includes('meshy');
  if (!allowed || parsed.protocol !== 'https:') {
    throw new Error('仅允许代理 Meshy 资源');
  }
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`下载模型失败 (${res.status})`);
  }
  const buffer = Buffer.from(await res.arrayBuffer());
  const contentType =
    res.headers.get('content-type') || 'model/gltf-binary';
  return { buffer, contentType };
}
