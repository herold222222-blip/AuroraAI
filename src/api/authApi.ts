export type UserRole = 'admin' | 'user';
export type UserLevel = 'normal';

export interface SponsorshipRecord {
  id: string;
  amount: number;
  message: string;
  createdAt: number;
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

export interface DonationMessage {
  id: string;
  userId: string;
  username: string;
  amount: number;
  message: string;
  createdAt: number;
}

function authBase(): string {
  return '/api/auth';
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

export async function apiRegister(
  username: string,
  password: string,
  phone: string,
  nickname: string,
  avatar?: string,
) {
  return request<{ token: string; user: AuthUser }>('/register', {
    method: 'POST',
    body: JSON.stringify({ username, password, phone, nickname, avatar }),
  });
}

export async function apiUpdateProfile(
  token: string,
  patch: { nickname?: string; avatar?: string; phone?: string },
) {
  return request<{ user: AuthUser }>(
    '/profile',
    { method: 'PATCH', body: JSON.stringify(patch) },
    token,
  );
}

export const QUOTA_EXCEEDED_HINT =
  '您目前账户的限额已经使用完，请明天更新后再来使用。如需更多帮助请联系万生19806651984。';

export function isQuotaExceededMessage(msg: string | undefined | null): boolean {
  if (!msg) return false;
  return (
    msg.includes('限额已经使用完') ||
    msg.includes('次数已用完') ||
    msg.includes('QuotaExceeded')
  );
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

export async function apiUpdateUser(
  token: string,
  id: string,
  patch: {
    note?: string;
    avatar?: string;
    phone?: string;
    imageEditDailyLimit?: number | null;
    modelGenDailyLimit?: number | null;
    password?: string;
  },
) {
  return request<{ user: AuthUser }>(
    `/users/${encodeURIComponent(id)}`,
    { method: 'PATCH', body: JSON.stringify(patch) },
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
  kind: 'imageEdit' | 'modelGen',
) {
  return request<{ user: AuthUser }>(
    '/track',
    { method: 'POST', body: JSON.stringify({ kind }) },
    token,
  );
}

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
