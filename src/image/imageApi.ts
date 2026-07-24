export interface ImageEditPayload {
  imageDataUrl: string;
  prompt: string;
  mode?: 'global' | 'hotspot' | 'mask';
  hotspot?: { x: number; y: number };
  maskDataUrl?: string;
  materialRefs?: string[];
  systemHint?: string;
}

export async function requestImageEdit(payload: ImageEditPayload): Promise<{
  imageDataUrl: string;
  text?: string;
}> {
  const res = await fetch('/api/image/edit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || `请求失败 (${res.status})`);
  }
  return data;
}
