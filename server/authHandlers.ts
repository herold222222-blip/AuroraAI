import {
  ADMIN_DELETE_SECURITY_CODE,
  DEFAULT_AVATARS,
  toPublicUser,
  type PublicUser,
} from './authTypes';
import { signToken, verifyToken, clientIp } from './authTokens';
import { lookupRegion } from './ipRegion';
import {
  deleteApi,
  listPublicApis,
  toPublicApi,
  updateApi,
} from './apiStore';
import { loadDocs, saveDocs } from './docStore';
import {
  adjustExtraCredits,
  assertUsageAvailable,
  consumeUsage,
  createUser,
  deleteDonationById,
  deleteUserById,
  findById,
  findByPhone,
  findByUsername,
  listDonationMessages,
  listUsers,
  QuotaExceededError,
  updateUser,
  verifyPassword,
  ensureSeedAdmin,
  type UserPatch,
} from './userStore';
import {
  consumeSmsCode,
  sendSmsCode,
  type SmsPurpose,
} from './smsService';

export type AuthResult = {
  status: number;
  body: Record<string, unknown>;
};

function ok(body: Record<string, unknown>, status = 200): AuthResult {
  return { status, body };
}

function fail(error: string, status = 400): AuthResult {
  return { status, body: { error } };
}

function authFromHeader(
  headers: Record<string, string | string[] | undefined>,
) {
  const h = headers.authorization ?? headers.Authorization;
  const token = Array.isArray(h) ? h[0] : h;
  return verifyToken(token);
}

async function resolveIpRegion(
  headers: Record<string, string | string[] | undefined>,
) {
  const ip = clientIp(headers);
  const region = ip ? await lookupRegion(ip) : '';
  return { ip, region };
}

export async function handleSendSms(
  body: { phone?: string; purpose?: string },
  headers: Record<string, string | string[] | undefined>,
): Promise<AuthResult> {
  const purpose = (body.purpose || '').trim() as SmsPurpose;
  if (purpose !== 'register' && purpose !== 'change_phone') {
    return fail('无效的短信用途');
  }
  const phone = (body.phone || '').trim();
  if (purpose === 'change_phone') {
    const payload = authFromHeader(headers);
    if (!payload) return fail('未登录或登录已过期', 401);
    const taken = await findByPhone(phone);
    if (taken && taken.id !== payload.sub) {
      return fail('该手机号码已经注册');
    }
  } else if (purpose === 'register') {
    if (await findByPhone(phone)) {
      return fail('该手机号码已经注册');
    }
  }
  const result = await sendSmsCode(phone, purpose);
  if (!result.ok) {
    return fail(result.error, result.cooldownSec ? 429 : 400);
  }
  return ok({
    cooldownSec: result.cooldownSec,
    expiresInSec: result.expiresInSec,
    provider: result.provider,
  });
}

export async function handleRegister(
  body: {
    username?: string;
    password?: string;
    phone?: string;
    nickname?: string;
    avatar?: string;
    smsCode?: string;
  },
  headers: Record<string, string | string[] | undefined>,
): Promise<AuthResult> {
  try {
    await ensureSeedAdmin();
    const username = (body.username || '').trim();
    const phone = (body.phone || '').trim();
    // Reject duplicates before consuming the SMS code.
    if (username && (await findByUsername(username))) {
      return fail('该用户名重复，请更换其他用户名');
    }
    if (phone && (await findByPhone(phone))) {
      return fail('该手机号码已经注册');
    }
    const verified = await consumeSmsCode(phone, 'register', body.smsCode || '');
    if (!verified.ok) return fail(verified.error);
    const { ip, region } = await resolveIpRegion(headers);
    const user = await createUser({
      username,
      password: body.password || '',
      phone,
      nickname: body.nickname || '',
      avatar: body.avatar,
      ip,
      region,
    });
    const token = signToken({
      sub: user.id,
      username: user.username,
      role: user.role,
    });
    return ok({ token, user: toPublicUser(user) }, 201);
  } catch (err) {
    return fail(err instanceof Error ? err.message : String(err));
  }
}

