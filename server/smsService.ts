/**
 * SMS OTP for register / change-phone via Aliyun Dysmsapi.
 */
import crypto from 'node:crypto';
import Redis from 'ioredis';

export type SmsPurpose = 'register' | 'change_phone';

const PHONE_RE = /^1\d{10}$/;
const CODE_TTL_MS = 5 * 60 * 1000;
const COOLDOWN_MS = 60 * 1000;
const MAX_ATTEMPTS = 5;

interface CodeEntry {
  code: string;
  purpose: SmsPurpose;
  expiresAt: number;
  sentAt: number;
  attempts: number;
}

let redis: Redis | null = null;
if (process.env.REDIS_URL) {
  try {
    redis = new Redis(process.env.REDIS_URL);
  } catch (e) {
    // ignore and fallback to memory
    redis = null;
  }
}

const codes = new Map<string, CodeEntry>();

function key(phone: string, purpose: SmsPurpose) {
  return `${purpose}:${phone}`;
}

export function isValidCnPhone(phone: string): boolean {
  return PHONE_RE.test(phone.trim());
}

function aliyunConfigured(): boolean {
  return Boolean(
    process.env.ALIYUN_SMS_ACCESS_KEY_ID &&
      process.env.ALIYUN_SMS_ACCESS_KEY_SECRET &&
      process.env.ALIYUN_SMS_SIGN_NAME &&
      process.env.ALIYUN_SMS_TEMPLATE_CODE,
  );
}

function percentEncode(s: string): string {
  return encodeURIComponent(s)
    .replace(/!/g, '%21')
    .replace(/'/g, '%27')
    .replace(/\(/g, '%28')
    .replace(/\)/g, '%29')
    .replace(/\*/g, '%2A');
}

/** Aliyun RPC signature (HMAC-SHA1) for Dysmsapi SendSms. */
async function sendViaAliyun(phone: string, code: string): Promise<void> {
  const AccessKeyId = process.env.ALIYUN_SMS_ACCESS_KEY_ID!;
  const AccessKeySecret = process.env.ALIYUN_SMS_ACCESS_KEY_SECRET!;
  const SignName = process.env.ALIYUN_SMS_SIGN_NAME!;
  const TemplateCode = process.env.ALIYUN_SMS_TEMPLATE_CODE!;
  const templateParam =
    process.env.ALIYUN_SMS_TEMPLATE_PARAM || `{"code":"${code}"}`;

  const params: Record<string, string> = {
    AccessKeyId,
    Action: 'SendSms',
    Format: 'JSON',
    PhoneNumbers: phone,
    RegionId: process.env.ALIYUN_SMS_REGION_ID || 'cn-hangzhou',
    SignName,
    SignatureMethod: 'HMAC-SHA1',
    SignatureNonce: crypto.randomUUID(),
    SignatureVersion: '1.0',
    TemplateCode,
    TemplateParam: templateParam.includes('${code}')
      ? templateParam.replace(/\$\{code\}/g, code)
      : templateParam.includes('"code"')
        ? templateParam
        : JSON.stringify({ code }),
    Timestamp: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
    Version: '2017-05-25',
  };

  const sorted = Object.keys(params).sort();
  const canonical = sorted
    .map((k) => `${percentEncode(k)}=${percentEncode(params[k])}`)
    .join('&');
  const stringToSign = `GET&${percentEncode('/')}&${percentEncode(canonical)}`;
  const signature = crypto
    .createHmac('sha1', `${AccessKeySecret}&`)
    .update(stringToSign)
    .digest('base64');

  const url = `https://dysmsapi.aliyuncs.com/?${canonical}&Signature=${percentEncode(signature)}`;
  const res = await fetch(url);
  const data = (await res.json().catch(() => ({}))) as {
    Code?: string;
    Message?: string;
  };
  if (!res.ok || (data.Code && data.Code !== 'OK')) {
    throw new Error(data.Message || `阿里云短信发送失败 (${data.Code || res.status})`);
  }
}

export type SendSmsResult =
  | {
      ok: true;
      cooldownSec: number;
      expiresInSec: number;
      provider: 'aliyun';
    }
  | { ok: false; error: string; cooldownSec?: number };

export async function sendSmsCode(
  phoneRaw: string,
  purpose: SmsPurpose,
): Promise<SendSmsResult> {
  const phone = phoneRaw.trim();
  if (!isValidCnPhone(phone)) {
    return { ok: false, error: '请输入有效的 11 位手机号码' };
  }
  if (!aliyunConfigured()) {
    return { ok: false, error: '短信服务未配置，请联系管理员' };
  }

  const k = key(phone, purpose);
  const now = Date.now();

  // Check cooldown (Redis preferred)
  if (redis) {
    try {
      const raw = await redis.get(k);
      if (raw) {
        const existing = JSON.parse(raw) as CodeEntry;
        if (now - existing.sentAt < COOLDOWN_MS) {
          const left = Math.ceil((COOLDOWN_MS - (now - existing.sentAt)) / 1000);
          return { ok: false, error: `请 ${left} 秒后再获取验证码`, cooldownSec: left };
        }
      }
    } catch (e) {
      // ignore and fallback to memory checks
    }
  } else {
    const existing = codes.get(k);
    if (existing && now - existing.sentAt < COOLDOWN_MS) {
      const left = Math.ceil((COOLDOWN_MS - (now - existing.sentAt)) / 1000);
      return {
        ok: false,
        error: `请 ${left} 秒后再获取验证码`,
        cooldownSec: left,
      };
    }
  }

  const code = String(crypto.randomInt(100000, 1000000));
  const entry: CodeEntry = {
    code,
    purpose,
    expiresAt: now + CODE_TTL_MS,
    sentAt: now,
    attempts: 0,
  };

  try {
    await sendViaAliyun(phone, code);
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : '短信发送失败',
    };
  }

  // Persist entry (Redis preferred)
  if (redis) {
    try {
      await redis.set(k, JSON.stringify(entry), 'PX', CODE_TTL_MS);
    } catch (e) {
      // fallback to in-memory
      codes.set(k, entry);
    }
  } else {
    codes.set(k, entry);
  }
  return {
    ok: true,
    cooldownSec: Math.floor(COOLDOWN_MS / 1000),
    expiresInSec: Math.floor(CODE_TTL_MS / 1000),
    provider: 'aliyun',
  };
}

