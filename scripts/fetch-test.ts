import { loadServerEnv } from '../server/loadEnv';
loadServerEnv();

(async () => {
  try {
    console.log('Node fetch test, NODE_TLS_REJECT_UNAUTHORIZED=', process.env.NODE_TLS_REJECT_UNAUTHORIZED);
    const res = await fetch('https://genai.googleapis.com/', { method: 'GET' });
    console.log('status', res.status);
    const text = await res.text();
    console.log('body snippet:', text.slice(0, 200));
  } catch (err) {
    console.error('fetch error:', err && (err.stack || err));
    process.exit(1);
  }
})();
