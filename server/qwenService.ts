import type { EditRequest } from './geminiService';
import { buildEditPrompt } from './geminiService';

const DEFAULT_ENDPOINT =
  'https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation';

/** Prefer edit-oriented model; override with QWEN_IMAGE_MODEL. */
const DEFAULT_MODEL = 'qwen-image-edit-plus';

function getApiKey(override?: string): string {
  const key =
    override?.trim() ||
    process.env.DASHSCOPE_API_KEY?.trim() ||
    process.env.QWEN_API_KEY?.trim() ||
    process.env.QWEN_IMAGE_API_KEY?.trim();
  if (!key) {
    throw new Error(
      '缺少 DASHSCOPE_API_KEY（千问）。请在项目根目录 .env 或 Netlify 环境变量中配置后重试，或在管理员后台 API 管理中配置密钥。',
    );
  }
  return key;
}

function endpoint(baseOverride?: string): string {
  const base =
    baseOverride?.trim() || process.env.DASHSCOPE_BASE_URL?.trim();
  if (!base) return DEFAULT_ENDPOINT;
  if (base.includes('/services/')) return base;
  return `${base.replace(/\/$/, '')}/services/aigc/multimodal-generation/generation`;
}

function modelName(override?: string): string {
  return (
    override?.trim() ||
    process.env.QWEN_IMAGE_MODEL?.trim() ||
    DEFAULT_MODEL
  );
}

async function imageRefToDataUrl(image: string): Promise<string> {
  if (image.startsWith('data:')) return image;
  const res = await fetch(image);
  if (!res.ok) {
    throw new Error(`千问结果图下载失败（${res.status}）`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  const ct = res.headers.get('content-type') || 'image/png';
  return `data:${ct.split(';')[0]};base64,${buf.toString('base64')}`;
}

type ContentPart = { image?: string; text?: string };

/**
 * DashScope multimodal image edit (Qwen-Image / Qwen-Image-Edit).
 * Docs: multimodal-generation/generation with model qwen-image-edit-*
 */
export async function editImageWithQwen(req: EditRequest): Promise<{
  imageDataUrl: string;
  text?: string;
}> {
  const { assertApiEnabled } = await import('./apiStore');
  const runtime = await assertApiEnabled('qwen');
  const apiKey = getApiKey(runtime.apiKey);
  const prompt = buildEditPrompt(req);

  const content: ContentPart[] = [{ image: req.imageDataUrl }];

  // Qwen accepts 1–3 images total; prefer mask over extra refs when both exist.
  if (
    (req.mode === 'mask' || req.mode === 'hotspot') &&
    req.maskDataUrl
  ) {
    content.push({ image: req.maskDataUrl });
  }

  const refs = req.materialRefs ?? [];
  const slotsLeft = Math.max(0, 3 - content.length);
  for (const ref of refs.slice(0, slotsLeft)) {
    content.push({ image: ref });
  }

  content.push({ text: prompt });

  const body = {
    model: modelName(runtime.model),
    input: {
      messages: [
        {
          role: 'user',
          content,
        },
      ],
    },
    parameters: {
      n: 1,
      watermark: false,
      prompt_extend: true,
    },
  };

  let res: Response;
  try {
    res = await fetch(endpoint(runtime.baseUrl), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    });
  } catch {
    throw new Error('无法连接千问 / DashScope 服务，请检查网络后重试');
  }

  const raw = await res.text();
  let data: {
    code?: string;
    message?: string;
    output?: {
      choices?: Array<{
        message?: {
          content?: Array<{ image?: string; text?: string }>;
        };
      }>;
    };
  } = {};
  try {
    data = raw ? JSON.parse(raw) : {};
  } catch {
    /* non-JSON */
  }

  if (!res.ok || data.code) {
    const msg =
      data.message ||
      data.code ||
      raw.replace(/\s+/g, ' ').slice(0, 200) ||
      `HTTP ${res.status}`;
    throw new Error(`千问改图失败：${msg}`);
  }

  const parts = data.output?.choices?.[0]?.message?.content ?? [];
  let imageField = '';
  let text = '';
  for (const p of parts) {
    if (p.text) text += p.text;
    if (p.image) imageField = p.image;
  }
  if (!imageField) {
    throw new Error(text || '千问未返回图像，请重试或调整提示词');
  }

  const imageDataUrl = await imageRefToDataUrl(imageField);
  return { imageDataUrl, text: text || undefined };
}
