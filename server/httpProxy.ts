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
  const extra = [
    'localhost',
    '127.0.0.1',
    '::1',
    // 微信支付 API / 回调相关主机不要走本机 Clash，否则线上查单/拉证书会失败
    'api.mch.weixin.qq.com',
    'www.gnoverse.cn',
  ];
  const current = (process.env.NO_PROXY || process.env.no_proxy || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const merged = [...new Set([...current, ...extra])];
  process.env.NO_PROXY = merged.join(',');
  process.env.no_proxy = process.env.NO_PROXY;
}

function proxyExplicitlyEnabled(): boolean {
  const v = String(process.env.NODE_USE_ENV_PROXY || '')
    .trim()
    .toLowerCase();
  return v === '1' || v === 'true' || v === 'yes';
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

/**
 * 仅本机联调 Gemini 时启用代理。
 * 生产机（systemd）不要设 NODE_USE_ENV_PROXY，也不要留 HTTPS_PROXY=127.0.0.1:7897，
 * 否则微信查单/平台证书/回调验签都会挂，表现为「付了款页面不更新」。
 */
export function applyHttpProxy() {
  ensureNoProxyLocalhost();

  if (!proxyExplicitlyEnabled()) {
    return;
  }

  const proxy = envProxy() || macosSystemHttpProxy();
  if (!proxy) {
    console.warn(
      '[httpProxy] NODE_USE_ENV_PROXY=1 但未检测到代理。可在 .env.local 设置 HTTPS_PROXY=http://127.0.0.1:7897',
    );
    return;
  }

  // 拒绝把不存在的本机 Clash 端口带到生产
  if (/127\.0\.0\.1:7897|localhost:7897/i.test(proxy) && process.platform !== 'darwin') {
    console.warn(
      '[httpProxy] 忽略无效本机代理',
      proxy,
      '（生产请删除 HTTPS_PROXY / 不要设 NODE_USE_ENV_PROXY）',
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
