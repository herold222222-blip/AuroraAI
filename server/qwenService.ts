import type { EditRequest } from './geminiService';

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

/** Read width/height from PNG/JPEG data URL for DashScope `size`. */
function readImageSizeFromDataUrl(
  dataUrl: string,
): { w: number; h: number } | null {
  const m = /^data:[^;]+;base64,(.+)$/s.exec(dataUrl);
  if (!m) return null;
  let buf: Buffer;
  try {
    buf = Buffer.from(m[1], 'base64');
  } catch {
    return null;
  }
  if (buf.length < 24) return null;
  // PNG IHDR
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
    return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
  }
  // JPEG — scan for SOF0/SOF2
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2;
    while (i + 9 < buf.length) {
      if (buf[i] !== 0xff) {
        i++;
        continue;
      }
      const marker = buf[i + 1];
      if (marker === 0xc0 || marker === 0xc2) {
        return { w: buf.readUInt16BE(i + 7), h: buf.readUInt16BE(i + 5) };
      }
      if (marker === 0xd8 || marker === 0xd9) {
        i += 2;
        continue;
      }
      const len = buf.readUInt16BE(i + 2);
      i += 2 + len;
    }
  }
  return null;
}

/** DashScope edit-plus/max: each side 512–2048, multiple of 16. */
function qwenOutputSize(
  w: number,
  h: number,
): string | undefined {
  if (!w || !h) return undefined;
  const maxSide = 1536;
  const scale = Math.min(1, maxSide / Math.max(w, h));
  let ow = Math.round((w * scale) / 16) * 16;
  let oh = Math.round((h * scale) / 16) * 16;
  ow = Math.min(2048, Math.max(512, ow));
  oh = Math.min(2048, Math.max(512, oh));
  return `${ow}*${oh}`;
}

/**
 * Qwen-Image-Edit expects 图1/图2/图3 as content photos, NOT Gemini-style
 * binary masks. Prefer Chinese instructions; disable prompt_extend for local edits.
 */
function buildQwenEditPrompt(req: EditRequest): string {
  const user = (req.prompt || '').trim();
  const parts: string[] = [];

  if (req.mode === 'mask') {
    if (req.visualGuideBaked) {
      parts.push(
        [
          '图1是从原图裁出的局部编辑区（涂抹区）。半透明红色标出重点绘制范围。',
          '【首要任务】必须按用户要求对画面做出明显、可见的修改；只去掉红色、画面几乎不变 = 失败。',
          '若用户要求增加人物/物体：在画面中生成完整主体（人物含头身双腿双脚），与地面光影融合，禁止白底抠图。',
          '主体须完整落在画面内；偏大则缩小。最后再去除红色覆盖。',
          '输出与图1同构图的编辑结果。',
        ].join('\n'),
      );
    } else if (req.maskDataUrl) {
      parts.push(
        [
          '图1是待编辑的原图。图2是编辑蒙版（白色/亮区=允许修改；黑色/暗区=禁止修改）。',
          '注意：图2不是另一张内容参考图，而是空间蒙版。',
          '仅修改图2白色区域内的内容；黑色区域必须与图1像素级保持一致。',
          '【完整主体】新增内容必须完整落在白色蒙版内（人物含双腿双脚），放不下则缩小，禁止缺肢裁切。',
          '与场景融合，禁止白底抠图。输出与图1同构图的完整成片。',
        ].join('\n'),
      );
    } else {
      parts.push('请按用户要求编辑图1，保持整体构图与未提及区域不变。');
    }
  } else if (req.mode === 'sketch') {
    parts.push(
      [
        '图1是带红色手绘标记与红色数字编号的照片（素描标记）。',
        '每个红色数字对应一条「标记N」指令，只修改该编号下方的真实主体/材质，不要改未标记区域。',
        '若有多条标记，请在同一次编辑中全部完成。',
        '输出必须是干净成片：去掉所有红笔、编号圆点与标注痕迹。',
        '保持原图构图、光影与未标记区域不变。',
      ].join('\n'),
    );
  } else if (req.mode === 'hotspot') {
    parts.push(
      [
        req.visualGuideBaked
          ? '图1是待编辑照片；半透明红色区域为优先编辑范围。'
          : '图1是待编辑照片；请围绕用户指定的局部对象修改。',
        req.hotspot
          ? `焦点大致在像素 (${Math.round(req.hotspot.x)}, ${Math.round(req.hotspot.y)}) 附近的对象/材质上。`
          : '',
        '只改该局部对象，其余区域保持与原图一致；匹配原有光照与接触阴影。',
        '输出完整成片，去掉红色辅助覆盖（如有）。',
      ]
        .filter(Boolean)
        .join('\n'),
    );
  } else {
    parts.push(
      '请按用户要求编辑图1。保持主体结构与构图稳定；参考图仅作外观/材质提示，不要照搬参考图布局。',
    );
  }

  if (req.materialRefs?.length) {
    const n = req.materialRefs.length;
    // Image index after the primary photo (+ optional raw mask as 图2).
    const refStart =
      !req.visualGuideBaked &&
      req.maskDataUrl &&
      (req.mode === 'mask' || req.mode === 'hotspot')
        ? 3
        : 2;
    const labels = Array.from(
      { length: n },
      (_, i) => `图${i + refStart}`,
    ).join('、');
    if (req.mode === 'mask' || req.mode === 'hotspot' || req.mode === 'sketch') {
      parts.push(
        `随后的${labels}是外观参考图（材质/颜色/风格）。仅用于允许编辑的局部，不要改变未编辑区域，不要复制参考图的构图。`,
      );
    } else {
      parts.push(
        `${labels}为外观/风格参考。只借鉴材质、配色与氛围，不要复制其构图与镜头。`,
      );
    }
  }

  if (req.systemHint?.trim() && req.mode === 'global') {
    parts.push(req.systemHint.trim());
  }

  parts.push(`用户要求（必须执行并产生可见变化）：\n${user}`);
  if (req.mode === 'mask') {
    parts.push(
      '验收标准：结果图与输入相比，在编辑区内必须有符合用户要求的明显变化；仅清除红色标注不算完成。新增主体须完整、无缺肢。',
    );
  }
  parts.push('请直接输出编辑后的完整图像，不要边框、水印或说明文字。');
  return parts.join('\n\n');
}

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
  const prompt = buildQwenEditPrompt(req);
  const localPrecise =
    req.mode === 'mask' || req.mode === 'hotspot' || req.mode === 'sketch';

  const content: ContentPart[] = [{ image: req.imageDataUrl }];

  // Prefer baked visual guide (single image). Only attach a raw mask when
  // the client did not bake one — and never treat it as a style reference.
  if (
    !req.visualGuideBaked &&
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

  const dims = readImageSizeFromDataUrl(req.imageDataUrl);
  const size = dims ? qwenOutputSize(dims.w, dims.h) : undefined;

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
      // Mask ROI prompts are short Chinese — rewriting helps Qwen actually apply edits.
      // Sketch/hotspot keep extend off to preserve mark constraints.
      prompt_extend: req.mode === 'mask' ? true : localPrecise ? false : true,
      negative_prompt: localPrecise
        ? '白底, 纯白背景, 抠图, 贴纸感, 缺腿, 缺手臂, 缺脚, 单腿, 半身裁切, 肢体残缺, 身体不完整, 边缘截断, 完全无变化, 原图不变, 保留红色标注, 红色笔迹, 编号圆点'
        : ' ',
      ...(size ? { size } : {}),
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
