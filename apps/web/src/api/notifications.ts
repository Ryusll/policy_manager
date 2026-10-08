import client from './client';

export type UserNotification = {
  id: string;
  kind: string;
  title: string;
  body: string;
  policyId: string | null;
  articleId: string | null;
  versionId: string | null;
  /** 규정이 아닌 화면으로 가는 알림의 이동 경로(예: 법령 개정 후보 → 법령 화면) */
  link: string | null;
  readAt: string | null;
  createdAt: string;
};

export const notificationsApi = {
  list: (limit = 40) =>
    client.get<UserNotification[]>('/notifications', { params: { limit } }).then((r) => r.data),
  unreadCount: () =>
    client.get<{ count: number }>('/notifications/unread-count').then((r) => r.data),
  markRead: (id: string) => client.patch(`/notifications/${id}/read`).then((r) => r.data),
  markAllRead: () => client.post('/notifications/read-all').then((r) => r.data),
};
