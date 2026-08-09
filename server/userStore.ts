import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import bcrypt from 'bcryptjs';
import {
  DEFAULT_AVATARS,
  DEFAULT_DAILY_LIMIT,
  DEFAULT_GEMINI_DAILY_LIMIT,
  DEFAULT_QWEN_DAILY_LIMIT,
  SUPER_ADMIN_PASSWORD,
  SUPER_ADMIN_USERNAME,
  type SponsorshipRecord,
  type StoredUser,
  type UsageKind,
  type UserLevel,
  type UserRole,
  isUnlimited,
} from './authTypes';
import { todayKey } from './usageDay';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '..', '.data');
const DATA_FILE = join(DATA_DIR, 'users.json');

type DbShape = { users: StoredUser[] };

function emptyDb(): DbShape {
  return { users: [] };
}

function uid(prefix = 'u'): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
}

function normalizeUser(raw: Partial<StoredUser> | Record<string, unknown>): StoredUser {
  const r = raw as Partial<StoredUser> & Record<string, unknown>;
  return normalizeUserInner(r);
}

function normalizeUserInner(raw: Partial<StoredUser> & Record<string, unknown>): StoredUser {
  const role = (raw.role === 'admin' ? 'admin' : 'user') as UserRole;
  const level = (raw.level === 'normal' ? 'normal' : 'normal') as UserLevel;
  const day = todayKey();
  const usageDayKey =
    typeof raw.usageDayKey === 'string' && raw.usageDayKey ? raw.usageDayKey : day;

  let geminiEditUsedToday =
    raw.geminiEditUsedToday != null
      ? Number(raw.geminiEditUsedToday) || 0
      : Number(raw.imageEditUsedToday) || 0;
  let qwenEditUsedToday =
    raw.qwenEditUsedToday != null ? Number(raw.qwenEditUsedToday) || 0 : 0;
  let modelGenUsedToday = Number(raw.modelGenUsedToday) || 0;
  if (usageDayKey !== day) {
    geminiEditUsedToday = 0;
    qwenEditUsedToday = 0;
    modelGenUsedToday = 0;
  }

  const parseLimit = (
    v: unknown,
    userDefault: number,
    adminDefaultNull = true,
  ): number | null => {
    if (adminDefaultNull && role === 'admin') return null;
    if (v === null) return role === 'admin' ? null : null;
    if (v === undefined) {
      return role === 'admin' ? null : userDefault;
    }
    if (typeof v === 'number') {
      if (v < 0) return null;
      return Math.floor(v);
    }
    return role === 'admin' ? null : userDefault;
  };

  const sponsorships = Array.isArray(raw.sponsorships)
    ? (raw.sponsorships as SponsorshipRecord[]).filter(
        (s) => s && typeof s.amount === 'number',
      )
    : [];

  const username = String(raw.username || '');
  const nicknameRaw = String(raw.nickname || '').trim();
  const geminiLimitRaw =
    raw.geminiEditDailyLimit !== undefined
      ? raw.geminiEditDailyLimit
      : undefined;
  const qwenLimitRaw =
    raw.qwenEditDailyLimit !== undefined
      ? raw.qwenEditDailyLimit
      : undefined;

  return {
    id: String(raw.id || uid()),
    username,
    nickname: nicknameRaw || username,
    passwordHash: String(raw.passwordHash || ''),
    role,
    level,
    avatar: String(raw.avatar || DEFAULT_AVATARS[0]),
    phone: String(raw.phone || ''),
    note: String(raw.note || ''),
    lastIp: String(raw.lastIp || ''),
    lastRegion: String(raw.lastRegion || ''),
    geminiEditDailyLimit: parseLimit(
      geminiLimitRaw,
      DEFAULT_GEMINI_DAILY_LIMIT,
    ),
    qwenEditDailyLimit: parseLimit(qwenLimitRaw, DEFAULT_QWEN_DAILY_LIMIT),
    modelGenDailyLimit: parseLimit(raw.modelGenDailyLimit, DEFAULT_DAILY_LIMIT),
    geminiEditUsedToday,
    qwenEditUsedToday,
    modelGenUsedToday,
    watermarkEnabled:
      role === 'admin' ? false : raw.watermarkEnabled !== false,
    usageDayKey: usageDayKey !== day ? day : usageDayKey,
    sponsorships,
    createdAt: Number(raw.createdAt) || Date.now(),
    updatedAt: Number(raw.updatedAt) || Date.now(),
  };
}

async function readFileDb(): Promise<DbShape> {
  try {
    if (!existsSync(DATA_FILE)) return emptyDb();
    const raw = readFileSync(DATA_FILE, 'utf8');
    const parsed = JSON.parse(raw) as DbShape;
    if (!parsed?.users || !Array.isArray(parsed.users)) return emptyDb();
    return { users: parsed.users.map((u) => normalizeUser(u as never)) };
  } catch {
    return emptyDb();
  }
}

