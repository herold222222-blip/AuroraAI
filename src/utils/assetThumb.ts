/**
 * 为 /api/assets/media（或 projects/media）URL 追加缩略图宽度参数，
 * 服务端走 OSS 图片处理，减小列表加载体积。
 */
export function assetThumbUrl(url: string, width = 480): string {
  const raw = String(url || '').trim();
  if (!raw || raw.startsWith('data:') || raw.startsWith('blob:')) return raw;
  try {
    const u = new URL(raw, window.location.origin);
    const path = u.pathname;
    if (
      !/\/api\/assets\/media$/i.test(path) &&
      !/\/api\/projects\/media$/i.test(path)
    ) {
      return raw;
    }
    u.searchParams.set(
      'w',
      String(Math.max(64, Math.min(2048, Math.floor(width)))),
    );
    return u.toString();
  } catch {
    return raw;
  }
}
