import { editImage, type EditRequest } from '../../server/geminiService';

const corsHeaders = {
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

export async function handler(event: {
  httpMethod: string;
  body: string | null;
  isBase64Encoded?: boolean;
}) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: corsHeaders, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return json(405, { error: 'Method Not Allowed' });
  }

  try {
    if (!process.env.GEMINI_API_KEY && !process.env.GOOGLE_API_KEY) {
      return json(500, {
        error:
          '缺少 GEMINI_API_KEY。请在 Netlify → Site configuration → Environment variables 中添加，并 Trigger deploy 重新部署。',
      });
    }

    const raw = event.isBase64Encoded
      ? Buffer.from(event.body ?? '', 'base64').toString('utf8')
      : (event.body ?? '');

    if (raw.length > 6 * 1024 * 1024) {
      return json(413, {
        error: '请求体过大（Netlify 限制约 6MB），请缩小图片后再试。',
      });
    }

    const body = JSON.parse(raw || '{}') as EditRequest;

    if (!body?.imageDataUrl || !body?.prompt) {
      return json(400, { error: 'imageDataUrl 与 prompt 必填' });
    }

    const result = await editImage(body);
    return json(200, result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[image-edit]', message);
    return json(500, { error: message });
  }
}
