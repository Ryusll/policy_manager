import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';

@Injectable()
export class NotificationsService {
  constructor(private prisma: PrismaService) {}

  async listForUser(tenantId: string, userId: string, limit = 40) {
    const rows = await this.prisma.userNotification.findMany({
      where: { tenantId, userId },
      orderBy: { createdAt: 'desc' },
      take: Math.min(limit, 100),
    });
    return rows;
  }

  async unreadCount(tenantId: string, userId: string) {
    return this.prisma.userNotification.count({
      where: { tenantId, userId, readAt: null },
    });
  }

  async markRead(tenantId: string, userId: string, notificationId: string) {
    const row = await this.prisma.userNotification.findFirst({
      where: { id: notificationId, tenantId, userId },
    });
    if (!row) throw new NotFoundException('알림을 찾을 수 없습니다.');
    return this.prisma.userNotification.update({
      where: { id: notificationId },
      data: { readAt: new Date() },
    });
  }

  async markAllRead(tenantId: string, userId: string) {
    await this.prisma.userNotification.updateMany({
      where: { tenantId, userId, readAt: null },
      data: { readAt: new Date() },
    });
    return { ok: true };
  }
}
