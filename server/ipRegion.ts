/** Resolve IP → 省市 for admin display. */

function isLocalIp(ip: string): boolean {
  const v = ip.trim().toLowerCase();
  if (!v) return true;
  if (v === '::1' || v === '127.0.0.1' || v === 'localhost') return true;
  if (v.startsWith('::ffff:127.')) return true;
  if (v.startsWith('10.') || v.startsWith('192.168.') || v.startsWith('172.')) {
    return true;
  }
  return false;
}

export async function lookupRegion(ip: string): Promise<string> {
  const clean = (ip || '').replace(/^::ffff:/, '').trim();
  if (!clean || isLocalIp(clean)) return '本地';

  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 3500);
    const res = await fetch(
      `http://ip-api.com/json/${encodeURIComponent(clean)}?lang=zh-CN&fields=status,regionName,city,message`,
      { signal: ctrl.signal },
    );
    clearTimeout(timer);
    if (!res.ok) return '';
    const data = (await res.json()) as {
      status?: string;
      regionName?: string;
      city?: string;
    };
    if (data.status !== 'success') return '';
    const region = (data.regionName || '').trim();
    const city = (data.city || '').trim();
    if (region && city && region !== city) return `${region} ${city}`;
    return region || city || '';
  } catch {
    return '';
  }
}
