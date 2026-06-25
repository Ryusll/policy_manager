import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

interface User {
  id: string;
  email: string;
  name: string;
  role: string;
  platformRole?: string;
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
  isAuthenticated: boolean;
  hasHydrated: boolean;
  setAuth: (user: User, accessToken: string, refreshToken: string) => void;
  setUser: (user: User) => void;
  updateUserPlan: (plan: string) => void;
  setAccessToken: (token: string) => void;
  setHasHydrated: (v: boolean) => void;
  logout: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      accessToken: null,
      refreshToken: null,
      isAuthenticated: false,
      hasHydrated: false,
      setAuth: (user, accessToken, refreshToken) =>
        set({ user, accessToken, refreshToken, isAuthenticated: true }),
      setUser: (user) =>
        set((state) => ({ ...state, user })),
      updateUserPlan: (plan) =>
        set((state) => ({
          ...state,
          user: state.user ? { ...state.user, plan } : state.user,
        })),
      setAccessToken: (token) => set({ accessToken: token }),
      setHasHydrated: (v) => set({ hasHydrated: v }),
      logout: () =>
        set({ user: null, accessToken: null, refreshToken: null, isAuthenticated: false }),
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
      onRehydrateStorage: () => (state) => {
        state?.setHasHydrated(true);
      },
    },
  ),
);