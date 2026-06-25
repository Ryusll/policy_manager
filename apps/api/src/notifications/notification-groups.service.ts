import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import {
  CreateNotificationGroupDto,
  UpdateNotificationGroupDto,
} from './notifications.dto';

@Injectable()
export class NotificationGroupsService {
  constructor(private prisma: PrismaService) {}

  async list(tenantId: string) {
    const rows = await this.prisma.notificationGroup.findMany({
      where: { tenantId },
      orderBy: { name: 'asc' },
      include: {
        members: {
          include: {
            user: { select: { id: true, name: true, email: true, role: true } },
          },
        },
      },
    });
    return rows.map((g) => ({
      id: g.id,
      name: g.name,
      createdAt: g.createdAt,
      updatedAt: g.updatedAt,
      members: g.members.map((m) => m.user),
    }));
  }

  async create(tenantId: string, dto: CreateNotificationGroupDto) {
    const name = dto.name.trim();
    const existing = await this.prisma.notificationGroup.findUnique({
      where: { tenantId_name: { tenantId, name } },
    });
    if (existing) throw new ConflictException('같은 이름의 알림 팀이 이미 있습니다.');

    const userIds = await this.validateUserIds(tenantId, dto.userIds || []);
    const group = await this.prisma.notificationGroup.create({
      data: {
        tenantId,
        name,
        members: {
          create: userIds.map((userId) => ({ userId })),
        },
      },
      include: {
        members: {
          include: {
            user: { select: { id: true, name: true, email: true, role: true } },
          },
        },
      },
    });
    return {
      id: group.id,
      name: group.name,
      members: group.members.map((m) => m.user),
    };
  }

  async update(tenantId: string, groupId: string, dto: UpdateNotificationGroupDto) {
    const group = await this.prisma.notificationGroup.findFirst({
      where: { id: groupId, tenantId },
    });
    if (!group) throw new NotFoundException('알림 팀을 찾을 수 없습니다.');

    if (dto.name !== undefined) {
      const name = dto.name.trim();
      const dup = await this.prisma.notificationGroup.findFirst({
        where: { tenantId, name, id: { not: groupId } },
      });
      if (dup) throw new ConflictException('같은 이름의 알림 팀이 이미 있습니다.');
      await this.prisma.notificationGroup.update({
        where: { id: groupId },
        data: { name },
      });
    }

    if (dto.userIds !== undefined) {
      const userIds = await this.validateUserIds(tenantId, dto.userIds);
      await this.prisma.notificationGroupMember.deleteMany({ where: { groupId } });
      if (userIds.length) {
        await this.prisma.notificationGroupMember.createMany({
          data: userIds.map((userId) => ({ groupId, userId })),
        });
      }
    }

    return this.list(tenantId).then((rows) => rows.find((r) => r.id === groupId));
  }

  async remove(tenantId: string, groupId: string) {
    const group = await this.prisma.notificationGroup.findFirst({
      where: { id: groupId, tenantId },
    });
    if (!group) throw new NotFoundException('알림 팀을 찾을 수 없습니다.');
    await this.prisma.notificationGroup.delete({ where: { id: groupId } });
    return { ok: true };
  }

  private async validateUserIds(tenantId: string, userIds: string[]) {
    if (!userIds.length) return [];
    const users = await this.prisma.user.findMany({
      where: { tenantId, id: { in: userIds } },
      select: { id: true },
    });
    return users.map((u) => u.id);
  }
}
