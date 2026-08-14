#!/usr/bin/env node
// Recursively upload a local directory to OSS using ali-oss

import fs from 'fs';
import path from 'path';
import OSS from 'ali-oss';

const dir = process.argv[2] || process.env.LOCAL_ASSETS_DIR || 'public';
const bucket = process.env.OSS_BUCKET;
const region = process.env.OSS_REGION || '';
const endpoint = process.env.OSS_ENDPOINT || undefined;
const accessKeyId = process.env.OSS_ACCESS_KEY_ID;
const accessKeySecret = process.env.OSS_ACCESS_KEY_SECRET;
const prefix = process.env.OSS_UPLOAD_PREFIX || '';

if (!bucket || !accessKeyId || !accessKeySecret) {
  console.error('OSS env not configured');
  process.exit(2);
}

const client = new OSS({ region, endpoint, accessKeyId, accessKeySecret, bucket });

async function uploadDir(localDir, remotePrefix = '') {
  const items = fs.readdirSync(localDir, { withFileTypes: true });
  for (const it of items) {
    const full = path.join(localDir, it.name);
    const key = (remotePrefix ? `${remotePrefix}/${it.name}` : it.name).replace(/\\\\/g, '/');
    if (it.isDirectory()) {
      await uploadDir(full, key);
    } else if (it.isFile()) {
      try {
        console.log('upload', full, '->', key);
        await client.put(key, full);
      } catch (e) {
        console.error('upload fail', full, e.message || e);
      }
    }
  }
}

(async () => {
  try {
    const abs = path.resolve(dir);
    if (!fs.existsSync(abs)) {
      console.error('local dir not found', abs);
      process.exit(2);
    }
    const prefixToUse = prefix ? prefix.replace(/\\/g, '/') : '';
    await uploadDir(abs, prefixToUse);
    console.log('done');
  } catch (e) {
    console.error(e);
    process.exit(1);
  }
})();
