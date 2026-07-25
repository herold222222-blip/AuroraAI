import { create } from 'zustand';

const STORAGE_KEY = 'aurora-demo-auth';
export const DEMO_USERNAME = 'Aurora';
export const DEMO_PASSWORD = 'LXWX0428';

function loadUser(): string | null {
  try {
    const v = sessionStorage.getItem(STORAGE_KEY);
    return v && v.trim() ? v : null;
  } catch {
    return null;
  }
}

interface AuthState {
  user: string | null;
  loginOpen: boolean;
  openLogin: () => void;
  closeLogin: () => void;
  login: (username: string, password: string) => { ok: true } | { ok: false; error: string };
  logout: () => void;
  /** Returns true if already logged in; otherwise opens login modal and returns false. */
  requireAuth: () => boolean;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: loadUser(),
  loginOpen: false,

  openLogin: () => set({ loginOpen: true }),
  closeLogin: () => set({ loginOpen: false }),

  login: (username, password) => {
    const u = username.trim();
    const p = password;
    if (u === DEMO_USERNAME && p === DEMO_PASSWORD) {
      try {
        sessionStorage.setItem(STORAGE_KEY, u);
      } catch {
        /* ignore */
      }
      set({ user: u, loginOpen: false });
      return { ok: true };
    }
    return {
      ok: false,
      error: '账号或密码错误。如需获取访问权限，联系万生 19806651984',
    };
  },

  logout: () => {
    try {
      sessionStorage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
    set({ user: null });
  },

  requireAuth: () => {
    if (get().user) return true;
    set({ loginOpen: true });
    return false;
  },
}));
