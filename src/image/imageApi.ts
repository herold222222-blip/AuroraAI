export interface ImageEditPayload {
  imageDataUrl: string;
  prompt: string;
  mode?: 'global' | 'hotspot' | 'mask' | 'sketch';
  hotspot?: { x: number; y: number };
  maskDataUrl?: string;
  materialRefs?: string[];
  systemHint?: string;
}

const NETLIFY_SAFE_BYTES = 5.5 * 1024 * 1024;

function approxPayloadBytes(payload: ImageEditPayload): number {
  return JSON.stringify(payload).length;
}

/** On Netlify, call the function URL directly to avoid rewrite dropping POST bodies. */
function editEndpoint(): string {
  if (typeof window !== 'undefined') {
    const host = window.location.hostname;
    if (host.endsWith('netlify.app') || host.endsWith('netlify.com')) {
      return '/.netlify/functions/image-edit';
    }
  }
  return '/api/image/edit';
}

export async function requestImageEdit(payload: ImageEditPayload): Promise<{
  imageDataUrl: string;
  text?: string;
}> {
  const size = approxPayloadBytes(payload);
  if (size > NETLIFY_SAFE_BYTES) {
    throw new Error(
      '图片数据过大，超出 Netlify 云函数请求限制（约 6MB）。请先缩小原图或降低分辨率后再试。',
    );
  }

  let res: Response;
  try {
    res = await fetch(editEndpoint(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch {
    throw new Error('无法连接图像编辑服务，请检查网络后重试');
  }

  const raw = await res.text();
  let data: { error?: string; imageDataUrl?: string; text?: string } = {};
  try {
    data = raw ? JSON.parse(raw) : {};
  } catch {
    /* non-JSON (Netlify timeout / HTML error page) */
  }

  if (!res.ok) {
    if (data.error) throw new Error(data.error);
    if (res.status === 404) {
      throw new Error(
        '图像编辑接口未部署。请确认 Netlify 已包含 Functions，并重新部署。',
      );
    }
    if (res.status === 502 || res.status === 504 || res.status === 408) {
      throw new Error(
        '图像生成超时。免费版 Netlify 函数最长约 10 秒；可升级套餐或稍后重试。',
      );
    }
    if (res.status === 413) {
      throw new Error('请求体过大，请缩小图片后再试。');
    }
    if (res.status === 400) {
      throw new Error(
        '请求无效 (400)。多半是云函数未收到图片数据，或 GEMINI_API_KEY 无效。请确认环境变量已配置，并强制重新部署后再试。',
      );
    }
    const snippet = raw.replace(/\s+/g, ' ').slice(0, 120);
    throw new Error(
      snippet
        ? `请求失败 (${res.status}): ${snippet}`
        : `请求失败 (${res.status})。请到 Netlify → Environment variables 确认 GEMINI_API_KEY，并查看 Functions 日志。`,
    );
  }

  if (!data.imageDataUrl) {
    throw new Error(data.error || '服务未返回图像，请重试');
  }
  return { imageDataUrl: data.imageDataUrl, text: data.text };
}
