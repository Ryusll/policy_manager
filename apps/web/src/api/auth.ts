import client from './client';

export interface LoginPayload {
  email: string;
  password: string;
  tenantSlug?: string;
  /** 자동 로그인 — 30일 유지(T-137) */
  remember?: boolean;
}

export interface RegisterPayload {
  tenantName: string;
  tenantSlug: string;
  email: string;
  password: string;
  name: string;
}

export const authApi = {
  login: (data: LoginPayload) => client.post('/auth/login', data).then((r) => r.data),
  register: (data: RegisterPayload) => client.post('/auth/register', data).then((r) => r.data),
  logout: () => client.post('/auth/logout'),
  me: () => client.post('/auth/me').then((r) => r.data),
  /** 로그인 화면 설정 — 공개 회원가입이 열려 있는지(운영은 닫힘, T-122) */
  options: (): Promise<{ publicSignup: boolean }> => client.get('/auth/options').then((r) => r.data),
};