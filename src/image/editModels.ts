export type ImageEditModelId = 'banana-gemini' | 'qwen-image';

export const IMAGE_EDIT_MODELS: {
  id: ImageEditModelId;
  kind: 'gemini' | 'qwen';
  label: string;
  hint: string;
  ready: boolean;
}[] = [
  {
    id: 'banana-gemini',
    kind: 'gemini',
    label: 'Banana-gemini',
    hint: '当前默认改图模型',
    ready: true,
  },
  {
    id: 'qwen-image',
    kind: 'qwen',
    label: 'Qwen-Image',
    hint: '阿里云千问图像编辑模型',
    ready: true,
  },
];

export const DEFAULT_IMAGE_EDIT_MODEL: ImageEditModelId = 'banana-gemini';

export function resolveImageEditModel(
  id: string | null | undefined,
): ImageEditModelId {
  if (id && IMAGE_EDIT_MODELS.some((m) => m.id === id)) {
    return id as ImageEditModelId;
  }
  return DEFAULT_IMAGE_EDIT_MODEL;
}

export function isImageEditModelReady(id: ImageEditModelId): boolean {
  return IMAGE_EDIT_MODELS.find((m) => m.id === id)?.ready ?? false;
}
