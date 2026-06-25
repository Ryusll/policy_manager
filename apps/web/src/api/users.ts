import client from './client';

export interface CreateUserPayload {
  email: string;
  password: string;
  name: string;
  role: 'admin' | 'editor' | 'viewer';
}

export type TenantUser = {
  id: string;
  email: string;
  name: string;
  role: string;
};

export const usersApi = {
  list: () => client.get<TenantUser[]>('/users').then((r) => r.data),
  create: (data: CreateUserPayload) => client.post('/users', data).then((r) => r.data),
};
