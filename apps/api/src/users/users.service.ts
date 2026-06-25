import { ConflictException, ForbiddenException, Injectable } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../common/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CreateUserDto } from './users.dto';
import { maxUsersForPlan } from '../common/plan-limits';

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
}
