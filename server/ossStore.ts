import { createRequire } from 'node:module';
import type OSS from 'ali-oss';

const require = createRequire(import.meta.url);

let OssCtor: typeof OSS | null = null;
let client: OSS | null = null;

function loadOss(): typeof OSS {
  if (OssCtor) return OssCtor;
  const mod = require('ali-oss') as typeof OSS | { default: typeof OSS };
  OssCtor = typeof mod === 'function' ? mod : mod.default;
  return OssCtor;
}

function getClient(): OSS {
  if (client) return client;
  const region = process.env.OSS_REGION || '';
  const endpoint = process.env.OSS_ENDPOINT || undefined;
  const bucket = process.env.OSS_BUCKET;
  const accessKeyId = process.env.OSS_ACCESS_KEY_ID;
  const accessKeySecret = process.env.OSS_ACCESS_KEY_SECRET;
  if (!bucket || !accessKeyId || !accessKeySecret) {
    throw new Error('OSS credentials not configured');
  }
  const Ctor = loadOss();
  client = new Ctor({
    region,
    endpoint,
    accessKeyId,
    accessKeySecret,
    bucket,
  });
  return client;
}

export async function uploadFile(localPath: string, key: string) {
  const c = getClient();
  return c.put(key, localPath);
}

export async function uploadBuffer(buffer: Buffer, key: string) {
  const c = getClient();
  return c.put(key, buffer);
}

export async function headObject(key: string) {
  const c = getClient();
  try {
    return await c.head(key);
  } catch (e) {
    return null;
  }
}

export async function signedUrl(key: string, expires = 3600) {
  const c = getClient();
  return c.signatureUrl(key, { expires });
}

export async function listObjects(prefix = '', maxKeys = 1000) {
  const c = getClient();
  const res = await c.list({ prefix, 'max-keys': maxKeys }, {});
  // res.objects is an array of { name, size, etag, type, lastModified }
  return res.objects || [];
}

export default {
  getClient,
  uploadFile,
  uploadBuffer,
  headObject,
  signedUrl,
  listObjects,
};
