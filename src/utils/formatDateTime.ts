/** 把接口里各种时间值收成毫秒；无效则 null（不会扔 Invalid time value）。 */
export function toEpochMs(ts: unknown): number | null {
  if (ts == null || ts === '') return null;
  if (ts instanceof Date) {
    const t = ts.getTime();
    return Number.isFinite(t) ? t : null;
  }
  if (typeof ts === 'number') {
    if (!Number.isFinite(ts) || ts <= 0) return null;
    const ms = ts < 1e12 ? Math.round(ts * 1000) : ts;
    return Number.isFinite(new Date(ms).getTime()) ? ms : null;
  }
  const s = String(ts).trim();
  if (!s || s === 'Invalid Date' || s === 'null' || s === 'undefined') {
    return null;
  }
  const asNum = Number(s);
  if (Number.isFinite(asNum) && asNum > 0) {
    const ms = asNum < 1e12 ? Math.round(asNum * 1000) : asNum;
    if (Number.isFinite(new Date(ms).getTime())) return ms;
  }
  const parsed = Date.parse(s);
  return Number.isFinite(parsed) ? parsed : null;
}

export function toISOStringSafe(ts: unknown): string | undefined {
  const ms = toEpochMs(ts);
  if (ms == null) return undefined;
  try {
    const d = new Date(ms);
    if (Number.isNaN(d.getTime())) return undefined;
    return d.toISOString();
  } catch {
    return undefined;
  }
}

/** Format timestamp as `YYYY-MM-DD HH:mm:ss` (local time). */
export function formatDateTime(ts: unknown): string {
  const ms = toEpochMs(ts);
  if (ms == null) return '';
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}
