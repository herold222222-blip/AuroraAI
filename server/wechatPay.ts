import { createPrivateKey, createSign, createDecipheriv, createVerify, X509Certificate } from 'crypto';
import { readFileSync } from 'fs';

const WX_API = 'https://api.mch.weixin.qq.com';

export type WechatPayConfig = {
  appid: string;
  mchid: string;
  serialNo: string;
  privateKeyPem: string;
  apiV3Key: string;
  notifyUrl: string;
};

let cachedPlatformCerts: Map<string, string> | null = null;
let platformCertsFetchedAt = 0;

function env(name: string): string {
  return String(process.env[name] || '').trim();
}

function loadPrivateKeyPem(): string {
  let pem = env('WECHAT_PAY_PRIVATE_KEY');
  const path = env('WECHAT_PAY_PRIVATE_KEY_PATH');
  if (!pem && path) {
    pem = readFileSync(path, 'utf8');
  }
  pem = pem.replace(/\\n/g, '\n').trim();
  // dotenv 可能带首尾引号
  if (
    (pem.startsWith('"') && pem.endsWith('"')) ||
    (pem.startsWith("'") && pem.endsWith("'"))
  ) {
    pem = pem.slice(1, -1).replace(/\\n/g, '\n').trim();
  }
  return pem;
}

export function getWechatPayConfig(): WechatPayConfig | null {
  const appid = env('WECHAT_PAY_APPID');
  const mchid = env('WECHAT_PAY_MCHID');
  const serialNo = env('WECHAT_PAY_SERIAL_NO');
  const apiV3Key = env('WECHAT_PAY_API_V3_KEY');
  const notifyUrl = env('WECHAT_PAY_NOTIFY_URL');
  const privateKeyPem = loadPrivateKeyPem();
  if (!appid || !mchid || !serialNo || !apiV3Key || !notifyUrl || !privateKeyPem) {
    return null;
  }
  return { appid, mchid, serialNo, privateKeyPem, apiV3Key, notifyUrl };
}

export function assertPublicHttpsNotifyUrl(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error('微信支付回调地址无效');
  }
  if (parsed.protocol !== 'https:') {
    throw new Error('回调地址必须是公网可访问的 HTTPS 域名');
  }
  const host = parsed.hostname.toLowerCase();
  if (
    host === 'localhost' ||
    host === '127.0.0.1' ||
    host === '0.0.0.0' ||
    host.endsWith('.local')
  ) {
    throw new Error('回调地址不能使用 localhost，请配置公网 HTTPS 域名');
  }
}

function nonceStr(len = 32): string {
  const chars = 'ABCDEFGHJKMNPQRSTWXYZabcdefhijkmnprstwxyz2345678';
  let s = '';
  for (let i = 0; i < len; i++) {
    s += chars[Math.floor(Math.random() * chars.length)];
  }
  return s;
}

function signMessage(privateKeyPem: string, message: string): string {
  const key = createPrivateKey(privateKeyPem);
  const sign = createSign('RSA-SHA256');
  sign.update(message);
  sign.end();
  return sign.sign(key, 'base64');
}

function authorization(
  cfg: WechatPayConfig,
  method: string,
  urlPath: string,
  body: string,
): string {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const nonce = nonceStr();
  const message = `${method}\n${urlPath}\n${timestamp}\n${nonce}\n${body}\n`;
  const signature = signMessage(cfg.privateKeyPem, message);
  return (
    `WECHATPAY2-SHA256-RSA2048 mchid="${cfg.mchid}",` +
    `nonce_str="${nonce}",signature="${signature}",` +
    `timestamp="${timestamp}",serial_no="${cfg.serialNo}"`
  );
}

async function wxRequest<T>(
  cfg: WechatPayConfig,
  method: 'GET' | 'POST',
  urlPath: string,
  bodyObj?: unknown,
): Promise<T> {
  const body = bodyObj == null ? '' : JSON.stringify(bodyObj);
  const res = await fetch(`${WX_API}${urlPath}`, {
    method,
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Authorization: authorization(cfg, method, urlPath, body),
    },
    body: method === 'GET' ? undefined : body,
  });
  const text = await res.text();
  let data: Record<string, unknown> = {};
  try {
    data = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    data = { message: text };
  }
  if (!res.ok) {
    const msg =
      (typeof data.message === 'string' && data.message) ||
      (typeof data.code === 'string' && data.code) ||
      `微信支付请求失败 (${res.status})`;
    throw new Error(msg);
  }
  return data as T;
}

