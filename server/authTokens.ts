import { createHmac, timingSafeEqual } from 'crypto';
import type { UserRole } from './authTypes';

export interface AuthTokenPayload {
  sub: string;
  username: string;
  role: UserRole;
  exp: number;
}

function secret(): string {
  return (
    process.env.AUTH_JWT_SECRET ||
    process.env.GEMINI_API_KEY ||
    'aurora-dev-secret-change-me'
  );
}

function b64url(input: string | Buffer): string {
  return Buffer.from(input)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function fromB64url(input: string): string {
  const pad = input.length % 4 === 0 ? '' : '='.repeat(4 - (input.length % 4));
  const s = input.replace(/-/g, '+').replace(/_/g, '/') + pad;
  return Buffer.from(s, 'base64').toString('utf8');
}

export function signToken(
  payload: Omit<AuthTokenPayload, 'exp'>,
  ttlSec = 60 * 60 * 24 * 14,
): string {
  const body: AuthTokenPayload = {
    ...payload,
    exp: Math.floor(Date.now() / 1000) + ttlSec,
  };
  const data = b64url(JSON.stringify(body));
  const sig = createHmac('sha256', secret()).update(data).digest('base64url');
  return `${data}.${sig}`;
}

export function verifyToken(token: string | null | undefined): AuthTokenPayload | null {
  if (!token) return null;
  const raw = token.startsWith('Bearer ') ? token.slice(7).trim() : token.trim();
  const [data, sig] = raw.split('.');
  if (!data || !sig) return null;
  const expect = createHmac('sha256', secret()).update(data).digest('base64url');
  try {
    const a = Buffer.from(sig);
    const b = Buffer.from(expect);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  } catch {
    return null;
  }
  try {
    const payload = JSON.parse(fromB64url(data)) as AuthTokenPayload;
    if (!payload?.sub || !payload.username || !payload.exp) return null;
    if (payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

export function clientIp(headers: Record<string, string | string[] | undefined>): string {
  const xf = headers['x-forwarded-for'];
  if (typeof xf === 'string' && xf.trim()) return xf.split(',')[0].trim();
  if (Array.isArray(xf) && xf[0]) return xf[0].split(',')[0].trim();
  const real = headers['x-real-ip'];
  if (typeof real === 'string' && real.trim()) return real.trim();
  return '';
}
