const fs = require('fs');
function loadEnv(path){
  if(!fs.existsSync(path)) return;
  const s = fs.readFileSync(path, 'utf8');
  s.split(/\n/).forEach(line=>{
    line = line.trim();
    if(!line || line.startsWith('#') || line.startsWith('//')) return;
    const eq = line.indexOf('=');
    if(eq < 0) return;
    const k = line.slice(0, eq).trim();
    let v = line.slice(eq+1).trim();
    process.env[k] = v;
  });
}
function clean(v){ if(typeof v !== 'string') return v; v = v.trim(); if((v.startsWith("'") && v.endsWith("'")) || (v.startsWith('"') && v.endsWith('"'))) v = v.slice(1, -1); return v.trim(); }
loadEnv('.env.local');
const keys = ['ALIYUN_OSS_BUCKET','ALIYUN_OSS_REGION','ALIYUN_OSS_ENDPOINT','ALIYUN_OSS_ACCESS_KEY_ID','ALIYUN_OSS_ACCESS_KEY_SECRET'];
for(const k of keys){
  const raw = process.env[k];
  if(raw == null){
    console.log(`${k} not set`);
  } else {
    const c = clean(raw);
    process.env[k] = c;
    console.log(`${k} raw -> |${raw}|`);
    console.log(`${k} cleaned -> |${c}| len=${c.length} codepoints=${[...c].map(ch=>ch.charCodeAt(0))}`);
  }
}
(async ()=>{
  try{
    const OSS = require('ali-oss');
    const bucket = process.env.ALIYUN_OSS_BUCKET;
    const id = process.env.ALIYUN_OSS_ACCESS_KEY_ID;
    const secret = process.env.ALIYUN_OSS_ACCESS_KEY_SECRET;
    const region = process.env.ALIYUN_OSS_REGION;
    const endpoint = process.env.ALIYUN_OSS_ENDPOINT;
    if(!bucket || !id || !secret){
      console.error('missing required ALIYUN_OSS_* envs'); process.exit(3);
    }
    console.log('\nTRY: client with no endpoint (let SDK pick by region)');
    try{
      const client1 = new OSS({ region, accessKeyId: id, accessKeySecret: secret, bucket });
      const key1 = `diag-no-endpoint-${Date.now()}.txt`;
      await client1.put(key1, Buffer.from('ok'));
      console.log('put ok (no endpoint) ->', key1);
      await client1.delete(key1);
      console.log('delete ok (no endpoint)');
    }catch(e){ console.error('no-endpoint error:', e && e.message ? e.message : e); }

    console.log('\nTRY: client with explicit endpoint');
    try{
      const client2 = new OSS({ region, accessKeyId: id, accessKeySecret: secret, bucket, endpoint });
      const key2 = `diag-endpoint-${Date.now()}.txt`;
      await client2.put(key2, Buffer.from('ok'));
      console.log('put ok (endpoint) ->', key2);
      await client2.delete(key2);
      console.log('delete ok (endpoint)');
    }catch(e){ console.error('endpoint error:', e && e.message ? e.message : e); }
  }catch(e){ console.error('OSS require/init error', e && e.message ? e.message : e); }
  process.exit(0);
})();
