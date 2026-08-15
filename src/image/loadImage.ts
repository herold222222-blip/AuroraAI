/**
 * 安全加载图片到 HTMLImageElement，避免跨域图 drawImage 后 toDataURL 抛
 * "Tainted canvases may not be exported"。
 *
 * 策略：http(s) 优先 fetch→blob→objectURL（同源/可 CORS 时不污染画布）；
 * 失败再回退到 img + crossOrigin=anonymous。
 */

function decodeFromSrc(src: string, useCors: boolean): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    if (useCors) img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('图片加载失败'));
    img.src = src;
  });
}

function isHttpUrl(src: string): boolean {
  return /^https?:\/\//i.test(src) || src.startsWith('//');
}

function isInlineUrl(src: string): boolean {
  return src.startsWith('data:') || src.startsWith('blob:');
}

/** 是否与当前页面同源（同源不必 crossOrigin，也避免多余预检） */
function isSameOrigin(src: string): boolean {
  try {
    const u = new URL(src, typeof window !== 'undefined' ? window.location.href : undefined);
    return typeof window !== 'undefined' && u.origin === window.location.origin;
  } catch {
    return false;
  }
}

/**
 * 加载任意图片 URL，保证随后 canvas.toDataURL / getImageData 可用。
 */
export async function loadImageEl(src: string): Promise<HTMLImageElement> {
  const url = String(src || '').trim();
  if (!url) throw new Error('图片地址为空');

  if (isInlineUrl(url)) {
    return decodeFromSrc(url, false);
  }

  if (isHttpUrl(url) || url.startsWith('/')) {
    // 绝对 http(s) 或站点相对路径：优先拉成 blob，彻底避免污染
    try {
      const absolute = url.startsWith('//')
        ? `${typeof window !== 'undefined' ? window.location.protocol : 'https:'}${url}`
        : url;
      const res = await fetch(absolute, {
        mode: 'cors',
        credentials: isSameOrigin(absolute) ? 'same-origin' : 'omit',
        cache: 'force-cache',
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const objectUrl = URL.createObjectURL(blob);
      try {
        const img = await decodeFromSrc(objectUrl, false);
      // 延迟释放，确保解码缓冲已落到 img 位图
      setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
      return img;
    } catch (e) {
      URL.revokeObjectURL(objectUrl);
      throw e;
    }
    } catch {
      // OSS 未配 CORS 时 fetch 失败：尝试 anonymous（需桶开 CORS 才不污染）
      if (!isSameOrigin(url) && isHttpUrl(url)) {
        return decodeFromSrc(url, true);
      }
      return decodeFromSrc(url, false);
    }
  }

  return decodeFromSrc(url, false);
}