export async function handleLogin(
  body: { username?: string; password?: string },
  headers: Record<string, string | string[] | undefined>,
): Promise<AuthResult> {
  try {
    await ensureSeedAdmin();
    const username = (body.username || '').trim();
    const password = body.password || '';
    if (!username || !password) return fail('请输入用户名和密码');
    const user = await findByUsername(username);
    if (!user || !(await verifyPassword(user, password))) {
      return fail('账号或密码错误', 401);
    }
    const { ip, region } = await resolveIpRegion(headers);
    const now = Date.now();
    const updated = await updateUser(user.id, {
      lastIp: ip || user.lastIp,
      lastRegion: region || user.lastRegion,
      lastLoginAt: now,
      lastActiveAt: now,
    });
    const token = signToken({
      sub: updated.id,
      username: updated.username,
      role: updated.role,
    });
    return ok({ token, user: toPublicUser(updated) });
  } catch (err) {
    return fail(err instanceof Error ? err.message : String(err), 500);
  }
}

export async function handleMe(
  headers: Record<string, string | string[] | undefined>,
): Promise<AuthResult> {
  const payload = authFromHeader(headers);
  if (!payload) return fail('未登录或登录已过期', 401);
  const user = await findById(payload.sub);
  if (!user) return fail('用户不存在', 401);
  // Touch activity for DAU/MAU without rewriting every field heavily.
  const touched = await updateUser(user.id, { lastActiveAt: Date.now() });
  return ok({ user: toPublicUser(touched) });
}

export async function handleAdminStats(
  headers: Record<string, string | string[] | undefined>,
): Promise<AuthResult> {
  const payload = authFromHeader(headers);
  if (!payload || payload.role !== 'admin') {
    return fail('需要超级管理员权限', 403);
  }
  try {
    const { buildAdminStats } = await import('./adminStats');
    const stats = await buildAdminStats();
    return ok({ stats });
  } catch (err) {
    return fail(err instanceof Error ? err.message : String(err), 500);
  }
}

export async function handleListUsers(
  headers: Record<string, string | string[] | undefined>,
): Promise<AuthResult> {
  const payload = authFromHeader(headers);
  if (!payload || payload.role !== 'admin') {
    return fail('需要超级管理员权限', 403);
  }
  const users = await listUsers();
  return ok({ users: users.map(toPublicUser), defaults: DEFAULT_AVATARS });
}

function parseLimitField(v: unknown): number | null | undefined {
  if (v === undefined) return undefined;
  if (v === null || v === -1 || v === '-1') return null;
  if (typeof v === 'number' && Number.isFinite(v) && v >= 0) {
    return Math.floor(v);
  }
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    if (n === -1) return null;
    if (Number.isFinite(n) && n >= 0) return Math.floor(n);
  }
  return undefined;
}

export async function handleUpdateProfile(
  body: {
    nickname?: string;
    avatar?: string;
    phone?: string;
    smsCode?: string;
  },
  headers: Record<string, string | string[] | undefined>,
): Promise<AuthResult> {
  const payload = authFromHeader(headers);
  if (!payload) return fail('未登录或登录已过期', 401);
  try {
    const current = await findById(payload.sub);
    if (!current) return fail('用户不存在', 401);

    const patch: UserPatch = {};
    if (typeof body.nickname === 'string') {
      const n = body.nickname.trim();
      if (!n || n.length > 24) return fail('昵称需为 1–24 个字符');
      patch.nickname = n;
    }
    if (typeof body.avatar === 'string' && body.avatar.trim()) {
      patch.avatar = body.avatar.trim();
    }
    if (typeof body.phone === 'string') {
      const p = body.phone.trim();
      if (!/^1\d{10}$/.test(p)) {
        return fail('手机号需为 11 位有效号码');
      }
      if (p !== (current.phone || '').trim()) {
        const verified = await consumeSmsCode(p, 'change_phone', body.smsCode || '');
        if (!verified.ok) return fail(verified.error);
      }
      patch.phone = p;
    }
    if (!Object.keys(patch).length) return fail('没有需要更新的字段');
    const user = await updateUser(payload.sub, patch);
    return ok({ user: toPublicUser(user) });
  } catch (err) {
    return fail(err instanceof Error ? err.message : String(err));
  }
}

