import { create } from 'zustand';
import {
  apiLogin,
  apiMe,
  apiRegister,
  apiTrackUsage,
  apiUpdateProfile,
  isEditQuotaExhausted,
  isQuotaExceededMessage,
  type AuthUser,
  type QuotaModalKind,
} from '../api/authApi';

const STORAGE_KEY = 'aurora-auth-v2';

interface PersistedAuth {
  token: string;
  user: AuthUser;
}

function loadPersisted(): PersistedAuth | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PersistedAuth;
    if (!parsed?.token || !parsed?.user?.username) return null;
    return parsed;
  } catch {
    return null;
  }
}

function persist(data: PersistedAuth | null) {
  try {
    if (!data) localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {
    /* ignore */
  }
}

function displayName(user: AuthUser | null | undefined): string | null {
  if (!user) return null;
  return (user.nickname || user.username || '').trim() || user.username;
}

const initial = loadPersisted();

interface AuthState {
  token: string | null;
  user: AuthUser | null;
  /** display name for TopBar / AuthGuard (nickname preferred) */
  username: string | null;
  loginOpen: boolean;
  busy: boolean;
  quotaOpen: boolean;
  quotaModalKind: QuotaModalKind;
  openLogin: () => void;
  closeLogin: () => void;
  openQuotaModal: (kind?: QuotaModalKind) => void;
  closeQuotaModal: () => void;
  notifyQuotaError: (message?: string) => boolean;
  /** After image-edit 403: switch-to-Qwen or all-exhausted modal. */
  handleEditQuotaError: (model?: string | null) => Promise<void>;
  login: (
    username: string,
    password: string,
  ) => Promise<{ ok: true } | { ok: false; error: string }>;
  register: (
    username: string,
    password: string,
    phone: string,
    nickname: string,
    avatar: string | undefined,
    smsCode: string,
  ) => Promise<{ ok: true } | { ok: false; error: string }>;
  updateProfile: (patch: {
    nickname?: string;
    avatar?: string;
    phone?: string;
    smsCode?: string;
  }) => Promise<{ ok: true } | { ok: false; error: string }>;
  logout: () => void;
  requireAuth: () => boolean;
  isAdmin: () => boolean;
  refreshMe: () => Promise<void>;
  trackUsage: (
    kind: 'geminiEdit' | 'qwenEdit' | 'modelGen',
  ) => Promise<{ ok: true } | { ok: false; error: string }>;
  setUser: (user: AuthUser) => void;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  token: initial?.token ?? null,
  user: initial?.user ?? null,
  username: displayName(initial?.user) ?? null,
  loginOpen: false,
  busy: false,
  quotaOpen: false,
  quotaModalKind: 'allExhausted',

  openLogin: () => set({ loginOpen: true }),
  closeLogin: () => set({ loginOpen: false }),
  openQuotaModal: (kind = 'allExhausted') =>
    set({ quotaOpen: true, quotaModalKind: kind }),
  closeQuotaModal: () =>
    set({ quotaOpen: false, quotaModalKind: 'allExhausted' }),
  notifyQuotaError: (message) => {
    if (!isQuotaExceededMessage(message)) return false;
    set({ quotaOpen: true, quotaModalKind: 'allExhausted' });
    return true;
  },

  handleEditQuotaError: async (model) => {
    try {
      await get().refreshMe();
    } catch {
      /* keep cached user */
    }
    const user = get().user;
    if (!user || user.role === 'admin') return;

    const failedGemini = model !== 'qwen-image';
    const qwenDone = isEditQuotaExhausted(user, 'qwen');
    const geminiDone = isEditQuotaExhausted(user, 'gemini');

    if (failedGemini) {
      // Gemini just rejected — treat as exhausted even if client count lags.
      if (qwenDone) {
        set({ quotaOpen: true, quotaModalKind: 'allExhausted' });
      } else {
        set({ quotaOpen: true, quotaModalKind: 'switchToQwen' });
      }
      return;
    }

    // Qwen rejected: only show the full-exhausted dialog when Gemini is also out.
    if (geminiDone) {
      set({ quotaOpen: true, quotaModalKind: 'allExhausted' });
    }
  },

  login: async (username, password) => {
    set({ busy: true });
    try {
      const { token, user } = await apiLogin(username, password);
      persist({ token, user });
      set({
        token,
        user,
        username: displayName(user),
        loginOpen: false,
        busy: false,
      });
      void import('./useAppStore').then((m) =>
        m.useAppStore.getState().hydrateFromRemote(),
      );
      return { ok: true };
    } catch (err) {
      set({ busy: false });
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  },

  register: async (username, password, phone, nickname, avatar, smsCode) => {
    set({ busy: true });
    try {
      const { token, user } = await apiRegister(
        username,
        password,
        phone,
        nickname,
        avatar,
        smsCode,
      );
      persist({ token, user });
      set({
        token,
        user,
        username: displayName(user),
        loginOpen: false,
        busy: false,
      });
      void import('./useAppStore').then((m) =>
        m.useAppStore.getState().hydrateFromRemote(),
      );
      return { ok: true };
    } catch (err) {
      set({ busy: false });
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  },

  updateProfile: async (patch) => {
    const token = get().token;
    if (!token) return { ok: false, error: '请先登录' };
    set({ busy: true });
    try {
      const { user } = await apiUpdateProfile(token, patch);
      persist({ token, user });
      set({ user, username: displayName(user), busy: false });
      return { ok: true };
    } catch (err) {
      set({ busy: false });
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  },

  logout: () => {
    persist(null);
    set({
      token: null,
      user: null,
      username: null,
      quotaOpen: false,
      quotaModalKind: 'allExhausted',
    });
    void import('./useAppStore').then((m) =>
      m.useAppStore.getState().resetFormalProjects(),
    );
  },

  requireAuth: () => {
    if (get().token && get().user) return true;
    set({ loginOpen: true });
    return false;
  },

  isAdmin: () => get().user?.role === 'admin',

  refreshMe: async () => {
    const token = get().token;
    if (!token) return;
    try {
      const { user } = await apiMe(token);
      persist({ token, user });
      set({ user, username: displayName(user) });
    } catch {
      persist(null);
      set({ token: null, user: null, username: null });
    }
  },

  trackUsage: async (kind) => {
    const token = get().token;
    if (!token) return { ok: false, error: '请先登录' };
    try {
      const { user } = await apiTrackUsage(token, kind);
      persist({ token, user });
      set({ user, username: displayName(user) });
      return { ok: true };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      get().notifyQuotaError(error);
      return { ok: false, error };
    }
  },

  setUser: (user) => {
    const token = get().token;
    if (!token) return;
    persist({ token, user });
    set({ user, username: displayName(user) });
  },
}));
