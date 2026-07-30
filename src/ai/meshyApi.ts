async function toDataUrl(url: string): Promise<string> {
  if (url.startsWith('data:')) return url;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`读取图片失败 (${res.status})`);
  const blob = await res.blob();
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('图片转码失败'));
    reader.readAsDataURL(blob);
  });
}

export async function createMeshyImageTo3d(opts: {
  imageUrl: string;
  enablePbr?: boolean;
  textureQuality?: '2K' | '4K';
}) {
  const imageDataUrl = await toDataUrl(opts.imageUrl);
  const res = await fetch('/api/meshy/image-to-3d', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      imageDataUrl,
      enablePbr: Boolean(opts.enablePbr),
      shouldTexture: true,
      textureResolution: opts.textureQuality === '4K' ? '4k' : '2k',
      aiModel: 'latest',
    }),
  });
  const data = (await res.json().catch(() => ({}))) as {
    taskId?: string;
    error?: string;
  };
  if (!res.ok || !data.taskId) {
    throw new Error(data.error || `Meshy 创建失败 (${res.status})`);
  }
  return data.taskId;
}

export async function pollMeshyImageTo3d(
  taskId: string,
  onProgress?: (progress: number, status: string) => void,
): Promise<{ glbUrl: string; task: Record<string, unknown> }> {
  const started = Date.now();
  const timeoutMs = 8 * 60 * 1000;

  while (Date.now() - started < timeoutMs) {
    const res = await fetch(`/api/meshy/image-to-3d/${encodeURIComponent(taskId)}`);
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown> & {
      error?: string;
      status?: string;
      progress?: number;
      model_urls?: { glb?: string };
    };
    if (!res.ok) {
      throw new Error(data.error || `Meshy 查询失败 (${res.status})`);
    }
    const status = String(data.status || '');
    const progress =
      typeof data.progress === 'number' ? data.progress : status === 'SUCCEEDED' ? 100 : 0;
    onProgress?.(progress, status);

    if (status === 'SUCCEEDED') {
      const urls = data.model_urls as Record<string, string> | undefined;
      const glbUrl =
        urls?.glb ||
        (typeof (data as { model_url?: string }).model_url === 'string'
          ? (data as { model_url: string }).model_url
          : undefined);
      if (!glbUrl) throw new Error('Meshy 成功但未返回 GLB 地址');
      return { glbUrl, task: data };
    }
    if (status === 'FAILED' || status === 'CANCELED') {
      const msg =
        (data as { task_error?: { message?: string } }).task_error?.message ||
        `Meshy 任务${status}`;
      throw new Error(msg);
    }
    await new Promise((r) => setTimeout(r, 2500));
  }
  throw new Error('Meshy 生成超时，请稍后重试');
}