export async function handleUpdateUser(
  id: string,
  body: {
    note?: string;
    nickname?: string;
    avatar?: string;
    phone?: string;
    geminiEditDailyLimit?: number | null;
    qwenEditDailyLimit?: number | null;
    modelGenDailyLimit?: number | null;
    /** @deprecated — maps to geminiEditDailyLimit */
    imageEditDailyLimit?: number | null;
    watermarkEnabled?: boolean;
    /** @deprecated */
    imageEditCount?: number;
    /** @deprecated */
    modelGenCount?: number;
    password?: string;
  },
  headers: Record<string, string | string[] | undefined>,
): Promise<AuthResult> {
  const payload = authFromHeader(headers);
  if (!payload || payload.role !== 'admin') {
    return fail('需要超级管理员权限', 403);
  }
  try {
    const patch: UserPatch = {};
    if (typeof body.note === 'string') patch.note = body.note.slice(0, 500);
    if (typeof body.nickname === 'string') {
      const n = body.nickname.trim();
      if (n && n.length <= 24) patch.nickname = n;
    }
    if (typeof body.avatar === 'string' && body.avatar.trim()) {
      patch.avatar = body.avatar.trim();
    }
    if (typeof body.phone === 'string') {
      const p = body.phone.trim();
      if (p && !/^1\d{10}$/.test(p)) {
        return fail('手机号需为 11 位有效号码');
      }
      patch.phone = p;
    }
    const geminiLimit =
      parseLimitField(body.geminiEditDailyLimit) !== undefined
        ? parseLimitField(body.geminiEditDailyLimit)
        : parseLimitField(body.imageEditDailyLimit) !== undefined
          ? parseLimitField(body.imageEditDailyLimit)
          : parseLimitField(body.imageEditCount);
    const qwenLimit = parseLimitField(body.qwenEditDailyLimit);
    const modelLimit =
      parseLimitField(body.modelGenDailyLimit) !== undefined
        ? parseLimitField(body.modelGenDailyLimit)
        : parseLimitField(body.modelGenCount);
    if (geminiLimit !== undefined) patch.geminiEditDailyLimit = geminiLimit;
    if (qwenLimit !== undefined) patch.qwenEditDailyLimit = qwenLimit;
    if (modelLimit !== undefined) patch.modelGenDailyLimit = modelLimit;
    if (typeof body.watermarkEnabled === 'boolean') {
      patch.watermarkEnabled = body.watermarkEnabled;
    }
    if (typeof body.password === 'string' && body.password.length >= 6) {
      const bcrypt = await import('bcryptjs');
      patch.passwordHash = await bcrypt.hash(body.password, 10);
    }
    const user = await updateUser(id, patch);
    return ok({ user: toPublicUser(user) });
  } catch (err) {
    return fail(err instanceof Error ? err.message : String(err));
  }
}

