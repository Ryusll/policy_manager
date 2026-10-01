import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../common/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CreateUserDto, UpdateMyProfileDto, UpdateUserDto } from './users.dto';
import { maxUsersForPlan } from '../common/plan-limits';
import { diffUserUpdate, hasChanges, removesLastAdmin, UserUpdateInput } from './user-update';

@Injectable()
export class UsersService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
  ) {}

  async list(tenantId: string) {
    return this.prisma.user.findMany({
      where: { tenantId },
      orderBy: { name: 'asc' },
      select: { id: true, email: true, name: true, role: true, createdAt: true },
    });
  }

  async create(tenantId: string, actorUserId: string, dto: CreateUserDto) {
    const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId } });
    if (!tenant) throw new ForbiddenException('Tenant not found');

    const count = await this.prisma.user.count({ where: { tenantId } });
    const max = maxUsersForPlan(tenant.plan);
    if (count >= max) {
      throw new ForbiddenException(`User limit reached for plan (${max})`);
    }

    const existing = await this.prisma.user.findUnique({
      where: { tenantId_email: { tenantId, email: dto.email } },
    });
    if (existing) throw new ConflictException('Email already exists in this organization');

    const passwordHash = await bcrypt.hash(dto.password, 10);
    const user = await this.prisma.user.create({
      data: {
        tenantId,
        email: dto.email,
        passwordHash,
        name: dto.name,
        role: dto.role,
      },
    });

    await this.audit.log({
      tenantId,
      userId: actorUserId,
      action: 'user.invited',
      entityType: 'user',
      entityId: user.id,
      details: { email: user.email, role: user.role },
    });

    return {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
    };
  }

  /** 내 정보(이름) 수정 — 역할 제한 없음 */
  updateMe(tenantId: string, userId: string, dto: UpdateMyProfileDto) {
    return this.applyUpdate(tenantId, userId, userId, { name: dto.name });
  }

  /** 같은 기관 사용자의 이름·이메일·역할 수정 — 컨트롤러가 admin 만 통과시킨다 */
  update(tenantId: string, actorUserId: string, targetId: string, dto: UpdateUserDto) {
    if (dto.name === undefined && dto.email === undefined && dto.role === undefined) {
      throw new BadRequestException('변경할 항목이 없습니다.');
    }
    return this.applyUpdate(tenantId, actorUserId, targetId, dto);
  }

  private async applyUpdate(
    tenantId: string,
    actorUserId: string,
    targetId: string,
    input: UserUpdateInput,
  ) {
    const { user, changes } = await this.prisma.$transaction(async (tx) => {
      // 같은 조직의 사용자 변경을 한 줄로 세운다. 두 관리자가 동시에 서로를 강등하면
      // 둘 다 "관리자가 아직 2명"으로 보고 통과해 0명이 될 수 있다.
      // FOR UPDATE 가 아니라 NO KEY UPDATE 인 이유: 감사 로그 INSERT 의 외래키 검사가
      // 잡는 KEY SHARE 잠금과 부딪히지 않는다.
      await tx.$queryRaw`SELECT id FROM tenants WHERE id = ${tenantId} FOR NO KEY UPDATE`;

      // tenantId 를 함께 걸어, 다른 조직 사용자는 "없음"과 똑같이 404 로 답한다
      const target = await tx.user.findFirst({ where: { id: targetId, tenantId } });
      if (!target) throw new NotFoundException('사용자를 찾을 수 없습니다.');

      const changes = diffUserUpdate(target, input);
      if (!hasChanges(changes)) return { user: target, changes };

      if (changes.email) {
        // 옛 계정에 대문자가 섞여 있어도 로그인은 소문자로 찾으므로 대소문자 무시로 비교한다
        const dup = await tx.user.findFirst({
          where: {
            tenantId,
            id: { not: targetId },
            email: { equals: changes.email.after, mode: 'insensitive' },
          },
          select: { id: true },
        });
        if (dup) throw new ConflictException('이 조직에 이미 같은 이메일이 있습니다.');
      }

      if (changes.role) {
        const adminCount = await tx.user.count({ where: { tenantId, role: 'admin' } });
        if (removesLastAdmin(changes, adminCount)) {
          throw new ConflictException(
            '조직의 마지막 관리자입니다. 먼저 다른 사용자를 관리자로 지정하세요.',
          );
        }
      }

      const updated = await tx.user.update({
        where: { id: targetId },
        data: {
          name: changes.name?.after,
          email: changes.email?.after,
          role: changes.role?.after as Role | undefined,
        },
      });
      return { user: updated, changes };
    });

    // 감사 로그는 트랜잭션 밖에서 남긴다 — 위 잠금을 잡은 채 다른 연결로 INSERT 하지 않는다
    const self = actorUserId === targetId;
    if (changes.name || changes.email) {
      await this.audit.log({
        tenantId,
        userId: actorUserId,
        action: 'user.updated',
        entityType: 'user',
        entityId: targetId,
        details: {
          self,
          changes: {
            ...(changes.name ? { name: changes.name } : {}),
            ...(changes.email ? { email: changes.email } : {}),
          },
        },
      });
    }
    if (changes.role) {
      await this.audit.log({
        tenantId,
        userId: actorUserId,
        action: 'user.role_changed',
        entityType: 'user',
        entityId: targetId,
        details: { self, beforeRole: changes.role.before, afterRole: changes.role.after },
      });
    }

    return { id: user.id, email: user.email, name: user.name, role: user.role };
  }
}
