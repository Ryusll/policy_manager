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
    url.includes('/auth/google') ||
    url.includes('/platform-branding'));

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
      const refreshToken = useAuthStore.getState().refreshToken;
      if (refreshToken) {
        try {
          const { data } = await axios.post('/api/auth/refresh', { refreshToken });
          useAuthStore.getState().setAccessToken(data.accessToken);
          original.headers.Authorization = 'Bearer ' + data.accessToken;
          return client(original);
        } catch {
          useAuthStore.getState().logout();
          window.location.href = '/login';
        }
      } else {
        useAuthStore.getState().logout();
        window.location.href = '/login';
      }
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