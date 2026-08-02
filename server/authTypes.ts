export type UserRole = 'admin' | 'user';
export type UserLevel = 'normal';

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
  imageEditDailyLimit: number | null;
  modelGenDailyLimit: number | null;
  imageEditUsedToday: number;
  modelGenUsedToday: number;
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
  imageEditDailyLimit: number | null;
  modelGenDailyLimit: number | null;
  imageEditUsedToday: number;
  modelGenUsedToday: number;
  imageEditUnlimited: boolean;
  modelGenUnlimited: boolean;
  sponsorshipTotal: number;
  sponsorships: SponsorshipRecord[];
  createdAt: number;
  updatedAt: number;
}

export const DEFAULT_DAILY_LIMIT = 20;

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

export function isUnlimited(
  user: Pick<StoredUser, 'role' | 'imageEditDailyLimit' | 'modelGenDailyLimit'>,
  kind: 'imageEdit' | 'modelGen',
): boolean {
  if (user.role === 'admin') return true;
  const limit =
    kind === 'imageEdit' ? user.imageEditDailyLimit : user.modelGenDailyLimit;
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
    imageEditDailyLimit: u.imageEditDailyLimit,
    modelGenDailyLimit: u.modelGenDailyLimit,
    imageEditUsedToday: u.imageEditUsedToday || 0,
    modelGenUsedToday: u.modelGenUsedToday || 0,
    imageEditUnlimited: isUnlimited(u, 'imageEdit'),
    modelGenUnlimited: isUnlimited(u, 'modelGen'),
    sponsorshipTotal,
    sponsorships: [...(u.sponsorships || [])].sort(
      (a, b) => b.createdAt - a.createdAt,
    ),
    createdAt: u.createdAt,
    updatedAt: u.updatedAt,
  };
}