/** RFC3339 with +08:00 for WeChat time_expire */
export function formatWxExpire(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  // Use Asia/Shanghai offset (+08:00)
  const utc = d.getTime() + d.getTimezoneOffset() * 60_000;
  const cn = new Date(utc + 8 * 3600_000);
  const y = cn.getUTCFullYear();
  const m = pad(cn.getUTCMonth() + 1);
  const day = pad(cn.getUTCDate());
  const h = pad(cn.getUTCHours());
  const min = pad(cn.getUTCMinutes());
  const s = pad(cn.getUTCSeconds());
  return `${y}-${m}-${day}T${h}:${min}:${s}+08:00`;
}

export async function createNativeOrder(input: {
  outTradeNo: string;
  description: string;
  amountFen: number;
  expireAt: number;
  attach?: string;
}): Promise<{ codeUrl: string }> {
  const cfg = getWechatPayConfig();
  if (!cfg) throw new Error('微信支付未配置，请联系管理员');
  assertPublicHttpsNotifyUrl(cfg.notifyUrl);
  if (!Number.isInteger(input.amountFen) || input.amountFen < 1) {
    throw new Error('支付金额无效');
  }
  const data = await wxRequest<{ code_url?: string }>(
    cfg,
    'POST',
    '/v3/pay/transactions/native',
    {
      appid: cfg.appid,
      mchid: cfg.mchid,
      description: input.description.slice(0, 127),
      out_trade_no: input.outTradeNo,
      time_expire: formatWxExpire(input.expireAt),
      notify_url: cfg.notifyUrl,
      attach: (input.attach || '').slice(0, 128),
      amount: { total: input.amountFen, currency: 'CNY' },
    },
  );
  if (!data.code_url) throw new Error('微信未返回支付二维码');
  return { codeUrl: data.code_url };
}

export type WxTradeState =
  | 'SUCCESS'
  | 'REFUND'
  | 'NOTPAY'
  | 'CLOSED'
  | 'REVOKED'
  | 'USERPAYING'
  | 'PAYERROR'
  | string;

export type WxQueryResult = {
  tradeState: WxTradeState;
  transactionId?: string;
  amountTotal?: number;
  successTime?: string;
  payerOpenid?: string;
};

export async function queryByOutTradeNo(
  outTradeNo: string,
): Promise<WxQueryResult> {
  const cfg = getWechatPayConfig();
  if (!cfg) throw new Error('微信支付未配置，请联系管理员');
  const path = `/v3/pay/transactions/out-trade-no/${encodeURIComponent(outTradeNo)}?mchid=${encodeURIComponent(cfg.mchid)}`;
  const data = await wxRequest<{
    trade_state?: string;
    transaction_id?: string;
    amount?: { total?: number };
    success_time?: string;
    payer?: { openid?: string };
  }>(cfg, 'GET', path);
  return {
    tradeState: (data.trade_state || 'NOTPAY') as WxTradeState,
    transactionId: data.transaction_id,
    amountTotal: data.amount?.total,
    successTime: data.success_time,
    payerOpenid: data.payer?.openid,
  };
}

export async function closeOutTradeNo(outTradeNo: string): Promise<void> {
  const cfg = getWechatPayConfig();
  if (!cfg) return;
  try {
    await wxRequest(
      cfg,
      'POST',
      `/v3/pay/transactions/out-trade-no/${encodeURIComponent(outTradeNo)}/close`,
      { mchid: cfg.mchid },
    );
  } catch {
    // 关单失败不阻断重新下单（可能已关/已付）
  }
}

