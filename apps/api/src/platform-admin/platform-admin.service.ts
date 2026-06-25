import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { TenantListQueryDto, UpdatePlatformRoleDto, UpdateTenantPlanDto, UpdateTenantUserRoleDto } from './platform-admin.dto';

@Injectable()
export class PlatformAdminService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
  ) {}

  async listTenants(query: TenantListQueryDto) {
    const q = (query.q || '').trim();
    return this.prisma.tenant.findMany({
      where: q
        ? {
            OR: [
              { name: { contains: q, mode: 'insensitive' } },
              { slug: { contains: q, mode: 'insensitive' } },
            ],
          }
        : undefined,
      orderBy: { createdAt: 'desc' },
      include: {
        _count: { select: { users: true, policies: true } },
      },
    });
  }

  async listTenantUsers(tenantId: string) {
    const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId } });
    if (!tenant) throw new NotFoundException('Tenant not found');
    return this.prisma.user.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        platformRole: true,
        createdAt: true,
      },
    });
  }

  async updateTenantPlan(actorUserId: string, tenantId: string, dto: UpdateTenantPlanDto) {
    const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId } });
    if (!tenant) throw new NotFoundException('Tenant not found');

    const updated = await this.prisma.tenant.update({
      where: { id: tenantId },
      data: {
        plan: dto.plan,
        billingStatus: dto.billingStatus,
        planExpiresAt: dto.planExpiresAt ? new Date(dto.planExpiresAt) : null,
      },
    });

    await this.audit.log({
      tenantId: tenantId,
      userId: actorUserId,
      action: 'platform_admin.tenant_plan.update',
      entityType: 'tenant',
      entityId: tenantId,
      details: {
        before: {
          plan: tenant.plan,
          billingStatus: (tenant as any).billingStatus,
          planExpiresAt: (tenant as any).planExpiresAt,
        },
        after: {
          plan: updated.plan,
          billingStatus: (updated as any).billingStatus,
          planExpiresAt: (updated as any).planExpiresAt,
        },
      },
    });

    return updated;
  }

  async updateTenantUserRole(actorUserId: string, tenantId: string, userId: string, dto: UpdateTenantUserRoleDto) {
    const target = await this.prisma.user.findFirst({ where: { id: userId, tenantId } });
    if (!target) throw new NotFoundException('User not found in tenant');

    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: { role: dto.role },
      select: { id: true, tenantId: true, role: true, email: true, name: true },
    });

    await this.audit.log({
      tenantId,
      userId: actorUserId,
      action: 'platform_admin.user_role.update',
      entityType: 'user',
      entityId: userId,
      details: { beforeRole: target.role, afterRole: updated.role },
    });

    return updated;
  }

  async updatePlatformRole(actorUserId: string, userId: string, dto: UpdatePlatformRoleDto) {
    const target = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!target) throw new NotFoundException('User not found');

    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: { platformRole: dto.platformRole },
      select: { id: true, tenantId: true, platformRole: true, email: true, name: true },
    });

    await this.audit.log({
      tenantId: target.tenantId,
      userId: actorUserId,
      action: 'platform_admin.platform_role.update',
      entityType: 'user',
      entityId: userId,
      details: { beforeRole: (target as any).platformRole, afterRole: updated.platformRole },
    });

    return updated;
  }
}