async function writeFileDb(db: DbShape): Promise<void> {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(DATA_FILE, JSON.stringify(db, null, 2), 'utf8');
}

async function readBlobDb(): Promise<DbShape | null> {
  try {
    const { getStore } = await import('@netlify/blobs');
    const store = getStore('aurora-users');
    const raw = await store.get('db', { type: 'text' });
    if (!raw) return emptyDb();
    const parsed = JSON.parse(raw) as DbShape;
    if (!parsed?.users || !Array.isArray(parsed.users)) return emptyDb();
    return { users: parsed.users.map((u) => normalizeUser(u as never)) };
  } catch {
    return null;
  }
}

async function writeBlobDb(db: DbShape): Promise<boolean> {
  try {
    const { getStore } = await import('@netlify/blobs');
    const store = getStore('aurora-users');
    await store.set('db', JSON.stringify(db));
    return true;
  } catch {
    return false;
  }
}

async function loadDb(): Promise<DbShape> {
  if (process.env.NETLIFY === 'true' || process.env.NETLIFY_BLOBS) {
    const blob = await readBlobDb();
    if (blob) return blob;
  }
  return readFileDb();
}

async function saveDb(db: DbShape): Promise<void> {
  const usedBlob = await writeBlobDb(db);
  if (!usedBlob) await writeFileDb(db);
}

function rollUsageDay(user: StoredUser): StoredUser {
  const day = todayKey();
  if (user.usageDayKey === day) return user;
  return {
    ...user,
    usageDayKey: day,
    geminiEditUsedToday: 0,
    qwenEditUsedToday: 0,
    modelGenUsedToday: 0,
  };
}

export async function ensureSeedAdmin(): Promise<void> {
  const db = await loadDb();
  const existing = db.users.find(
    (u) => u.username.toLowerCase() === SUPER_ADMIN_USERNAME.toLowerCase(),
  );
  if (existing) {
    let dirty = false;
    if (existing.role !== 'admin') {
      existing.role = 'admin';
      dirty = true;
    }
    if (
      existing.geminiEditDailyLimit != null ||
      existing.qwenEditDailyLimit != null ||
      existing.modelGenDailyLimit != null
    ) {
      existing.geminiEditDailyLimit = null;
      existing.qwenEditDailyLimit = null;
      existing.modelGenDailyLimit = null;
      dirty = true;
    }
    if (!existing.nickname) {
      existing.nickname = SUPER_ADMIN_USERNAME;
      dirty = true;
    }
    if (dirty) {
      existing.updatedAt = Date.now();
      await saveDb(db);
    }
    return;
  }
  const now = Date.now();
  db.users.push(
    normalizeUser({
      id: uid(),
      username: SUPER_ADMIN_USERNAME,
      nickname: SUPER_ADMIN_USERNAME,
      passwordHash: await bcrypt.hash(SUPER_ADMIN_PASSWORD, 10),
      role: 'admin',
      level: 'normal',
      avatar: DEFAULT_AVATARS[0],
      phone: '',
      note: '超级管理员',
      lastIp: '',
      lastRegion: '',
      geminiEditDailyLimit: null,
      qwenEditDailyLimit: null,
      modelGenDailyLimit: null,
      geminiEditUsedToday: 0,
      qwenEditUsedToday: 0,
      modelGenUsedToday: 0,
      usageDayKey: todayKey(),
      sponsorships: [],
      createdAt: now,
      updatedAt: now,
    }),
  );
  await saveDb(db);
}

export async function listUsers(): Promise<StoredUser[]> {
  await ensureSeedAdmin();
  const db = await loadDb();
  let dirty = false;
  const users = db.users.map((u) => {
    const rolled = rollUsageDay(u);
    if (rolled !== u) dirty = true;
    return rolled;
  });
  if (dirty) {
    db.users = users;
    await saveDb(db);
  }
  return [...users].sort((a, b) => {
    // Super admin always pinned to top in user management.
    if (a.role === 'admin' && b.role !== 'admin') return -1;
    if (b.role === 'admin' && a.role !== 'admin') return 1;
    return b.createdAt - a.createdAt;
  });
}

export async function findByUsername(
  username: string,
): Promise<StoredUser | null> {
  await ensureSeedAdmin();
  const db = await loadDb();
  const key = username.trim().toLowerCase();
  const user = db.users.find((u) => u.username.toLowerCase() === key) ?? null;
  if (!user) return null;
  const rolled = rollUsageDay(user);
  if (rolled !== user) {
    const idx = db.users.findIndex((u) => u.id === user.id);
    db.users[idx] = rolled;
    await saveDb(db);
  }
  return rolled;
}