function decryptAesGcm(
  apiV3Key: string,
  nonce: string,
  ciphertext: string,
  associatedData: string,
): string {
  const key = Buffer.from(apiV3Key, 'utf8');
  const buf = Buffer.from(ciphertext, 'base64');
  const authTag = buf.subarray(buf.length - 16);
  const data = buf.subarray(0, buf.length - 16);
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(nonce, 'utf8'));
  decipher.setAuthTag(authTag);
  if (associatedData) {
    decipher.setAAD(Buffer.from(associatedData, 'utf8'));
  }
  const decoded = Buffer.concat([decipher.update(data), decipher.final()]);
  return decoded.toString('utf8');
}

async function fetchPlatformCerts(cfg: WechatPayConfig): Promise<Map<string, string>> {
  const now = Date.now();
  if (cachedPlatformCerts && now - platformCertsFetchedAt < 12 * 3600_000) {
    return cachedPlatformCerts;
  }
  const data = await wxRequest<{
    data?: Array<{
      serial_no?: string;
      encrypt_certificate?: {
        algorithm?: string;
        nonce?: string;
        associated_data?: string;
        ciphertext?: string;
      };
    }>;
  }>(cfg, 'GET', '/v3/certificates');
  const map = new Map<string, string>();
  for (const item of data.data || []) {
    const enc = item.encrypt_certificate;
    if (!item.serial_no || !enc?.nonce || !enc.ciphertext) continue;
    const pem = decryptAesGcm(
      cfg.apiV3Key,
      enc.nonce,
      enc.ciphertext,
      enc.associated_data || 'certificate',
    );
    map.set(item.serial_no, pem);
  }
  if (map.size === 0) throw new Error('无法获取微信支付平台证书');
  cachedPlatformCerts = map;
  platformCertsFetchedAt = now;
  return map;
}

export async function verifyWechatNotifySignature(headers: {
  timestamp?: string;
  nonce?: string;
  signature?: string;
  serial?: string;
}, body: string): Promise<boolean> {
  const cfg = getWechatPayConfig();
  if (!cfg) return false;
  const timestamp = headers.timestamp || '';
  const nonce = headers.nonce || '';
  const signature = headers.signature || '';
  const serial = headers.serial || '';
  if (!timestamp || !nonce || !signature || !serial) return false;
  const certs = await fetchPlatformCerts(cfg);
  let pem = certs.get(serial);
  if (!pem) {
    cachedPlatformCerts = null;
    const refreshed = await fetchPlatformCerts(cfg);
    pem = refreshed.get(serial);
  }
  if (!pem) return false;
  const message = `${timestamp}\n${nonce}\n${body}\n`;
  const verify = createVerify('RSA-SHA256');
  verify.update(message);
  verify.end();
  // Prefer public key from X509
  try {
    const cert = new X509Certificate(pem);
    return verify.verify(cert.publicKey, signature, 'base64');
  } catch {
    return verify.verify(pem, signature, 'base64');
  }
}

export type WxNotifyResource = {
  outTradeNo: string;
  transactionId: string;
  tradeState: string;
  amountTotal: number;
  successTime?: string;
  payerOpenid?: string;
};

export function decryptNotifyResource(body: {
  resource?: {
    algorithm?: string;
    ciphertext?: string;
    nonce?: string;
    associated_data?: string;
  };
}): WxNotifyResource {
  const cfg = getWechatPayConfig();
  if (!cfg) throw new Error('微信支付未配置');
  const resource = body.resource;
  if (!resource?.ciphertext || !resource.nonce) {
    throw new Error('回调数据缺少加密资源');
  }
  const plain = decryptAesGcm(
    cfg.apiV3Key,
    resource.nonce,
    resource.ciphertext,
    resource.associated_data || '',
  );
  const data = JSON.parse(plain) as {
    out_trade_no?: string;
    transaction_id?: string;
    trade_state?: string;
    amount?: { total?: number };
    success_time?: string;
    payer?: { openid?: string };
  };
  if (!data.out_trade_no || !data.transaction_id) {
    throw new Error('回调订单信息不完整');
  }
  return {
    outTradeNo: data.out_trade_no,
    transactionId: data.transaction_id,
    tradeState: data.trade_state || '',
    amountTotal: Number(data.amount?.total) || 0,
    successTime: data.success_time,
    payerOpenid: data.payer?.openid,
  };
}
