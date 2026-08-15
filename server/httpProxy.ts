import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';

function envProxy(): string {
  return (
    process.env.HTTPS_PROXY ||
    process.env.https_proxy ||
    process.env.HTTP_PROXY ||
    process.env.http_proxy ||
    process.env.ALL_PROXY ||
    process.env.all_proxy ||
    ''
  ).trim();
}

/** macOS 系统代理（Clash Verge 等开了「系统代理」时，浏览器能通、Node 默认不能） */
function macosSystemHttpProxy(): string {
  if (process.platform !== 'darwin') return '';
  try {
    const out = execSync('scutil --proxy', { encoding: 'utf8', timeout: 2000 });
    const httpsOn = /HTTPSEnable\s*:\s*1/.test(out);
    const httpOn = /HTTPEnable\s*:\s*1/.test(out);
    if (!httpsOn && !httpOn) return '';
    const host = (
      out.match(/HTTPSProxy\s*:\s*(\S+)/) || out.match(/HTTPProxy\s*:\s*(\S+)/)
    )?.[1];
    const port = (
      out.match(/HTTPSPort\s*:\s*(\d+)/) || out.match(/HTTPPort\s*:\s*(\d+)/)
    )?.[1];
    if (host && port) return `http://${host}:${port}`;
  } catch {
    /* ignore */
  }
  return '';
}

function ensureNoProxyLocalhost() {
  const extra = ['localhost', '127.0.0.1', '::1'];
  const current = (process.env.NO_PROXY || process.env.no_proxy || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const merged = [...new Set([...current, ...extra])];
  process.env.NO_PROXY = merged.join(',');
  process.env.no_proxy = process.env.NO_PROXY;
}

/** 若环境里装了 undici 再挂代理；没装也不影响 tsc / 打包。 */
function applyUndiciDispatcher() {
  try {
    const require = createRequire(import.meta.url);
    const undici = require('undici') as {
      setGlobalDispatcher?: (dispatcher: unknown) => void;
      EnvHttpProxyAgent?: new () => unknown;
    };
    if (undici.setGlobalDispatcher && undici.EnvHttpProxyAgent) {
      undici.setGlobalDispatcher(new undici.EnvHttpProxyAgent());
    }
  } catch {
    /* 服务器未安装 undici 时仅靠 NODE_USE_ENV_PROXY + HTTPS_PROXY */
  }
}

/** 让 fetch / @google/genai 走本机 Clash 等代理，避免直连 Google 超时。 */
export function applyHttpProxy() {
  process.env.NODE_USE_ENV_PROXY ??= '1';
  ensureNoProxyLocalhost();

  const proxy = envProxy() || macosSystemHttpProxy();
  if (!proxy) {
    console.warn(
      '[httpProxy] 未检测到 HTTP 代理。本机直连 Gemini 可能超时；可在 .env.local 设置 HTTPS_PROXY=http://127.0.0.1:7897',
    );
    return;
  }

  process.env.HTTPS_PROXY = proxy;
  process.env.HTTP_PROXY = proxy;
  process.env.https_proxy = proxy;
  process.env.http_proxy = proxy;

  applyUndiciDispatcher();
  console.log('[httpProxy] fetch 已走代理', proxy);
}
