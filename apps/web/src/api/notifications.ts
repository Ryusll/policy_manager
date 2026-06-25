import client from './client';

export type UserNotification = {
  id: string;
  kind: string;
  title: string;
  body: string;
  policyId: string | null;
  articleId: string | null;
  versionId: string | null;
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
