/**
 * 解析后端 API 完整 URL。
 * - 开发：默认走同源 `/api/...`，由 Vite 代理到 VITE_API_ORIGIN
 * - 生产：拼到 VITE_API_ORIGIN（若未配置则仍用相对路径）
 */
export function apiUrl(path: string): string {
  const p = path.startsWith('/') ? path : `/${path}`;
  if (import.meta.env.DEV) {
    return p;
  }
  const origin = String(import.meta.env.VITE_API_ORIGIN || '').replace(/\/$/, '');
  return origin ? `${origin}${p}` : p;
}

export function apiOrigin(): string {
  return String(import.meta.env.VITE_API_ORIGIN || '').replace(/\/$/, '');
}