export async function findById(id: string): Promise<StoredUser | null> {
  await ensureSeedAdmin();
  const db = await loadDb();
  const user = db.users.find((u) => u.id === id) ?? null;
  if (!user) return null;
  const rolled = rollUsageDay(user);
  if (rolled !== user) {
    const idx = db.users.findIndex((u) => u.id === user.id);
    db.users[idx] = rolled;
    await saveDb(db);
  }
  return rolled;
}

function validatePhone(phone: string): string {
  const p = phone.trim();
  if (!/^1\d{10}$/.test(p)) {
    throw new Error('请输入有效的 11 位手机号码');
  }
  return p;
}

function validateNickname(nickname: string): string {
  const n = nickname.trim();
  if (!n || n.length < 1 || n.length > 24) {
    throw new Error('昵称需为 1–24 个字符');
  }
  return n;
}

export async function createUser(input: {
  username: string;
  password: string;
  phone: string;
  nickname: string;
  avatar?: string;
  ip?: string;
  region?: string;
}): Promise<StoredUser> {
  await ensureSeedAdmin();
  const username = input.username.trim();
  if (!username || username.length < 2 || username.length > 32) {
    throw new Error('用户名需为 2–32 个字符');
  }
  if (!/^[A-Za-z0-9_\u4e00-\u9fa5.-]+$/.test(username)) {
    throw new Error('用户名仅支持中英文、数字、下划线与短横线');
  }
  if (!input.password || input.password.length < 6) {
    throw new Error('密码至少 6 位');
  }
  const nickname = validateNickname(input.nickname || '');
  const phone = validatePhone(input.phone || '');
  if (await findByUsername(username)) {
    throw new Error('该用户名已被注册');
  }

  const now = Date.now();
  const user = normalizeUser({
    id: uid(),
    username,
    nickname,
    passwordHash: await bcrypt.hash(input.password, 10),
    role: 'user',
    level: 'normal',
    avatar: input.avatar?.trim() || DEFAULT_AVATARS[0],
    phone,
    note: '',
    lastIp: input.ip || '',
    lastRegion: input.region || '',
    geminiEditDailyLimit: DEFAULT_GEMINI_DAILY_LIMIT,
    qwenEditDailyLimit: DEFAULT_QWEN_DAILY_LIMIT,
    modelGenDailyLimit: DEFAULT_DAILY_LIMIT,
    geminiEditUsedToday: 0,
    qwenEditUsedToday: 0,
    modelGenUsedToday: 0,
    watermarkEnabled: true,
    usageDayKey: todayKey(),
    sponsorships: [],
    createdAt: now,
    updatedAt: now,
  });

  const db = await loadDb();
  db.users.push(user);
  await saveDb(db);
  return user;
}

export type UserPatch = Partial<
  Pick<
    StoredUser,
    | 'note'
    | 'nickname'
    | 'avatar'
    | 'phone'
    | 'lastIp'
    | 'lastRegion'
    | 'geminiEditDailyLimit'
    | 'qwenEditDailyLimit'
    | 'modelGenDailyLimit'
    | 'watermarkEnabled'
    | 'passwordHash'
    | 'role'
    | 'level'
  >
>;

export const QUOTA_EXCEEDED_MESSAGE =
  '目前您的免费额度已经全部用完，请等待明天更新，或者联系万生：19806651984.';

export async function updateUser(
  id: string,
  patch: UserPatch,
): Promise<StoredUser> {
  const db = await loadDb();
  const idx = db.users.findIndex((u) => u.id === id);
  if (idx < 0) throw new Error('用户不存在');
  const next = rollUsageDay({
    ...db.users[idx],
    ...patch,
    updatedAt: Date.now(),
  });
  if (next.role === 'admin') {
    next.geminiEditDailyLimit = null;
    next.qwenEditDailyLimit = null;
    next.modelGenDailyLimit = null;
    next.watermarkEnabled = false;
  }
  db.users[idx] = normalizeUser(next);
  await saveDb(db);
  return db.users[idx];
}

export async function verifyPassword(
  user: StoredUser,
  password: string,
): Promise<boolean> {
  return bcrypt.compare(password, user.passwordHash);
}

export class QuotaExceededError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'QuotaExceededError';
  }
}

function quotaError(_kind: UsageKind, _limit: number) {
  return new QuotaExceededError(QUOTA_EXCEEDED_MESSAGE);
}

function limitOf(user: StoredUser, kind: UsageKind): number | null {
  if (kind === 'geminiEdit') return user.geminiEditDailyLimit;
  if (kind === 'qwenEdit') return user.qwenEditDailyLimit;
  return user.modelGenDailyLimit;
}

function usedOf(user: StoredUser, kind: UsageKind): number {
  if (kind === 'geminiEdit') return user.geminiEditUsedToday;
  if (kind === 'qwenEdit') return user.qwenEditUsedToday;
  return user.modelGenUsedToday;
}

