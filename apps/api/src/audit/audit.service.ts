import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';

export type AuditEntry = {
  tenantId: string;
  userId?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  details?: Record<string, unknown>;
};

/** 감사 기록을 쓸 곳 — 저장 트랜잭션(tx)을 넘기면 본문과 함께 확정·롤백된다(T-135). 넘기지 않으면 따로 바로 쓴다 */
type AuditDb = Pick<Prisma.TransactionClient, 'auditLog'>;

const auditRow = (params: AuditEntry) => ({
  tenantId: params.tenantId,
  userId: params.userId ?? undefined,
  action: params.action,
  entityType: params.entityType,
  entityId: params.entityId ?? undefined,
  details: params.details as object | undefined,
});

@Injectable()
export class AuditService {
  constructor(private prisma: PrismaService) {}

  async log(params: AuditEntry, db: AuditDb = this.prisma) {
    return db.auditLog.create({ data: auditRow(params) });
  }

  /** 여러 건을 한 번에(가져오기 확정의 장·절처럼 많을 때) */
  async logMany(entries: AuditEntry[], db: AuditDb = this.prisma) {
    if (!entries.length) return;
    await db.auditLog.createMany({ data: entries.map(auditRow) });
  }
}
