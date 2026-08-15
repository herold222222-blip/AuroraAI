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
    if((v.startsWith("'") && v.endsWith("'")) || (v.startsWith('"') && v.endsWith('"'))) v = v.slice(1, -1);
    process.env[k] = v;
  });
}
loadEnv('.env.local');
function clean(v){ if(typeof v !== 'string') return v; return v.trim(); }
const redisUrl = clean(process.env.REDIS_URL);
console.log('REDIS_URL ->', redisUrl ? redisUrl.replace(/:[^@]+@/,'://:******@') : '(not set)');
(async ()=>{
  try{
    if(!redisUrl){ console.error('REDIS_URL not set'); process.exit(3); }
    const IORedis = require('ioredis');
    const r = new IORedis(redisUrl, { maxRetriesPerRequest: 2 });
    console.log('PING ->', await r.ping());
    await r.set('copilot_test','ok','EX',30); console.log('SET ok');
    console.log('GET ->', await r.get('copilot_test'));
    console.log('SETNX ->', await r.set('copilot_atomic_test','1','NX','EX',10));
    await r.del('copilot_test','copilot_atomic_test');
    await r.quit();
    console.log('Redis tests passed');
    process.exit(0);
  }catch(e){
    console.error('Redis error:', e && e.message ? e.message : e); process.exit(2);
  }
})();
