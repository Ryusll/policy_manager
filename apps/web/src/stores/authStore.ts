import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { hasBrowserSession, markBrowserSession } from '../lib/browserSession';

interface User {
  id: string;
  email: string;
  name: string;
  role: string;
  platformRole?: string;
  /** 남이 정해 준 비밀번호로 들어왔다 — 바꾸기 전에는 비밀번호 변경 화면만 보인다(T-122) */
  mustChangePassword?: boolean;
  tenantId: string;
  tenantSlug: string;
  tenantName: string;
  plan: string;
  planExpiresAt?: string | null;
  billingStatus?: string;
}

interface AuthState {
  user: User | null;
  accessToken: string | null;
  refreshToken: string | null;
  /**
   * 자동 로그인으로 들어왔는가(T-137). 아니면 브라우저를 닫을 때 로그인 정보를 지운다.
   * `null` 은 T-137 전에 저장된 로그인 정보다 — 지금 켜져 있는 브라우저의 로그인으로 이어 준다.
   */
  remember: boolean | null;
  isAuthenticated: boolean;
  hasHydrated: boolean;
  setAuth: (user: User, accessToken: string, refreshToken: string, remember?: boolean) => void;
  /** 갱신 때마다 갱신 토큰도 새로 받는다(회전) — 둘 다 바꿔야 다음 갱신이 통한다 */
  setTokens: (accessToken: string, refreshToken: string | null) => void;
  setRemember: (remember: boolean) => void;
  setUser: (user: User) => void;
  updateUserPlan: (plan: string) => void;
  setAccessToken: (token: string) => void;
  setHasHydrated: (v: boolean) => void;
  logout: () => void;
}

const SIGNED_OUT = { user: null, accessToken: null, refreshToken: null, remember: null, isAuthenticated: false };

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      ...SIGNED_OUT,
      hasHydrated: false,
      setAuth: (user, accessToken, refreshToken, remember = false) => {
        markBrowserSession();
        set({ user, accessToken, refreshToken, remember, isAuthenticated: true });
      },
      setTokens: (accessToken, refreshToken) =>
        set((state) => ({ accessToken, refreshToken: refreshToken ?? state.refreshToken })),
      setRemember: (remember) => set({ remember }),
      setUser: (user) =>
        set((state) => ({ ...state, user })),
      updateUserPlan: (plan) =>
        set((state) => ({
          ...state,
          user: state.user ? { ...state.user, plan } : state.user,
        })),
      setAccessToken: (token) => set({ accessToken: token }),
      setHasHydrated: (v) => set({ hasHydrated: v }),
      logout: () => set({ ...SIGNED_OUT }),
    }),
    {
      name: 'auth-storage',
      storage: createJSONStorage(() => ({
        getItem: (name: string) => localStorage.getItem(name),
        setItem: (name: string, value: string) => {
          try {
            localStorage.setItem(name, value);
          } catch {
            // Quota exceeded 등 저장 실패 시 런타임 로그인 흐름은 유지
          }
        },
        removeItem: (name: string) => localStorage.removeItem(name),
      })),
      partialize: (state) => ({
        user: state.user,
        accessToken: state.accessToken,
        refreshToken: state.refreshToken,
        remember: state.remember,
        isAuthenticated: state.isAuthenticated,
      }),
      onRehydrateStorage: () => (state) => {
        if (state?.isAuthenticated) {
          if (state.remember === null) {
            // T-137 전에 저장된 로그인 — 지금 브라우저의 로그인으로 이어 주고, 다음부터 규칙을 따른다
            markBrowserSession();
            state.setRemember(false);
          } else if (!state.remember && !hasBrowserSession()) {
            // 브라우저를 다시 켰다 — 자동 로그인이 아니면 다시 로그인한다
            state.logout();
          }
        }
        state?.setHasHydrated(true);
      },
    },
  ),
);

// 다른 탭에서 로그인·갱신·로그아웃하면 이 탭도 따라간다. 갱신 토큰은 한 번 쓰면 바뀌므로(회전)
// 탭마다 옛 값을 들고 있으면 늦게 갱신하는 탭이 거절당해 튕긴다.
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key === 'auth-storage') void useAuthStore.persist.rehydrate();
  });
}
