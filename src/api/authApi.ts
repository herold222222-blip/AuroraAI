import { apiUrl } from '../config/api';

export type UserRole = 'admin' | 'user';
export type UserLevel = 'normal';

export interface SponsorshipRecord {
  id: string;
  amount: number;
  message: string;
  createdAt: number;
  outTradeNo?: string;
  transactionId?: string;
  payChannel?: 'wechat';
  paidAt?: number;
}

export type DonatePayStatus =
  | 'pending'
  | 'user_paying'
  | 'paid'
  | 'closed'
  | 'expired';

export interface DonatePayOrder {
  outTradeNo: string;
  amount: number;
  amountFen: number;
  message: string;
  status: DonatePayStatus;
  codeUrl: string;
  expireAt: number;
  createdAt: number;
  paidAt: number | null;
  transactionId: string | null;
  pollIntervalMs: number;
  pollMaxMs: number;
  channel: 'wechat';
}

export type UsageKind = 'geminiEdit' | 'qwenEdit' | 'modelGen';

export interface ExtraCredits {
  geminiEdit: number;
  qwenEdit: number;
  modelGen: number;
}

export type UsageLedgerAction = 'consume_free' | 'consume_extra' | 'adjust';

export interface UsageLedgerEntry {
  id: string;
  createdAt: number;
  kind: UsageKind;
  action: UsageLedgerAction;
  delta: number;
  extraAfter: number;
  note?: string;
  byAdminName?: string;
}

export function emptyExtraCredits(): ExtraCredits {
  return { geminiEdit: 0, qwenEdit: 0, modelGen: 0 };
}

export function normalizeExtraCredits(
  raw: ExtraCredits | null | undefined,
): ExtraCredits {
  const base = emptyExtraCredits();
  if (!raw) return base;
  for (const k of ['geminiEdit', 'qwenEdit', 'modelGen'] as const) {
    const n = Number(raw[k]);
    base[k] = Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0;
  }
  return base;
}

export interface AuthUser {
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
  /** Admin-granted bonus credits (after daily free). */
  extraCredits: ExtraCredits;
  /** Free/extra consumption + admin adjustments. */
  usageLedger: UsageLedgerEntry[];
  /** 普通用户 AI 出图是否带水印；管理员恒为 false */
  watermarkEnabled: boolean;
  sponsorshipTotal: number;
  sponsorships: SponsorshipRecord[];
  createdAt: number;
  updatedAt: number;
}

export interface DonationMessage {
  id: string;
  userId: string;
  username: string;
  amount: number;
  message: string;
  createdAt: number;
  outTradeNo?: string;
  transactionId?: string;
  payChannel?: 'wechat';
  paidAt?: number;
}

function authBase(): string {
  return apiUrl('/api/auth');
}

