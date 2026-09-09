import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import {
  AuditQueryInput,
  buildAuditQuery,
  buildAuditWhere,
  summarizeDetails,
} from './audit-query';

/** 감사 로그 조회 (T-11). 기록은 `AuditService`, 읽기는 여기. */
@Injectable()
export class AuditLogService {
  constructor(private prisma: PrismaService) {}

  async list(tenantId: string, input: AuditQueryInput) {
    const plan = buildAuditQuery(tenantId, input);
    const [rows, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where: plan.where as any,
        orderBy: { createdAt: 'desc' },
        skip: plan.skip,
        take: plan.take,
        select: {
          id: true,
          action: true,
          entityType: true,
          entityId: true,
          createdAt: true,
          details: true,
          user: { select: { id: true, email: true, name: true } },
        },
      }),
      this.prisma.auditLog.count({ where: plan.where as any }),
    ]);

    return {
      rows: rows.map(({ details, ...row }) => ({ ...row, ...summarizeDetails(details) })),
      total,
      page: plan.page,
      limit: plan.limit,
    };
  }

  /** 목록에서 뺀 `details` 본문. 펼칠 때만 받아 간다. */
  async findOne(tenantId: string, id: string) {
    const row = await this.prisma.auditLog.findFirst({
      where: { id, tenantId },
      include: { user: { select: { id: true, email: true, name: true } } },
    });
    if (!row) throw new NotFoundException('감사 기록을 찾을 수 없습니다.');
    return row;
  }

  /**
   * 필터 드롭다운 재료. 액션 이름 전체 목록이 아니라 **이 회사에 실제로 쌓인 것**만 준다 —
   * 쓰지도 않는 29가지를 늘어놓으면 고르기만 어려워진다.
   */
  async listActions(tenantId: string) {
    const rows = await this.prisma.auditLog.groupBy({
      by: ['action'],
      where: { tenantId },
      _count: { action: true },
      orderBy: { action: 'asc' },
    });
    return rows.map((r) => ({ action: r.action, count: r._count.action }));
  }

  /** 필터에 쓸 사용자 목록 — 기록을 남긴 적 있는 사람만 */
  async listActors(tenantId: string) {
    const rows = await this.prisma.auditLog.findMany({
      where: { ...buildAuditWhere(tenantId, {}), userId: { not: null } },
      distinct: ['userId'],
      select: { user: { select: { id: true, email: true, name: true } } },
    });
    return rows
      .map((r) => r.user)
      .filter((u): u is { id: string; email: string; name: string } => !!u)
      .sort((a, b) => a.name.localeCompare(b.name, 'ko'));
  }
}