function bumpUsed(user: StoredUser, kind: UsageKind): void {
  if (kind === 'geminiEdit') user.geminiEditUsedToday += 1;
  else if (kind === 'qwenEdit') user.qwenEditUsedToday += 1;
  else user.modelGenUsedToday += 1;
}

export async function assertUsageAvailable(
  userId: string,
  kind: UsageKind,
): Promise<StoredUser> {
  const user = await findById(userId);
  if (!user) throw new Error('用户不存在');
  if (!isUnlimited(user, kind)) {
    const limit = limitOf(user, kind)!;
    const used = usedOf(user, kind);
    if (used >= limit) throw quotaError(kind, limit);
  }
  return user;
}

export async function consumeUsage(
  userId: string,
  kind: UsageKind,
  ip?: string,
  region?: string,
): Promise<StoredUser> {
  const db = await loadDb();
  const idx = db.users.findIndex((u) => u.id === userId);
  if (idx < 0) throw new Error('用户不存在');

  let user = rollUsageDay(db.users[idx]);
  if (!isUnlimited(user, kind)) {
    const limit = limitOf(user, kind)!;
    const used = usedOf(user, kind);
    if (used >= limit) throw quotaError(kind, limit);
  }

  bumpUsed(user, kind);
  if (ip) user.lastIp = ip;
  if (region) user.lastRegion = region;
  user.updatedAt = Date.now();
  db.users[idx] = user;
  await saveDb(db);
  return user;
}

/** @deprecated alias — prefer consumeUsage */
export async function incrementUsage(
  userId: string,
  kind: UsageKind,
  ip?: string,
): Promise<StoredUser | null> {
  try {
    return await consumeUsage(userId, kind, ip);
  } catch (err) {
    if (err instanceof QuotaExceededError) throw err;
    return null;
  }
}

export async function addSponsorship(
  userId: string,
  amount: number,
  message: string,
): Promise<StoredUser> {
  if (!Number.isFinite(amount) || amount < 0.01) {
    throw new Error('赞赏金额无效');
  }
  if (!userId) {
    throw new Error('请先登录后再赞赏，以便记录到您的账户');
  }
  const db = await loadDb();
  const idx = db.users.findIndex((u) => u.id === userId);
  if (idx < 0) throw new Error('请先登录后再赞赏，以便记录到您的账户');

  const record: SponsorshipRecord = {
    id: uid('sp'),
    amount: Math.round(amount * 100) / 100,
    message: (message || '').trim().slice(0, 120),
    createdAt: Date.now(),
  };
  const user = rollUsageDay(db.users[idx]);
  user.sponsorships = [...(user.sponsorships || []), record];
  user.updatedAt = Date.now();
  db.users[idx] = user;
  await saveDb(db);
  return user;
}

export async function listDonationMessages(): Promise<
  Array<{
    id: string;
    userId: string;
    username: string;
    amount: number;
    message: string;
    createdAt: number;
  }>
> {
  await ensureSeedAdmin();
  const users = await listUsers();
  const rows: Array<{
    id: string;
    userId: string;
    username: string;
    amount: number;
    message: string;
    createdAt: number;
  }> = [];
  for (const u of users) {
    for (const s of u.sponsorships || []) {
      rows.push({
        id: s.id,
        userId: u.id,
        username: u.username,
        amount: s.amount,
        message: s.message,
        createdAt: s.createdAt,
      });
    }
  }
  return rows.sort((a, b) => b.createdAt - a.createdAt);
}

export async function deleteUserById(
  id: string,
  actorId: string,
): Promise<void> {
  const db = await loadDb();
  const idx = db.users.findIndex((u) => u.id === id);
  if (idx < 0) throw new Error('用户不存在');
  const target = db.users[idx];
  if (target.id === actorId) {
    throw new Error('不能删除当前登录的管理员账号');
  }
  if (target.role === 'admin') {
    throw new Error('不能删除超级管理员账号');
  }
  if (
    target.username.toLowerCase() === SUPER_ADMIN_USERNAME.toLowerCase()
  ) {
    throw new Error('不能删除超级管理员账号');
  }
  db.users.splice(idx, 1);
  await saveDb(db);
}

export async function deleteDonationById(donationId: string): Promise<void> {
  const db = await loadDb();
  let found = false;
  for (const user of db.users) {
    const before = user.sponsorships?.length || 0;
    user.sponsorships = (user.sponsorships || []).filter(
      (s) => s.id !== donationId,
    );
    if ((user.sponsorships?.length || 0) !== before) {
      found = true;
      user.updatedAt = Date.now();
      break;
    }
  }
  if (!found) throw new Error('赞赏留言不存在');
  await saveDb(db);
}
