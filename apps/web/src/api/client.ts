import axios from 'axios';
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
  async (error) => {
    const original = error.config;
    if (
      error.response?.status === 401 &&
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
    return Promise.reject(error);
  },
);

export default client;