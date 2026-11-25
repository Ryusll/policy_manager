import type { PrismaService } from '../common/prisma/prisma.service';
import type { AiUsage, AskProvider } from './ask-provider';
import { checkReport, joKeyOf, reportAcceptor, type CheckedReport, type ReportContext } from './ask-report';
import { lawContextFor, type LawRef } from './ask-law-context';
import { basisSentence, joKey, rowLabel, type AskRow, type JoGroup, type RefRow } from './ask-text';

/**
 * 규정 질문의 답 단계(③) — 고른 조문의 본문에 확정 법령 연결의 법령 근거(T-209)를 붙여 정해진 칸을 받고(T-207),
 * 칸을 검사해 고정된 순서의 블록과 근거로 바꾼다. 준 번호 밖의 근거는 버린다(SEARCH-4).
 * AI 호출 실패·거절은 그대로 올린다 — 사용량 기록과 한도 계산은 `AskService` 가 한다.
 */

export interface AskCitation {
  ref: string;
  articleId: string;
  policyId: string;
  policyTitle: string;
  policyCode: string;
  label: string;
  joTitle: string;
  number: number;
  branchNumber: number | null;
  clauseNumber: number | null;
  itemNumber: number | null;
  /** DB 의 시행 중 본문 — AI 가 옮긴 글이 아니다 */
  content: string;
}

/** 답에 쓴 법령 근거(T-209) — 회사가 확정한 법령 연결의 오늘 시행 중 문구. AI 가 옮긴 글이 아니다 */
export type AskLawCitation = LawRef;

export interface AnswerStep {
  usage: AiUsage;
  checked: CheckedReport;
  citations: AskCitation[];
  lawCitations: AskLawCitation[];
}

export async function answerStep(
  prisma: PrismaService,
  provider: AskProvider,
  tenantId: string,
  question: string,
  ctx: { text: string; refs: RefRow[]; used: JoGroup[] },
): Promise<AnswerStep> {
  // 법령 근거 — 고른 조문(관련도 순)에 걸린 확정 연결만
  const articleIds = [...new Set(ctx.refs.map((r) => r.row.articleId))];
  const law = await lawContextFor(prisma, tenantId, articleIds);
  const refRow = new Map(ctx.refs.map((r) => [r.ref, r.row]));
  const report: ReportContext = {
    refs: new Set(ctx.refs.map((r) => r.ref)),
    lawRefs: new Set(law.refs.map((r) => r.ref)),
    lawJo: new Set(law.refs.map((r) => joKeyOf(r.label)).filter((k): k is string => !!k)),
    basisFrom: (refs) => basisSentence(refs.map((ref) => refRow.get(ref)).filter((r): r is AskRow => !!r)),
  };
  const context = law.text ? `${ctx.text}\n${law.text}` : ctx.text;
  const ans = await provider.answer({ context, question }, undefined, reportAcceptor(report));
  const checked = checkReport(ans.raw, report);

  const joTitle = new Map(ctx.used.map((g) => [g.key, g.title]));
  const citations: AskCitation[] = checked.citations.flatMap((ref) => {
    const row = refRow.get(ref);
    if (!row) return [];
    return [
      {
        ref,
        articleId: row.articleId,
        policyId: row.policyId,
        policyTitle: row.policyTitle,
        policyCode: row.policyCode,
        label: rowLabel(row),
        joTitle: joTitle.get(joKey(row.policyId, row.number, row.branchNumber)) ?? '',
        number: row.number,
        branchNumber: row.branchNumber,
        clauseNumber: row.clauseNumber,
        itemNumber: row.itemNumber,
        content: row.content,
      },
    ];
  });
  const lawByRef = new Map(law.refs.map((r) => [r.ref, r]));
  const lawCitations = checked.lawCitations.flatMap((ref) => {
    const r = lawByRef.get(ref);
    return r ? [r] : [];
  });
  return { usage: ans.usage, checked, citations, lawCitations };
}
