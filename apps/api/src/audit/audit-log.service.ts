import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import {
  AuditQueryInput,
  buildAuditQuery,
  buildAuditWhere,
  summarizeDetails,
} from './audit-query';

/** 정정 기록의 사유 — details.reason(문자열)만 */
const correctionReason = (details: unknown): string | null => {
  const r = details && typeof details === 'object' && !Array.isArray(details) ? (details as { reason?: unknown }).reason : null;
  return typeof r === 'string' ? r : null;
};

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
          correctsId: true,
          user: { select: { id: true, email: true, name: true } },
          // 이 기록을 정정한 기록 수(T-178) — 목록에 "정정됨"
          _count: { select: { correctedBy: { where: { tenantId } } } },
        },
      }),
      this.prisma.auditLog.count({ where: plan.where as any }),
    ]);

    return {
      rows: rows.map(({ details, _count, ...row }) => ({ ...row, correctedCount: _count.correctedBy, ...summarizeDetails(details) })),
      total,
      page: plan.page,
      limit: plan.limit,
    };
  }

  /**
   * 목록에서 뺀 `details` 본문. 펼칠 때만 받아 간다. 정정 사슬(T-178)도 함께 — 이 기록이 정정한 원 기록(corrects)과 이 기록을 정정한
   * 기록들(correctedBy, 정정 사유와 함께). 원 기록과 정정 기록은 대상(entity)이 다를 수 있어(후보 승인 ↔ 버전 철회) 대상이 아니라
   * corrects_id 로 잇는다.
   */
  async findOne(tenantId: string, id: string) {
    const actor = { select: { id: true, email: true, name: true } } as const;
    const link = { id: true, tenantId: true, action: true, entityType: true, entityId: true, createdAt: true, user: actor } as const;
    const row = await this.prisma.auditLog.findFirst({
      where: { id, tenantId },
      include: {
        user: actor,
        corrects: { select: link },
        correctedBy: { where: { tenantId }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], select: { ...link, details: true } },
      },
    });
    if (!row) throw new NotFoundException('감사 기록을 찾을 수 없습니다.');
    const { corrects, correctedBy, ...rest } = row;
    const strip = ({ tenantId: _t, ...l }: { tenantId: string } & Record<string, unknown>) => l;
    return {
      ...rest,
      corrects: corrects && corrects.tenantId === tenantId ? strip(corrects) : null,
      correctedBy: correctedBy.map(({ details, ...c }) => ({ ...strip(c), reason: correctionReason(details) })),
    };
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