export async function handleAdjustExtraCredits(
  id: string,
  body: {
    kind?: 'geminiEdit' | 'qwenEdit' | 'modelGen';
    delta?: number;
    note?: string;
  },
  headers: Record<string, string | string[] | undefined>,
): Promise<AuthResult> {
  const payload = authFromHeader(headers);
  if (!payload || payload.role !== 'admin') {
    return fail('需要超级管理员权限', 403);
  }
  const kind = body.kind;
  if (kind !== 'geminiEdit' && kind !== 'qwenEdit' && kind !== 'modelGen') {
    return fail('kind 需为 geminiEdit、qwenEdit 或 modelGen');
  }
  const delta = Number(body.delta);
  if (!Number.isFinite(delta) || !Number.isInteger(delta) || delta === 0) {
    return fail('delta 需为非零整数（正数增加、负数减少）');
  }
  try {
    const admin = await findById(payload.sub);
    const user = await adjustExtraCredits(id, kind, delta, {
      note: typeof body.note === 'string' ? body.note : undefined,
      byAdminName:
        admin?.nickname || admin?.username || payload.username || 'admin',
    });
    return ok({ user: toPublicUser(user) });
  } catch (err) {
    return fail(err instanceof Error ? err.message : String(err));
  }
}

export async function handleTrackUsage(
  body: { kind?: 'geminiEdit' | 'qwenEdit' | 'modelGen' | 'imageEdit' },
  headers: Record<string, string | string[] | undefined>,
): Promise<AuthResult> {
  const payload = authFromHeader(headers);
  if (!payload) return fail('未登录或登录已过期', 401);
  let kind = body.kind;
  if (kind === 'imageEdit') kind = 'geminiEdit';
  if (kind !== 'geminiEdit' && kind !== 'qwenEdit' && kind !== 'modelGen') {
    return fail('kind 需为 geminiEdit、qwenEdit 或 modelGen');
  }
  try {
    const { ip, region } = await resolveIpRegion(headers);
    const user = await consumeUsage(payload.sub, kind, ip, region);
    return ok({ user: toPublicUser(user) });
  } catch (err) {
    const status = err instanceof QuotaExceededError ? 403 : 400;
    return fail(err instanceof Error ? err.message : String(err), status);
  }
}

/** 旧接口已停用：赞赏必须走微信扫码支付，禁止前端直接入账 */
export async function handleDonate(
  _body: { amount?: number; message?: string },
  headers: Record<string, string | string[] | undefined>,
): Promise<AuthResult> {
  const payload = authFromHeader(headers);
  if (!payload) return fail('请先登录后再赞赏', 401);
  return fail('请使用微信扫码支付完成赞赏，金额由服务端校验后入账', 400);
}

export async function handleListDonations(
  headers: Record<string, string | string[] | undefined>,
): Promise<AuthResult> {
  const payload = authFromHeader(headers);
  if (!payload || payload.role !== 'admin') {
    return fail('需要超级管理员权限', 403);
  }
  const donations = await listDonationMessages();
  return ok({ donations });
}

function requireDeleteCode(code: unknown): AuthResult | null {
  if (String(code ?? '').trim() !== ADMIN_DELETE_SECURITY_CODE) {
    return fail('安全码错误，请重新输入 6 位安全码', 403);
  }
  return null;
}

export async function handleDeleteUser(
  id: string,
  body: { securityCode?: string },
  headers: Record<string, string | string[] | undefined>,
): Promise<AuthResult> {
  const payload = authFromHeader(headers);
  if (!payload || payload.role !== 'admin') {
    return fail('需要超级管理员权限', 403);
  }
  const codeErr = requireDeleteCode(body.securityCode);
  if (codeErr) return codeErr;
  try {
    await deleteUserById(id, payload.sub);
    return ok({ ok: true });
  } catch (err) {
    return fail(err instanceof Error ? err.message : String(err));
  }
}

export async function handleDeleteDonation(
  id: string,
  body: { securityCode?: string },
  headers: Record<string, string | string[] | undefined>,
): Promise<AuthResult> {
  const payload = authFromHeader(headers);
  if (!payload || payload.role !== 'admin') {
    return fail('需要超级管理员权限', 403);
  }
  const codeErr = requireDeleteCode(body.securityCode);
  if (codeErr) return codeErr;
  try {
    await deleteDonationById(id);
    return ok({ ok: true });
  } catch (err) {
    return fail(err instanceof Error ? err.message : String(err));
  }
}

