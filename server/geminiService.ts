import { GoogleGenAI, Modality } from '@google/genai';

const MODEL = 'gemini-3.1-flash-image';

export interface EditRequest {
  imageDataUrl: string;
  prompt: string;
  mode?: 'global' | 'hotspot' | 'mask';
  hotspot?: { x: number; y: number };
  maskDataUrl?: string;
  materialRefs?: string[];
  systemHint?: string;
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
    throw new Error('缺少 GEMINI_API_KEY，请在 .env 中配置');
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

function buildPrompt(req: EditRequest): string {
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
        req.hotspot
          ? `- The click focus is near pixel (${Math.round(req.hotspot.x)}, ${Math.round(req.hotspot.y)}); prefer editing the connected object/material under that point within the white mask.`
          : '',
      ]
        .filter(Boolean)
        .join('\n'),
    );
  } else if (req.mode === 'hotspot' && req.hotspot) {
    parts.push(
      [
        'LOCAL OBJECT EDIT (hotspot / click-to-select):',
        `Focus pixel: (${Math.round(req.hotspot.x)}, ${Math.round(req.hotspot.y)}).`,
        '1) Mentally segment the single connected object or material patch under that pixel',
        '   (furniture, door, window, plant, railing, facade panel, pavement, textile, etc.).',
        '2) Apply the user instruction ONLY to that object / material.',
        '3) Every other pixel must stay visually identical (same RGB appearance, lighting, geometry).',
        '4) Do not regrade the whole image, change the sky, or restyle neighboring elements.',
        '5) Match existing light direction and contact shadows on the edited object.',
        '6) Keep full-frame size identical to the input.',
      ].join('\n'),
    );
  }

  parts.push(`USER INSTRUCTION:\n${req.prompt}`);

  if (req.materialRefs?.length) {
    parts.push(
      `${req.materialRefs.length} reference image(s) follow AFTER the mask (if any). Use them ONLY as appearance references for the allowed edit region — never restyle the whole image.`,
    );
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
  const ai = getClient();
  const { mimeType, base64 } = parseDataUrl(req.imageDataUrl);

  const contents: Array<{
    text?: string;
    inlineData?: { mimeType: string; data: string };
  }> = [{ text: buildPrompt(req) }, { inlineData: { mimeType, data: base64 } }];

  if (req.mode === 'mask' && req.maskDataUrl) {
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
