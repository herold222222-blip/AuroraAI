export type UserRole = 'admin' | 'user';
export type UserLevel = 'normal';
export type UsageKind = 'geminiEdit' | 'qwenEdit' | 'modelGen';

export interface SponsorshipRecord {
  id: string;
  amount: number;
  message: string;
  createdAt: number;
}

export interface StoredUser {
  id: string;
  username: string;
  nickname: string;
  passwordHash: string;
  role: UserRole;
  level: UserLevel;
  /** data URL or public path */
  avatar: string;
  phone: string;
  note: string;
  lastIp: string;
  /** 省市，如「广东省 深圳市」 */
  lastRegion: string;
  /**
   * 每日可用次数；null 表示不限次数。
   * 超级管理员始终按不限处理。
   */
  geminiEditDailyLimit: number | null;
  qwenEditDailyLimit: number | null;
  modelGenDailyLimit: number | null;
  geminiEditUsedToday: number;
  qwenEditUsedToday: number;
  modelGenUsedToday: number;
  /**
   * 普通用户 AI 出图是否带 Aurora 水印；默认 true。
   * 超级管理员始终不打水印（忽略该字段）。
   */
  watermarkEnabled: boolean;
  /** YYYY-MM-DD（东八区） */
  usageDayKey: string;
  sponsorships: SponsorshipRecord[];
  createdAt: number;
  updatedAt: number;
}

export interface PublicUser {
  id: string;
  username: string;
  nickname: string;
  role: UserRole;
  level: UserLevel;
  levelLabel: string;
  avatar: string;
  phone: string;
  note: string;
  lastIp: string;
  lastRegion: string;
  geminiEditDailyLimit: number | null;
  qwenEditDailyLimit: number | null;
  modelGenDailyLimit: number | null;
  geminiEditUsedToday: number;
  qwenEditUsedToday: number;
  modelGenUsedToday: number;
  geminiEditUnlimited: boolean;
  qwenEditUnlimited: boolean;
  modelGenUnlimited: boolean;
  /** 普通用户是否出水印；管理员恒为 false */
  watermarkEnabled: boolean;
  sponsorshipTotal: number;
  sponsorships: SponsorshipRecord[];
  createdAt: number;
  updatedAt: number;
}

/** @deprecated model-gen default; prefer DEFAULT_* below */
export const DEFAULT_DAILY_LIMIT = 20;
export const DEFAULT_GEMINI_DAILY_LIMIT = 5;
export const DEFAULT_QWEN_DAILY_LIMIT = 20;

export const DEFAULT_AVATARS = [
  '/avatars/default-1.svg',
  '/avatars/default-2.svg',
  '/avatars/default-3.svg',
  '/avatars/default-4.svg',
] as const;

export const SUPER_ADMIN_USERNAME = 'Leping';
export const SUPER_ADMIN_PASSWORD = 'LXWX19076652';
/** 管理员删除用户 / 赞赏留言时需输入的 6 位安全码 */
export const ADMIN_DELETE_SECURITY_CODE = '205588';

export function levelLabel(level: UserLevel, role: UserRole): string {
  if (role === 'admin') return '超级管理员';
  if (level === 'normal') return '普通用户';
  return '普通用户';
}

export function usageKindFromEditModel(
  model?: string | null,
): 'geminiEdit' | 'qwenEdit' {
  return model === 'qwen-image' ? 'qwenEdit' : 'geminiEdit';
}

export function isUnlimited(user: StoredUser, kind: UsageKind): boolean {
  if (user.role === 'admin') return true;
  const limit =
    kind === 'geminiEdit'
      ? user.geminiEditDailyLimit
      : kind === 'qwenEdit'
        ? user.qwenEditDailyLimit
        : user.modelGenDailyLimit;
  return limit == null || limit < 0;
}

export function toPublicUser(u: StoredUser): PublicUser {
  const sponsorshipTotal = (u.sponsorships || []).reduce(
    (sum, s) => sum + (Number(s.amount) || 0),
    0,
  );
  return {
    id: u.id,
    username: u.username,
    nickname: (u.nickname || u.username || '').trim() || u.username,
    role: u.role,
    level: u.level || 'normal',
    levelLabel: levelLabel(u.level || 'normal', u.role),
    avatar: u.avatar,
    phone: u.phone || '',
    note: u.note || '',
    lastIp: u.lastIp || '',
    lastRegion: u.lastRegion || '',
    geminiEditDailyLimit: u.geminiEditDailyLimit,
    qwenEditDailyLimit: u.qwenEditDailyLimit,
    modelGenDailyLimit: u.modelGenDailyLimit,
    geminiEditUsedToday: u.geminiEditUsedToday || 0,
    qwenEditUsedToday: u.qwenEditUsedToday || 0,
    modelGenUsedToday: u.modelGenUsedToday || 0,
    geminiEditUnlimited: isUnlimited(u, 'geminiEdit'),
    qwenEditUnlimited: isUnlimited(u, 'qwenEdit'),
    modelGenUnlimited: isUnlimited(u, 'modelGen'),
    watermarkEnabled:
      u.role === 'admin' ? false : u.watermarkEnabled !== false,
    sponsorshipTotal,
    sponsorships: [...(u.sponsorships || [])].sort(
      (a, b) => b.createdAt - a.createdAt,
    ),
    createdAt: u.createdAt,
    updatedAt: u.updatedAt,
  };
}
