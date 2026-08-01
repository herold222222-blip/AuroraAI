import { GoogleGenAI, Modality } from '@google/genai';

const MODEL = 'gemini-3.1-flash-image';

export interface EditRequest {
  imageDataUrl: string;
  prompt: string;
  mode?: 'global' | 'hotspot' | 'mask' | 'sketch';
  hotspot?: { x: number; y: number };
  maskDataUrl?: string;
  materialRefs?: string[];
  systemHint?: string;
  /** banana-gemini | qwen-image — qwen wired when API is provided */
  model?: string;
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  retries = 3,
  baseMs = 800,
): Promise<T> {
  let last: unknown;
  for (let i = 0; i <= retries; i++) {
    try {
      return await fn();
    } catch (err) {
      last = err;
      if (i === retries) break;
      await sleep(baseMs * Math.pow(2, i));
    }
  }
  throw last;
}

function parseDataUrl(dataUrl: string): { mimeType: string; base64: string } {
  const m = /^data:([^;]+);base64,(.+)$/s.exec(dataUrl);
  if (!m) throw new Error('Invalid data URL');
  return { mimeType: m[1], base64: m[2] };
}

function getClient() {
  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  if (!apiKey) {
    throw new Error(
      '缺少 GEMINI_API_KEY。请在 Netlify → Site configuration → Environment variables 中添加该变量并重新部署（本地开发则写入项目根目录 .env）。',
    );
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

export function buildEditPrompt(req: EditRequest): string {
  const parts: string[] = [];
  if (req.systemHint) parts.push(req.systemHint);

  if (req.mode === 'mask') {
    parts.push(
      [
        'IMAGE 1 = original photo to edit.',
        'IMAGE 2 = binary edit mask (white/bright = MUST edit; black/dark = MUST NOT change).',
        'STRICT RULES:',
        '- Modify ONLY white/bright mask pixels according to the user instruction.',
        '- Black/dark mask pixels must stay pixel-identical to IMAGE 1 (same RGB).',
        '- Do not spill edits across mask edges; do not alter unmasked objects, sky, ground, or lighting globally.',
        '- Keep full-frame size identical to IMAGE 1.',
        '- This may be one step in a sequence of local edits; do not drift geometry or restyle outside the mask.',
        req.hotspot
          ? `- Focus near pixel (${Math.round(req.hotspot.x)}, ${Math.round(req.hotspot.y)}) (mask centroid); prefer the material under that point within the white mask.`
          : '',
      ]
        .filter(Boolean)
        .join('\n'),
    );
  } else if (req.mode === 'sketch') {
    parts.push(
      [
        'GEMINI SKETCH / MARKUP IMAGE EDIT:',
        'IMAGE 1 = photo with red freehand strokes and red numbered badges drawn on subjects to edit.',
        'There is NO separate mask image — the red ink ON the photo is the spatial guide (same as Gemini app markup).',
        '1) For each "Mark N: …" in the user instruction, locate red mark number N on IMAGE 1.',
        '2) Identify the real-world subject / material under that mark (not the ink itself).',
        '3) Apply that mark\'s instruction ONLY to that subject.',
        '4) When multiple marks are present, apply ALL of them in one coherent edit pass.',
        '5) Leave unmarked areas visually unchanged (geometry, lighting, neighbors, sky, background).',
        '6) OUTPUT MUST be a clean photo: erase every red stroke, number badge, circle, and markup artifact.',
        '7) Keep full-frame size identical to IMAGE 1. No borders, captions, or watermarks.',
      ].join('\n'),
    );
  } else if (req.mode === 'hotspot' && req.hotspot) {
    parts.push(
      [
        'LOCAL OBJECT EDIT (hotspot / click-to-select):',
        `Focus pixel: (${Math.round(req.hotspot.x)}, ${Math.round(req.hotspot.y)}).`,
        req.maskDataUrl
          ? 'IMAGE 1 = original photo; IMAGE 2 = soft ROI mask (white/bright = preferred edit zone).'
          : '',
        '1) Identify the single connected object or material patch under the focus pixel',
        '   (furniture, door, window, plant, railing, facade panel, pavement, textile, etc.).',
        '2) Apply the user instruction ONLY to that object / material.',
        req.maskDataUrl
          ? '3) Prefer staying inside the white/bright ROI; never invent changes far outside it.'
          : '3) Do not expand the edit beyond that object.',
        '4) Every other pixel must stay visually identical (same RGB appearance, lighting, geometry).',
        '5) Do not regrade the whole image, change the sky, or restyle neighboring elements.',
        '6) Match existing light direction and contact shadows on the edited object.',
        '7) Keep full-frame size identical to the input.',
      ]
        .filter(Boolean)
        .join('\n'),
    );
  }

  parts.push(`USER INSTRUCTION:\n${req.prompt}`);

  if (req.materialRefs?.length) {
    const labels = req.materialRefs
      .map((_, i) => `图${i + 1}`)
      .join('、');
    if (req.mode === 'global') {
      parts.push(
        `${req.materialRefs.length} style reference image(s) follow, labeled ${labels} in order.`,
        'Use them as APPEARANCE / STYLE REFERENCES only: materials, color grading, lighting mood, texture language, and aesthetic.',
        'CRITICAL: Do NOT copy the references\' spatial layout, composition, camera, or object arrangement. Keep the INPUT image structure/layout strictly unchanged.',
        'When the user mentions 图1/图2/…, prioritize that reference for appearance cues.',
      );
    } else if (req.mode === 'sketch') {
      parts.push(
        `${req.materialRefs.length} reference image(s) follow, labeled ${labels} in order.`,
        'When a Mark instruction mentions 图1/图2/…, use that reference for the marked subject only.',
        'Use references as appearance cues for marked subjects — never restyle unmarked areas.',
      );
    } else {
      parts.push(
        `${req.materialRefs.length} reference image(s) follow AFTER the mask (if any), labeled ${labels} in order.`,
        'When the user mentions 图1/图2/…, use the matching reference.',
        'Use them ONLY as appearance references for the allowed edit region — never restyle the whole image.',
      );
    }
  }

  parts.push(
    'Return one full-frame edited image at the same resolution as the input. No borders, captions, or watermarks.',
  );
  return parts.join('\n\n');
}

export async function editImage(req: EditRequest): Promise<{
  imageDataUrl: string;
  text?: string;
}> {
  const model = req.model || 'banana-gemini';
  if (model === 'qwen-image') {
    const { editImageWithQwen } = await import('./qwenService');
    return editImageWithQwen(req);
  }

  const ai = getClient();
  const { mimeType, base64 } = parseDataUrl(req.imageDataUrl);

  const contents: Array<{
    text?: string;
    inlineData?: { mimeType: string; data: string };
  }> = [
    { text: buildEditPrompt(req) },
    { inlineData: { mimeType, data: base64 } },
  ];

  if (
    (req.mode === 'mask' || req.mode === 'hotspot') &&
    req.maskDataUrl
  ) {
    const mask = parseDataUrl(req.maskDataUrl);
    contents.push({
      inlineData: { mimeType: mask.mimeType, data: mask.base64 },
    });
  }

  for (const ref of req.materialRefs ?? []) {
    const r = parseDataUrl(ref);
    contents.push({ inlineData: { mimeType: r.mimeType, data: r.base64 } });
  }

  const response = await withRetry(() =>
    ai.models.generateContent({
      model: MODEL,
      contents: [{ role: 'user', parts: contents }],
      config: {
        responseModalities: [Modality.TEXT, Modality.IMAGE],
      },
    }),
  );

  const parts = response.candidates?.[0]?.content?.parts ?? [];
  let imageDataUrl = '';
  let text = '';
  for (const part of parts) {
    if (part.text) text += part.text;
    if (part.inlineData?.data) {
      const mt = part.inlineData.mimeType || 'image/png';
      imageDataUrl = `data:${mt};base64,${part.inlineData.data}`;
    }
  }
  if (!imageDataUrl) {
    throw new Error(text || '模型未返回图像，请重试或调整提示词');
  }
  return { imageDataUrl, text: text || undefined };
}
