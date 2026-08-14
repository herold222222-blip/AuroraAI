import OSS from 'ali-oss';

let client: OSS | null = null;

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
  client = new OSS({
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
  const res = await c.list({ prefix, 'max-keys': maxKeys });
  // res.objects is an array of { name, size, etag, type, lastModified }
  return res.objects || [];
}

export default { getClient, uploadFile, uploadBuffer, headObject, signedUrl };
