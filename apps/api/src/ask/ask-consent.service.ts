import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AI_QA_NOTICE_VERSION } from './ask-notice';

/**
 * 규정 질문 켜기·끄기와 동의 기록 (T-146, D-09 재결정 2026-10-14, ADR-0025).
 *
 * 켜기는 회사 관리자가 화면에서 본 고지 판(`noticeVersion`)이 지금 판일 때만 된다 — 확인한 사람·시각·판을 회사 행에
 * 남긴다. 끄기는 확인 없이 언제든 된다. 조건부 갱신이라 두 관리자가 동시에 눌러도 상태는 한 번만 바뀌고, 바뀐 경우에만
 * 감사 로그를 남긴다. 켤 때는 확인한 관리자의 이름·이메일을 함께 남긴다 — 사용자를 지워도 증빙이 남게.
 * 플랫폼 관리자가 회사 대신 켜는 길은 두지 않는다 — 재위탁 동의는 개인정보처리자인 고객사의 몫이다.
 */
@Injectable()
export class AskConsentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async setEnabled(tenantId: string, userId: string, enabled: boolean, noticeVersion?: number) {
    if (enabled && noticeVersion !== AI_QA_NOTICE_VERSION) {
      throw new BadRequestException({
        statusCode: 400,
        code: 'AI_QA_NOTICE_REQUIRED',
        message: '외부 전송 고지를 확인해야 켤 수 있습니다. 화면을 새로 고쳐 바뀐 고지를 확인한 뒤 다시 켜 주세요.',
      });
    }
    const changed = enabled
      ? await this.prisma.tenant.updateMany({
          // 판이 비어 있으면 `not` 비교가 NULL 이라 따로 적는다
          where: {
            id: tenantId,
            OR: [{ aiQaEnabled: false }, { aiQaNoticeVersion: null }, { aiQaNoticeVersion: { not: AI_QA_NOTICE_VERSION } }],
          },
          data: { aiQaEnabled: true, aiQaNoticeVersion: AI_QA_NOTICE_VERSION, aiQaConsentedAt: new Date(), aiQaConsentedBy: userId },
        })
      : await this.prisma.tenant.updateMany({ where: { id: tenantId, aiQaEnabled: true }, data: { aiQaEnabled: false } });
    if (changed.count === 0) {
      if (!(await this.prisma.tenant.count({ where: { id: tenantId } }))) throw new NotFoundException('Tenant not found');
      return;
    }
    const consentedBy = enabled
      ? await this.prisma.user.findUnique({ where: { id: userId }, select: { name: true, email: true } })
      : null;
    await this.audit.log({
      tenantId,
      userId,
      action: 'ai_qa.settings_change',
      entityType: 'Tenant',
      entityId: tenantId,
      details: enabled ? { enabled, noticeVersion: AI_QA_NOTICE_VERSION, consentedBy } : { enabled },
    });
  }
}
