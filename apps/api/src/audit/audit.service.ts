import { Injectable } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';

@Injectable()
export class AuditService {
  constructor(private prisma: PrismaService) {}

  async log(params: {
    tenantId: string;
    userId?: string | null;
    action: string;
    entityType: string;
    entityId?: string | null;
    details?: Record<string, unknown>;
  }) {
    return this.prisma.auditLog.create({
      data: {
        tenantId: params.tenantId,
        userId: params.userId ?? undefined,
        action: params.action,
        entityType: params.entityType,
        entityId: params.entityId ?? undefined,
        details: params.details as object | undefined,
      },
    });
  }
}
