import axios, { type AxiosError, type InternalAxiosRequestConfig } from 'axios';
import { useAuthStore } from '../stores/authStore';

const client = axios.create({
  baseURL: '/api',
  headers: { 'Content-Type': 'application/json' },
});

client.interceptors.request.use((config) => {
  const token = useAuthStore.getState().accessToken;
  if (token) config.headers.Authorization = 'Bearer ' + token;
  return config;
});

const isPublicAuthRequest = (url: string | undefined) =>
  !!url &&
  (url.includes('/auth/login') ||
    url.includes('/auth/register') ||
    url.includes('/platform-branding'));

/** 저장소의 최신 로그인 정보 — 다른 탭이 방금 갱신했을 수 있다 */
function readStoredTokens(): { accessToken: string | null; refreshToken: string | null } | null {
  try {
    const raw = localStorage.getItem('auth-storage');
    if (!raw) return null;
    const state = JSON.parse(raw)?.state;
    return { accessToken: state?.accessToken ?? null, refreshToken: state?.refreshToken ?? null };
  } catch {
    return null;
  }
}

/** 여러 탭이 같은 갱신 토큰으로 동시에 갱신하지 않게 브라우저 전체에서 한 번에 하나씩 */
function withRefreshLock<T>(fn: () => Promise<T>): Promise<T> {
  // Web Locks 가 없는 오래된 브라우저는 탭 안에서만 한 번으로 묶는다(같은 탭 동시 요청은 inflight 가 막는다)
  if (typeof navigator !== 'undefined' && navigator.locks?.request) {
    return navigator.locks.request('pm-auth-refresh', () => fn()) as Promise<T>;
  }
  return fn();
}

let inflight: Promise<string | null> | null = null;

/**
 * 접근 토큰 갱신 (T-137).
 *
 * 서버는 갱신할 때마다 **갱신 토큰도 새로 주고 옛 것은 막는다**(회전, T-42). 예전 화면은 새 갱신
 * 토큰을 버리고 처음 받은 것을 계속 내서, 로그인 30분쯤 뒤 두 번째 갱신이 거절돼 로그인 화면으로
 * 튕겼다. 이제 둘 다 저장하고, 같은 탭의 동시 요청은 한 번만, 다른 탭과는 잠금으로 순서대로 갱신한다.
 * 다른 탭이 먼저 갱신했으면 저장소의 새 토큰을 그대로 쓴다.
 */
export function refreshAccessToken(staleAccessToken: string | null): Promise<string | null> {
  if (!inflight) {
    inflight = withRefreshLock(async () => {
      const stored = readStoredTokens();
      if (stored?.accessToken && stored.accessToken !== staleAccessToken) {
        useAuthStore.getState().setTokens(stored.accessToken, stored.refreshToken);
        return stored.accessToken;
      }
      const refreshToken = stored?.refreshToken ?? useAuthStore.getState().refreshToken;
      if (!refreshToken) return null;
      try {
        const { data } = await axios.post('/api/auth/refresh', { refreshToken });
        useAuthStore.getState().setTokens(data.accessToken, data.refreshToken);
        return data.accessToken as string;
      } catch {
        return null;
      }
    }).finally(() => {
      inflight = null;
    });
  }
  return inflight;
}

client.interceptors.response.use(
  (res) => res,
  async (error: AxiosError) => {
    // `_retry` 는 우리가 붙이는 표시다 — 같은 요청으로 무한히 갱신을 돌지 않게 한다.
    const original = error.config as (InternalAxiosRequestConfig & { _retry?: boolean }) | undefined;
    if (
      error.response?.status === 401 &&
      original &&
      !original._retry &&
      !isPublicAuthRequest(original.url)
    ) {
      original._retry = true;
      const sent = String(original.headers?.Authorization ?? '').replace(/^Bearer /, '') || null;
      const token = await refreshAccessToken(sent ?? useAuthStore.getState().accessToken);
      if (token) {
        original.headers.Authorization = 'Bearer ' + token;
        return client(original);
      }
      useAuthStore.getState().logout();
      window.location.href = '/login';
    }
    // 다른 곳(관리자 재설정 등)에서 변경 필요 상태가 됐다 — 화면을 비밀번호 변경으로 돌린다(T-122)
    const code = (error.response?.data as { code?: string } | undefined)?.code;
    if (error.response?.status === 403 && code === 'PASSWORD_CHANGE_REQUIRED') {
      const { user, setUser } = useAuthStore.getState();
      if (user && !user.mustChangePassword) setUser({ ...user, mustChangePassword: true });
    }
    return Promise.reject(error);
  },
);

export default client;