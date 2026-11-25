import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../common/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { generateTemporaryPassword } from '../common/temp-password';
import {
  CreateTenantDto,
  TenantListQueryDto,
  UpdatePlatformRoleDto,
  UpdateTenantPlanDto,
  UpdateTenantUserRoleDto,
} from './platform-admin.dto';

@Injectable()
export class PlatformAdminService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
  ) {}

  /**
   * 고객사 개설 + 마스터 계정 발급 (T-122).
   *
   * 이 제품의 고객사는 아스트룸이 계약 후 여기서 연다(공개 회원가입은 운영에서 닫혀 있다).
   * 마스터는 그 회사의 첫 관리자이고, 직원 계정은 마스터가 발급한다. 임시 비밀번호는 응답으로
   * **한 번만** 돌려준다 — 저장하지 않으므로 다시 볼 수 없고, 잃어버리면 재설정한다.
   */
  async createTenant(actorUserId: string | null, dto: CreateTenantDto) {
    const exists = await this.prisma.tenant.findUnique({ where: { slug: dto.slug }, select: { id: true } });
    if (exists) throw new ConflictException('이미 쓰고 있는 조직 코드입니다.');

    const temporaryPassword = generateTemporaryPassword();
    const passwordHash = await bcrypt.hash(temporaryPassword, 10);
    const plan = dto.plan ?? 'starter';

    let created: { tenant: { id: string; name: string; slug: string; plan: string }; master: { id: string; email: string; name: string } };
    try {
      created = await this.prisma.$transaction(async (tx) => {
        const tenant = await tx.tenant.create({
          data: { name: dto.name, slug: dto.slug, plan },
          select: { id: true, name: true, slug: true, plan: true },
        });
        const master = await tx.user.create({
          data: {
            tenantId: tenant.id,
            email: dto.masterEmail,
            name: dto.masterName,
            role: 'admin',
            passwordHash,
            // 아스트룸이 정한 비밀번호다 — 마스터가 처음 로그인할 때 바꾼다
            mustChangePassword: true,
          },
          select: { id: true, email: true, name: true },
        });
        return { tenant, master };
      });
    } catch (e) {
      // 위의 확인과 생성 사이에 같은 코드로 누가 먼저 만든 경우
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException('이미 쓰고 있는 조직 코드입니다.');
      }
      throw e;
    }

    await this.audit.log({
      tenantId: created.tenant.id,
      userId: actorUserId,
      action: 'platform_admin.tenant.create',
      entityType: 'tenant',
      entityId: created.tenant.id,
      // 임시 비밀번호는 기록하지 않는다
      details: { slug: created.tenant.slug, plan, masterEmail: created.master.email },
    });

    return { ...created, temporaryPassword };
  }

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

