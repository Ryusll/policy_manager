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

/** 관리자가 보내는 수정 항목 — 보낸 것만 바뀐다 */
export type UpdateUserPayload = Partial<Pick<CreateUserPayload, 'name' | 'email' | 'role'>>;

export const usersApi = {
  list: () => client.get<TenantUser[]>('/users').then((r) => r.data),
  create: (data: CreateUserPayload) => client.post('/users', data).then((r) => r.data),
  /** 내 이름 수정 — 모든 역할 */
  updateMe: (data: { name: string }) =>
    client.patch<TenantUser>('/users/me', data).then((r) => r.data),
  /** 같은 기관 사용자의 이름·이메일·역할 수정 — 관리자 전용 */
  update: (id: string, data: UpdateUserPayload) =>
    client.patch<TenantUser>(`/users/${id}`, data).then((r) => r.data),
};
