import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { toDateOnlyString, todayDateOnly } from '../common/date-only';
import { labelFromNodeKey } from '../laws/law-rows';
import { PolicyPdfService } from '../policies/policy-pdf.service';
import { formatArticleLabel } from '../common/article-label';
import { AmendmentsService } from './amendments.service';
import { buildAmendmentDocument, type DocCandidate, type DocState } from './amendment-document';

/** 발행된 버전만 승인의 결과다(발행 뒤 폐지 포함) */
const ISSUED = new Set<string>(['published', 'archived']);

const refuse = (code: string, message: string, extra: Record<string, string> = {}) =>
  new BadRequestException({ statusCode: 400, code, message, ...extra });

/**
 * 개정안 문서 출력(T-162) — 후보를 회사 경계 안에서 읽고, 같은 규정인지·반려가 섞였는지 본 뒤 PDF 로 만들어 감사에 남긴다.
 * 감사는 규정 내보내기(`policy.export.pdf`)와 따로 `amendment.export.pdf` 로 남긴다(LAW-22).
 */
@Injectable()
export class AmendmentDocumentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pdf: PolicyPdfService,
    private readonly audit: AuditService,
    private readonly amendments: AmendmentsService,
  ) {}

  async renderPdf(tenantId: string, userId: string, candidateIds: string[]) {
    const ids = [...new Set(candidateIds)];
    const rows = await this.prisma.amendmentCandidate.findMany({
      // 후보의 tenantId 와 조문의 실제 소속을 둘 다 본다(T-41 교훈)
      where: { id: { in: ids }, tenantId, article: { chapter: { policy: { tenantId } } } },
      select: {
        id: true,
        articleId: true,
        reviewState: true,
        revision: true,
        candidateContent: true,
        plannedEffectiveDate: true,
        baseVersion: { select: { content: true } },
        resultVersion: { select: { changeNote: true, status: true, effectiveDate: true } },
        article: {
          select: {
            number: true,
            branchNumber: true,
            clauseNumber: true,
            itemNumber: true,
            title: true,
            chapter: { select: { policy: { select: { id: true, code: true, title: true } } } },
          },
        },
        changeEvent: {
          select: {
            id: true,
            nodeKey: true,
            changeType: true,
            beforeContent: true,
            afterContent: true,
            promulgatedDate: true,
            lawEffectiveDate: true,
            law: { select: { lawName: true } },
            lawArticle: { select: { label: true } },
            lawVersion: { select: { lawType: true, promulgationNo: true } },
          },
        },
      },
    });
    // 하나라도 회사 밖이거나 없으면 어느 것인지 알리지 않고 404 — 다른 회사의 후보가 있는지 드러내지 않는다
    if (rows.length !== ids.length) throw new NotFoundException('개정 후보를 찾을 수 없습니다.');
    const policies = new Map(rows.map((r) => [r.article.chapter.policy.id, r.article.chapter.policy]));
    if (policies.size > 1) throw refuse('AMENDMENT_DOC_MIXED_POLICY', '같은 규정의 개정 후보만 한 문서로 낼 수 있습니다.');
    if (rows.some((r) => r.reviewState === 'rejected')) throw refuse('AMENDMENT_DOC_REJECTED', '반려된 개정 후보는 개정안 문서에 넣을 수 없습니다.');
    // 같은 조문의 후보가 둘이면 대비표에 그 조문이 서로 다른 개정안으로 두 번 나온다(이벤트가 둘이거나 규칙이 바뀌어 새 후보가 생긴 경우)
    const articleIds = new Set(rows.map((r) => r.articleId));
    if (articleIds.size !== rows.length) {
      throw refuse('AMENDMENT_DOC_DUPLICATE_ARTICLE', '같은 조문의 개정 후보가 둘 이상입니다 — 조문마다 하나만 골라 주세요.');
    }
    // 작성·검토 중인 후보의 기준 본문이 지금 현행과 다르면(새 버전 시행·폐지·이력·변수 값 변경) '현행' 칸이 틀린다 — 상세 화면·승인과 같은 판정
    for (const r of rows.filter((x) => x.reviewState !== 'approved')) {
      const { staleReason } = await this.amendments.get(tenantId, r.id);
      if (staleReason) {
        const article = formatArticleLabel(r.article);
        // 화면이 어느 조문인지 보이게 조문 표기와 까닭을 따로 싣는다
        throw refuse('AMENDMENT_DOC_STALE', `${article} 후보의 기준 본문이 지금 시행 중인 본문과 다릅니다 — 그 후보 상세 화면의 안내를 따른 뒤 내 주세요.`, { article, staleReason });
      }
    }
    const policy = [...policies.values()][0];

    const candidates: DocCandidate[] = rows.map((r) => {
      const e = r.changeEvent;
      // 승인으로 발행된 버전만 결과다 — 발행 전 초안(T-178 전 철회가 남긴 것 등)은 결과가 아니다
      const issued = r.reviewState === 'approved' && ISSUED.has(r.resultVersion?.status ?? '') ? r.resultVersion : null;
      return {
        id: r.id,
        reviewState: r.reviewState as DocState,
        revision: r.revision,
        baseContent: r.baseVersion.content,
        candidateContent: r.candidateContent,
        plannedEffectiveDate: r.plannedEffectiveDate ? toDateOnlyString(r.plannedEffectiveDate) : null,
        // 승인 때 정한 실제 사내 시행일 — 계획 시행일과 다를 수 있다
        issuedEffectiveDate: issued?.effectiveDate ? toDateOnlyString(issued.effectiveDate) : null,
        article: r.article,
        law: {
          eventId: e.id,
          lawName: e.law.lawName,
          label: e.lawArticle?.label ?? labelFromNodeKey(e.nodeKey),
          changeType: e.changeType,
          promulgatedDate: e.promulgatedDate ? toDateOnlyString(e.promulgatedDate) : null,
          lawEffectiveDate: e.lawEffectiveDate ? toDateOnlyString(e.lawEffectiveDate) : null,
          lawType: e.lawVersion?.lawType ?? null,
          promulgationNo: e.lawVersion?.promulgationNo ?? null,
          beforeContent: e.beforeContent,
          afterContent: e.afterContent,
        },
        approvedNote: issued?.changeNote ?? null,
      };
    });

    const doc = buildAmendmentDocument({
      policy: { code: policy.code, title: policy.title },
      candidates,
      today: toDateOnlyString(todayDateOnly()),
    });
    const pdf = await this.pdf.render({ html: doc.html, title: doc.title, metaLine: doc.metaLine, footerText: doc.footerText, pageNumbers: true });

    await this.audit.log({
      tenantId,
      userId,
      action: 'amendment.export.pdf',
      entityType: 'Policy',
      entityId: policy.id,
      details: {
        code: policy.code,
        title: policy.title,
        bytes: pdf.length,
        // 어느 판을 냈는지 — 문서를 낸 뒤 후보가 손질돼도 그때 낸 것을 가린다
        candidates: rows.map((r) => ({ id: r.id, revision: r.revision, state: r.reviewState })),
      },
    });
    return { pdf, policy };
  }
}
