import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { AI_QA_CONSENT_SELECT, aiQaState, assertAskAllowed } from './ask-notice';
import { AI_QA_LOG_RETENTION_DAYS, retentionCutoff } from './ask-retention';
import { ASK_HISTORY_DETAIL_SELECT, ASK_HISTORY_LIST_SELECT, toHistoryDetail, toHistoryItem } from './ask-history';

/** 한 번에 내보내는 지난 질문 수 */
export const ASK_HISTORY_PAGE = 30;
export const ASK_HISTORY_PAGE_MAX = 50;

/**
 * 내 지난 질문(T-218, SRS SEARCH-10) — 질문 기록(`ai_qa_logs`)을 읽기만 한다. AI 를 부르지 않으므로 월 한도에 세지 않는다.
 *
 * - 본인 것만: 회사·사용자로 건다. 관리자도 남의 질문은 보지 못하고, 다른 사람·다른 회사의 것은 없는 것과 같은 404 다.
 * - 보관 기간(90일) 안의 것만: 파기는 하루 한 번이라 지나고도 하루쯤 남을 수 있어 읽을 때도 같은 기준으로 자른다.
 * - 꺼진 회사·고지 재확인을 기다리는 회사는 지난 질문도 열지 않는다(질문과 같은 403).
 */
@Injectable()
export class AskHistoryService {
  constructor(private readonly prisma: PrismaService) {}

  private async assertOpen(tenantId: string) {
    const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId }, select: AI_QA_CONSENT_SELECT });
    if (!tenant) throw new NotFoundException('Tenant not found');
    assertAskAllowed(aiQaState(tenant));
  }

  private mine(tenantId: string, userId: string): Prisma.AiQaLogWhereInput {
    return { tenantId, userId, createdAt: { gte: retentionCutoff(AI_QA_LOG_RETENTION_DAYS) } };
  }

  /** 최신순. `cursor` 는 앞 쪽의 마지막 기록 — 그 뒤(더 오래된 것)부터 */
  async list(tenantId: string, userId: string, query: { cursor?: string; limit?: number }) {
    await this.assertOpen(tenantId);
    const take = Math.min(query.limit ?? ASK_HISTORY_PAGE, ASK_HISTORY_PAGE_MAX);
    const mine = this.mine(tenantId, userId);
    let older: Prisma.AiQaLogWhereInput = {};
    if (query.cursor) {
      // 앞 쪽의 마지막 기록이 그사이 보관 기간을 넘겼어도 그 자리부터 잇는다 — 그보다 오래된 것도 기간 밖이라 빈 쪽이 된다
      const from = await this.prisma.aiQaLog.findFirst({ where: { tenantId, userId, id: query.cursor }, select: { id: true, createdAt: true } });
      if (!from) {
        throw new BadRequestException({
          statusCode: 400,
          code: 'AI_QA_HISTORY_CURSOR',
          message: '지난 질문 목록이 바뀌었습니다. 목록을 처음부터 다시 불러 주세요.',
        });
      }
      older = { OR: [{ createdAt: { lt: from.createdAt } }, { createdAt: from.createdAt, id: { lt: from.id } }] };
    }
    const rows = await this.prisma.aiQaLog.findMany({
      where: { AND: [mine, older] },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: take + 1,
      select: ASK_HISTORY_LIST_SELECT,
    });
    const page = rows.slice(0, take);
    return { items: page.map(toHistoryItem), nextCursor: rows.length > take ? page[page.length - 1].id : null };
  }

  /** 물은 때의 답과 근거 그대로 */
  async get(tenantId: string, userId: string, id: string) {
    await this.assertOpen(tenantId);
    const row = await this.prisma.aiQaLog.findFirst({ where: { ...this.mine(tenantId, userId), id }, select: ASK_HISTORY_DETAIL_SELECT });
    if (!row) {
      throw new NotFoundException({
        statusCode: 404,
        code: 'AI_QA_HISTORY_NOT_FOUND',
        message: '지난 질문을 찾을 수 없습니다. 보관 기간(90일)이 지났을 수 있습니다.',
      });
    }
    return toHistoryDetail(row);
  }
}
