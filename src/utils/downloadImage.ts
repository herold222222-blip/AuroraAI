/** Browser download helpers for data/blob/http image URLs. */

export function sanitizeDownloadName(
  name: string,
  fallback = 'aurora-image',
): string {
  const base =
    name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').trim() || fallback;
  return /\.(png|jpe?g|webp|gif)$/i.test(base) ? base : `${base}.png`;
}

export async function downloadImage(
  url: string,
  filename?: string,
): Promise<void> {
  if (!url) throw new Error('empty url');
  const name = sanitizeDownloadName(filename || `aurora-${Date.now()}`);

  if (url.startsWith('data:') || url.startsWith('blob:')) {
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
    return;
  }

  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const blob = await res.blob();
    const objectUrl = URL.createObjectURL(blob);
    try {
      const a = document.createElement('a');
      a.href = objectUrl;
      a.download = name;
      a.rel = 'noopener';
      document.body.appendChild(a);
      a.click();
      a.remove();
    } finally {
      URL.revokeObjectURL(objectUrl);
    }
  } catch {
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.target = '_blank';
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
  }
}

export async function downloadImages(
  items: { url: string; filename?: string }[],
): Promise<number> {
  let n = 0;
  for (const item of items) {
    if (!item.url) continue;
    try {
      await downloadImage(item.url, item.filename);
      n += 1;
      await new Promise((r) => setTimeout(r, 140));
    } catch {
      /* skip failed item */
    }
  }
  return n;
}
