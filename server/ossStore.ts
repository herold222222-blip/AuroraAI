import { createRequire } from 'node:module';
import type OSS from 'ali-oss';

const require = createRequire(import.meta.url);

let OssCtor: typeof OSS | null = null;
let client: OSS | null = null;

type ObjectCacheEntry = {
  expiresAt: number;
  value: { buffer: Buffer; contentType: string };
};
const objectBufferCache = new Map<string, ObjectCacheEntry>();
const OBJECT_BUFFER_TTL_MS = 30 * 60 * 1000;
const OBJECT_BUFFER_MAX = 128;

function env(name: string, aliName: string): string {
  return (process.env[name] || process.env[aliName] || '').trim();
}

export function ossConfig() {
  return {
    region: env('OSS_REGION', 'ALIYUN_OSS_REGION'),
    endpoint: env('OSS_ENDPOINT', 'ALIYUN_OSS_ENDPOINT') || undefined,
    bucket: env('OSS_BUCKET', 'ALIYUN_OSS_BUCKET'),
    accessKeyId: env('OSS_ACCESS_KEY_ID', 'ALIYUN_OSS_ACCESS_KEY_ID'),
    accessKeySecret: env('OSS_ACCESS_KEY_SECRET', 'ALIYUN_OSS_ACCESS_KEY_SECRET'),
  };
}

export function isOssConfigured(): boolean {
  const c = ossConfig();
  return Boolean(c.bucket && c.accessKeyId && c.accessKeySecret);
}

function loadOss(): typeof OSS {
  if (OssCtor) return OssCtor;
  const mod = require('ali-oss') as typeof OSS | { default: typeof OSS };
  OssCtor = typeof mod === 'function' ? mod : mod.default;
  return OssCtor;
}

function getClient(): OSS {
  if (client) return client;
  const cfg = ossConfig();
  if (!cfg.bucket || !cfg.accessKeyId || !cfg.accessKeySecret) {
    throw new Error('OSS credentials not configured');
  }
  const Ctor = loadOss();
  client = new Ctor({
    region: cfg.region,
    endpoint: cfg.endpoint,
    accessKeyId: cfg.accessKeyId,
    accessKeySecret: cfg.accessKeySecret,
    bucket: cfg.bucket,
    secure: true,
  });
  return client;
}

export async function uploadFile(localPath: string, key: string) {
  const c = getClient();
  return c.put(key, localPath);
}

export async function uploadBuffer(
  buffer: Buffer,
  key: string,
  mime?: string,
) {
  const c = getClient();
  return c.put(
    key,
    buffer,
    mime ? { headers: { 'Content-Type': mime } } : undefined,
  );
}

export async function headObject(key: string) {
  const c = getClient();
  try {
    return await c.head(key);
  } catch {
    return null;
  }
}

export async function signedUrl(key: string, expires = 3600) {
  const c = getClient();
  // 站点是 HTTPS 时，http 签名链会被浏览器混合内容拦截 → 图片空白
  return String(c.signatureUrl(key, { expires })).replace(/^http:\/\//i, 'https://');
}

export function publicObjectUrl(key: string): string {
  const cfg = ossConfig();
  const host = (cfg.endpoint || `${cfg.region}.aliyuncs.com`).replace(
    /^https?:\/\//,
    '',
  );
  const path = key
    .split('/')
    .filter(Boolean)
    .map((s) => encodeURIComponent(s))
    .join('/');
  return `https://${cfg.bucket}.${host}/${path}`;
}

export async function resolveObjectUrl(
  key: string,
  expires = 60 * 60 * 12,
): Promise<string> {
  try {
    return await signedUrl(key, expires);
  } catch (err) {
    console.warn('[oss] signedUrl failed, fallback public', key, err);
    return publicObjectUrl(key);
  }
}

export async function getObjectBuffer(
  key: string,
  opts?: { process?: string },
): Promise<{
  buffer: Buffer;
  contentType: string;
}> {
  const process = String(opts?.process || '').trim();
  const cacheKey = process ? `${key}::${process}` : key;
  const now = Date.now();
  const cached = objectBufferCache.get(cacheKey);
  if (cached && cached.expiresAt > now) {
    return cached.value;
  }
  if (cached) objectBufferCache.delete(cacheKey);

  const c = getClient();
  const r = await c.get(
    key,
    undefined,
    {
      timeout: 30000,
      ...(process ? { process } : {}),
    },
  );
  const content = r.content as Buffer | string | Uint8Array | ArrayBuffer | null | undefined;
  const buffer = Buffer.isBuffer(content)
    ? content
    : content instanceof Uint8Array
      ? Buffer.from(content)
      : content instanceof ArrayBuffer
        ? Buffer.from(content)
        : Buffer.from(content || '');
  const headers = (r.res?.headers ?? {}) as Record<string, unknown>;
  const rawType = headers['content-type'] ?? headers['Content-Type'];
  const headerType = typeof rawType === 'string' ? rawType : '';
  const contentType =
    headerType ||
    (process.includes('format,webp')
      ? 'image/webp'
      : key.endsWith('.png')
        ? 'image/png'
        : key.endsWith('.jpg') || key.endsWith('.jpeg')
          ? 'image/jpeg'
          : key.endsWith('.webp')
            ? 'image/webp'
            : 'application/octet-stream');
  const value = { buffer, contentType };
  objectBufferCache.set(cacheKey, {
    expiresAt: now + OBJECT_BUFFER_TTL_MS,
    value,
  });
  if (objectBufferCache.size > OBJECT_BUFFER_MAX) {
    const firstKey = objectBufferCache.keys().next().value;
    if (firstKey) objectBufferCache.delete(firstKey);
  }
  return value;
}

export async function listObjects(prefix = '', maxKeys = 1000) {
  const c = getClient();
  const res = await c.list({ prefix, 'max-keys': maxKeys }, {});
  return res.objects || [];
}

export async function deleteObject(key: string) {
  if (!isOssConfigured() || !key) return;
  objectBufferCache.delete(key);
  for (const cacheKey of [...objectBufferCache.keys()]) {
    if (cacheKey.startsWith(`${key}::`)) objectBufferCache.delete(cacheKey);
  }
  const c = getClient();
  try {
    await c.delete(key);
  } catch (err) {
    console.warn('[oss] deleteObject failed', key, err);
  }
}

export async function deletePrefix(prefix: string) {
  if (!isOssConfigured()) return;
  const objs = await listObjects(prefix, 1000);
  const names = objs.map((o) => o.name).filter(Boolean) as string[];
  if (!names.length) {
    // 精确 key 删除（无子对象时 list 可能为空）
    await deleteObject(prefix);
    return;
  }
  for (const name of names) {
    objectBufferCache.delete(name);
    for (const cacheKey of [...objectBufferCache.keys()]) {
      if (cacheKey.startsWith(`${name}::`)) objectBufferCache.delete(cacheKey);
    }
  }
  const c = getClient();
  await c.deleteMulti(names, { quiet: true });
}

export default {
  getClient,
  isOssConfigured,
  uploadFile,
  uploadBuffer,
  headObject,
  signedUrl,
  publicObjectUrl,
  resolveObjectUrl,
  getObjectBuffer,
  listObjects,
  deleteObject,
  deletePrefix,
};
