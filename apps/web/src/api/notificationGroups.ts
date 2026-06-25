import client from './client';

export type NotificationGroupMember = {
  id: string;
  name: string;
  email: string;
  role: string;
};

export type NotificationGroup = {
  id: string;
  name: string;
  members: NotificationGroupMember[];
};

export const notificationGroupsApi = {
  list: () => client.get<NotificationGroup[]>('/notification-groups').then((r) => r.data),
  create: (data: { name: string; userIds?: string[] }) =>
    client.post<NotificationGroup>('/notification-groups', data).then((r) => r.data),
  update: (id: string, data: { name?: string; userIds?: string[] }) =>
    client.patch<NotificationGroup>(`/notification-groups/${id}`, data).then((r) => r.data),
  remove: (id: string) => client.delete(`/notification-groups/${id}`).then((r) => r.data),
};
