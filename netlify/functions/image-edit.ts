import { editImage, type EditRequest } from '../../server/geminiService';

const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
};

function json(statusCode: number, body: unknown) {
  return {
    statusCode,
    headers: corsHeaders,
    body: JSON.stringify(body),
  };
}

function readRawBody(event: {
  body: string | null;
  isBase64Encoded?: boolean;
}): string {
  if (!event.body) return '';
  if (event.isBase64Encoded) {
    return Buffer.from(event.body, 'base64').toString('utf8');
  }
  return event.body;
}

export async function handler(event: {
  httpMethod?: string;
  body: string | null;
  isBase64Encoded?: boolean;
  headers?: Record<string, string | undefined>;
}) {
  const method = (event.httpMethod || 'GET').toUpperCase();

  if (method === 'OPTIONS') {
    return { statusCode: 204, headers: corsHeaders, body: '' };
  }

  if (method !== 'POST') {
    return json(405, { error: 'Method Not Allowed' });
  }

  try {
    if (!process.env.GEMINI_API_KEY && !process.env.GOOGLE_API_KEY) {
      return json(500, {
        error:
          '缺少 GEMINI_API_KEY。请在 Netlify → Site configuration → Environment variables 中添加，并 Trigger deploy 重新部署。',
      });
    }

    const raw = readRawBody(event);
    if (!raw.trim()) {
      return json(400, {
        error:
          '云函数未收到请求体（body 为空）。请硬刷新页面后重试；若仍失败，在 Netlify 强制重新部署。',
      });
    }

    if (raw.length > 6 * 1024 * 1024) {
      return json(413, {
        error: '请求体过大（Netlify 限制约 6MB），请缩小图片后再试。',
      });
    }

    let body: EditRequest;
    try {
      body = JSON.parse(raw) as EditRequest;
    } catch {
      return json(400, { error: '请求体不是合法 JSON' });
    }

    if (!body?.imageDataUrl || !body?.prompt) {
      return json(400, {
        error: `参数不完整：需要 imageDataUrl 与 prompt（收到 keys: ${Object.keys(body || {}).join(',') || '无'}）`,
      });
    }

    const result = await editImage(body);
    return json(200, result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[image-edit]', message);
    // Surface Google/Gemini client 400s clearly
    return json(500, { error: message });
  }
}