export async function handleDefaults(): Promise<AuthResult> {
  return ok({ defaults: DEFAULT_AVATARS });
}

export async function handleGetDocs(): Promise<AuthResult> {
  const docs = await loadDocs();
  return ok({ docs });
}

export async function handleListApis(
  headers: Record<string, string | string[] | undefined>,
): Promise<AuthResult> {
  const payload = authFromHeader(headers);
  if (!payload || payload.role !== 'admin') {
    return fail('需要超级管理员权限', 403);
  }
  const apis = await listPublicApis();
  return ok({ apis });
}

/** Public: enabled image-edit APIs for model picker. */
export async function handlePublicApis(): Promise<AuthResult> {
  const apis = await listPublicApis();
  return ok({
    apis: apis.map((a) => ({
      id: a.id,
      kind: a.kind,
      name: a.name,
      purpose: a.purpose,
      enabled: a.enabled,
      hasKey: a.hasKey,
    })),
  });
}

export async function handleUpdateApi(
  id: string,
  body: {
    name?: string;
    provider?: string;
    purpose?: string;
    enabled?: boolean;
    model?: string;
    baseUrl?: string;
    note?: string;
    apiKey?: string | null;
  },
  headers: Record<string, string | string[] | undefined>,
): Promise<AuthResult> {
  const payload = authFromHeader(headers);
  if (!payload || payload.role !== 'admin') {
    return fail('需要超级管理员权限', 403);
  }
  try {
    const api = await updateApi(id, body);
    return ok({ api: toPublicApi(api) });
  } catch (err) {
    return fail(err instanceof Error ? err.message : String(err));
  }
}

export async function handleDeleteApi(
  id: string,
  headers: Record<string, string | string[] | undefined>,
): Promise<AuthResult> {
  const payload = authFromHeader(headers);
  if (!payload || payload.role !== 'admin') {
    return fail('需要超级管理员权限', 403);
  }
  try {
    await deleteApi(id);
    return ok({ ok: true });
  } catch (err) {
    return fail(err instanceof Error ? err.message : String(err));
  }
}

export async function handleSaveDocs(
  body: {
    helpTitle?: string;
    helpSubtitle?: string;
    helpBody?: string;
    termsTitle?: string;
    termsBody?: string;
    privacyTitle?: string;
    privacyBody?: string;
  },
  headers: Record<string, string | string[] | undefined>,
): Promise<AuthResult> {
  const payload = authFromHeader(headers);
  if (!payload || payload.role !== 'admin') {
    return fail('需要超级管理员权限', 403);
  }
  try {
    const docs = await saveDocs({
      helpTitle: body.helpTitle,
      helpSubtitle: body.helpSubtitle,
      helpBody: body.helpBody,
      termsTitle: body.termsTitle,
      termsBody: body.termsBody,
      privacyTitle: body.privacyTitle,
      privacyBody: body.privacyBody,
    });
    return ok({ docs });
  } catch (err) {
    return fail(err instanceof Error ? err.message : String(err), 500);
  }
}

/** Pre-flight quota check (no consume). */
export async function assertUsageFromAuthHeader(
  headers: Record<string, string | string[] | undefined>,
  kind: import('./authTypes').UsageKind,
): Promise<void> {
  const payload = authFromHeader(headers);
  if (!payload) return; // guest path handled elsewhere
  await assertUsageAvailable(payload.sub, kind);
}

/** Used by image-edit routes — consumes daily quota after success. */
export async function bumpUsageFromAuthHeader(
  headers: Record<string, string | string[] | undefined>,
  kind: import('./authTypes').UsageKind,
): Promise<PublicUser | null> {
  const payload = authFromHeader(headers);
  if (!payload) return null;
  const { ip, region } = await resolveIpRegion(headers);
  const user = await consumeUsage(payload.sub, kind, ip, region);
  return toPublicUser(user);
}