async function request<T>(
  path: string,
  init: RequestInit = {},
  token?: string | null,
): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(init.headers as Record<string, string> | undefined),
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${authBase()}${path}`, { ...init, headers });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) {
    throw new Error(data.error || `请求失败 (${res.status})`);
  }
  return data;
}

export async function apiLogin(username: string, password: string) {
  return request<{ token: string; user: AuthUser }>('/login', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  });
}

export type SmsPurpose = 'register' | 'change_phone';

export async function apiSendSms(
  phone: string,
  purpose: SmsPurpose,
  token?: string | null,
) {
  return request<{
    cooldownSec: number;
    expiresInSec: number;
    provider: 'aliyun';
  }>(
    '/sms/send',
    { method: 'POST', body: JSON.stringify({ phone, purpose }) },
    token,
  );
}

export async function apiRegister(
  username: string,
  password: string,
  phone: string,
  nickname: string,
  avatar: string | undefined,
  smsCode: string,
) {
  return request<{ token: string; user: AuthUser }>('/register', {
    method: 'POST',
    body: JSON.stringify({
      username,
      password,
      phone,
      nickname,
      avatar,
      smsCode,
    }),
  });
}

export async function apiUpdateProfile(
  token: string,
  patch: {
    nickname?: string;
    avatar?: string;
    phone?: string;
    smsCode?: string;
  },
) {
  return request<{ user: AuthUser }>(
    '/profile',
    { method: 'PATCH', body: JSON.stringify(patch) },
    token,
  );
}

export const QUOTA_EXCEEDED_HINT =
  '目前您的免费额度已经全部用完，请等待明天更新，或者联系万生：19806651984.';

export const GEMINI_TO_QWEN_HINT =
  '您的Gemini免费额度已经用完，当前自动切换到千问模型';

export type QuotaModalKind = 'allExhausted' | 'switchToQwen';

export function isQuotaExceededMessage(msg: string | undefined | null): boolean {
  if (!msg) return false;
  return (
    msg.includes('限额已经使用完') ||
    msg.includes('免费额度已经') ||
    msg.includes('次数已用完') ||
    msg.includes('QuotaExceeded')
  );
}

/** Whether a regular user has no free daily quota and no extra credits left. */
export function isEditQuotaExhausted(
  user: AuthUser | null | undefined,
  kind: 'gemini' | 'qwen',
): boolean {
  if (!user || user.role === 'admin') return false;
  const extras = normalizeExtraCredits(user.extraCredits);
  if (kind === 'gemini') {
    if (user.geminiEditUnlimited || user.geminiEditDailyLimit == null) {
      return false;
    }
    const freeDone = user.geminiEditUsedToday >= user.geminiEditDailyLimit;
    return freeDone && extras.geminiEdit <= 0;
  }
  if (user.qwenEditUnlimited || user.qwenEditDailyLimit == null) return false;
  const freeDone = user.qwenEditUsedToday >= user.qwenEditDailyLimit;
  return freeDone && extras.qwenEdit <= 0;
}

export async function apiMe(token: string) {
  return request<{ user: AuthUser }>('/me', { method: 'GET' }, token);
}

export async function apiListUsers(token: string) {
  return request<{ users: AuthUser[]; defaults: string[] }>(
    '/users',
    { method: 'GET' },
    token,
  );
}

export type AdminStatsSeriesPoint = { date: string; value: number };

export interface AdminStats {
  generatedAt: number;
  todayKey: string;
  totalUsers: number;
  todayRegistrations: number;
  dau: number;
  mau: number;
  sponsorshipTotal: number;
  sponsorshipCount: number;
  registrationDaily: AdminStatsSeriesPoint[];
  registrationMonthly: AdminStatsSeriesPoint[];
  registrationYearly: AdminStatsSeriesPoint[];
  activeDaily: AdminStatsSeriesPoint[];
  activeMonthly: AdminStatsSeriesPoint[];
  activeYearly: AdminStatsSeriesPoint[];
  sponsorshipDaily: AdminStatsSeriesPoint[];
  sponsorshipMonthly: AdminStatsSeriesPoint[];
  sponsorshipYearly: AdminStatsSeriesPoint[];
}

export async function apiGetAdminStats(token: string) {
  return request<{ stats: AdminStats }>('/stats', { method: 'GET' }, token);
}

export async function apiUpdateUser(
  token: string,
  id: string,
  patch: {
    note?: string;
    avatar?: string;
    phone?: string;
    geminiEditDailyLimit?: number | null;
    qwenEditDailyLimit?: number | null;
    modelGenDailyLimit?: number | null;
    watermarkEnabled?: boolean;
    password?: string;
  },
) {
  return request<{ user: AuthUser }>(
    `/users/${encodeURIComponent(id)}`,
    { method: 'PATCH', body: JSON.stringify(patch) },
    token,
  );
}

export async function apiAdjustExtraCredits(
  token: string,
  id: string,
  body: { kind: UsageKind; delta: number; note?: string },
) {
  return request<{ user: AuthUser }>(
    `/users/${encodeURIComponent(id)}/credits`,
    { method: 'POST', body: JSON.stringify(body) },
    token,
  );
}

export async function apiDeleteUser(
  token: string,
  id: string,
  securityCode: string,
) {
  return request<{ ok: boolean }>(
    `/users/${encodeURIComponent(id)}`,
    {
      method: 'DELETE',
      body: JSON.stringify({ securityCode }),
    },
    token,
  );
}

export async function apiDeleteDonation(
  token: string,
  id: string,
  securityCode: string,
) {
  return request<{ ok: boolean }>(
    `/donations/${encodeURIComponent(id)}`,
    {
      method: 'DELETE',
      body: JSON.stringify({ securityCode }),
    },
    token,
  );
}

export async function apiTrackUsage(
  token: string,
  kind: 'geminiEdit' | 'qwenEdit' | 'modelGen',
) {
  return request<{ user: AuthUser }>(
    '/track',
    { method: 'POST', body: JSON.stringify({ kind }) },
    token,
  );
}

/** @deprecated 已停用：请使用微信扫码支付 API */
export async function apiDonate(
  token: string,
  amount: number,
  message: string,
) {
  return request<{ user: AuthUser }>(
    '/donate',
    { method: 'POST', body: JSON.stringify({ amount, message }) },
    token,
  );
}

async function payRequest<T>(
  path: string,
  init: RequestInit = {},
  token?: string | null,
): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(init.headers as Record<string, string> | undefined),
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(apiUrl(`/api/pay${path}`), { ...init, headers });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) {
    throw new Error(data.error || `请求失败 (${res.status})`);
  }
  return data;
}

/** 创建 / 刷新微信扫码赞赏订单（金额由服务端二次校验） */
export async function apiCreateDonateOrder(
  token: string,
  amount: number,
  message: string,
  refresh = true,
) {
  return payRequest<{
    order: DonatePayOrder;
    reused: boolean;
    user?: AuthUser | null;
  }>(
    '/donate/create',
    {
      method: 'POST',
      body: JSON.stringify({ amount, message, refresh }),
    },
    token,
  );
}

/** 恢复未过期的待支付订单（页面刷新防多单） */
export async function apiGetPendingDonateOrder(token: string) {
  return payRequest<{ order: DonatePayOrder | null }>(
    '/donate/pending',
    { method: 'GET' },
    token,
  );
}

export async function apiDonateOrderStatus(
  token: string,
  outTradeNo: string,
) {
  return payRequest<{
    order: DonatePayOrder;
    user?: AuthUser | null;
  }>(
    `/donate/status/${encodeURIComponent(outTradeNo)}`,
    { method: 'GET' },
    token,
  );
}

/** 更新待支付单留言（不重新生成二维码） */
export async function apiUpdateDonateOrderMessage(
  token: string,
  outTradeNo: string,
  message: string,
) {
  return payRequest<{ order: DonatePayOrder }>(
    '/donate/message',
    {
      method: 'PATCH',
      body: JSON.stringify({ outTradeNo, message }),
    },
    token,
  );
}

export interface DonatePayRecord {
  id: string;
  amount: number;
  message: string;
  createdAt: number;
  paidAt: number;
  outTradeNo?: string;
  transactionId?: string;
  payChannel: 'wechat';
  status: 'paid';
}

/** 我的钱包：已支付打赏订单与累计 */
export async function apiListMyDonateRecords(token: string) {
  return payRequest<{
    records: DonatePayRecord[];
    total: number;
    count: number;
  }>('/donate/records', { method: 'GET' }, token);
}

export async function apiListDonations(token: string) {
  return request<{ donations: DonationMessage[] }>(
    '/donations',
    { method: 'GET' },
    token,
  );
}

export async function apiDefaultAvatars() {
  return request<{ defaults: string[] }>('/defaults', { method: 'GET' });
}

export interface SiteDocs {
  helpTitle: string;
  helpSubtitle: string;
  helpBody: string;
  termsTitle: string;
  termsBody: string;
  privacyTitle: string;
  privacyBody: string;
  updatedAt: number;
}

export async function apiGetDocs() {
  return request<{ docs: SiteDocs }>('/docs', { method: 'GET' });
}

export async function apiSaveDocs(
  token: string,
  docs: Partial<
    Pick<
      SiteDocs,
      | 'helpTitle'
      | 'helpSubtitle'
      | 'helpBody'
      | 'termsTitle'
      | 'termsBody'
      | 'privacyTitle'
      | 'privacyBody'
    >
  >,
) {
  return request<{ docs: SiteDocs }>(
    '/docs',
    { method: 'PUT', body: JSON.stringify(docs) },
    token,
  );
}

export type ApiKind = 'gemini' | 'qwen' | 'meshy';

export interface ManagedApi {
  id: string;
  kind: ApiKind;
  name: string;
  provider: string;
  purpose: string;
  enabled: boolean;
  model: string;
  baseUrl: string;
  note: string;
  isPreset: boolean;
  hasKey: boolean;
  keyHint: string;
  createdAt: number;
  updatedAt: number;
}

export async function apiListApis(token: string) {
  return request<{ apis: ManagedApi[] }>('/apis', { method: 'GET' }, token);
}

export async function apiUpdateApi(
  token: string,
  id: string,
  patch: Partial<{
    name: string;
    provider: string;
    purpose: string;
    enabled: boolean;
    model: string;
    baseUrl: string;
    note: string;
    apiKey: string | null;
  }>,
) {
  return request<{ api: ManagedApi }>(
    `/apis/${encodeURIComponent(id)}`,
    { method: 'PATCH', body: JSON.stringify(patch) },
    token,
  );
}

export async function apiDeleteApi(token: string, id: string) {
  return request<{ ok: boolean }>(
    `/apis/${encodeURIComponent(id)}`,
    { method: 'DELETE' },
    token,
  );
}

export async function apiPublicApis() {
  return request<{
    apis: Array<{
      id: string;
      kind: ApiKind;
      name: string;
      purpose: string;
      enabled: boolean;
      hasKey: boolean;
    }>;
  }>('/apis/public', { method: 'GET' });
}

export function authHeader(
  token: string | null | undefined,
): Record<string, string> {
  return token ? { Authorization: `Bearer ${token}` } : {};
}
