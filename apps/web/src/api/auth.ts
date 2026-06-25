import client from './client';

export interface LoginPayload {
  email: string;
  password: string;
  tenantSlug?: string;
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
};