export async function consumeSmsCode(
  phoneRaw: string,
  purpose: SmsPurpose,
  codeRaw: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const phone = phoneRaw.trim();
  const code = (codeRaw || '').trim();
  if (!isValidCnPhone(phone)) {
    return { ok: false, error: '请输入有效的 11 位手机号码' };
  }
  if (!/^\d{4,8}$/.test(code)) {
    return { ok: false, error: '请输入短信验证码' };
  }

  const k = key(phone, purpose);
  // Redis-backed flow
  if (redis) {
    // best-effort atomic-like handling via GET/SET
    try {
      const raw = await redis.get(k);
      if (!raw) return { ok: false, error: '请先获取短信验证码' };
      const entry = JSON.parse(raw) as CodeEntry;
      const now = Date.now();
      if (now > entry.expiresAt) {
        await redis.del(k);
        return { ok: false, error: '验证码已过期，请重新获取' };
      }
      if (entry.attempts >= MAX_ATTEMPTS) {
        await redis.del(k);
        return { ok: false, error: '验证码错误次数过多，请重新获取' };
      }
      if (entry.code !== code) {
        entry.attempts = (entry.attempts || 0) + 1;
        // update with remaining TTL
        const ttl = await redis.pttl(k);
        if (ttl > 0) {
          await redis.set(k, JSON.stringify(entry), 'PX', ttl);
        } else {
          await redis.del(k);
        }
        return { ok: false, error: '短信验证码不正确' };
      }
      // correct code: delete key and return success
      await redis.del(k);
      return { ok: true };
    } catch (e) {
      // fallback to memory
    }
  }

  const entry = codes.get(k);
  if (!entry) {
    return { ok: false, error: '请先获取短信验证码' };
  }
  if (Date.now() > entry.expiresAt) {
    codes.delete(k);
    return { ok: false, error: '验证码已过期，请重新获取' };
  }
  if (entry.attempts >= MAX_ATTEMPTS) {
    codes.delete(k);
    return { ok: false, error: '验证码错误次数过多，请重新获取' };
  }
  if (entry.code !== code) {
    entry.attempts += 1;
    codes.set(k, entry);
    return { ok: false, error: '短信验证码不正确' };
  }
  codes.delete(k);
  return { ok: true };
}
