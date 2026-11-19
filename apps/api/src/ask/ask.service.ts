import { HttpException, HttpStatus, Injectable, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { todayDateOnly } from '../common/date-only';
import { AskProvider, AskRefusedError, AiUsage } from './ask-provider';
import { createAskProvider } from './ask-provider-factory';
import { AI_QA_CONSENT_SELECT, aiQaNotice, aiQaState, assertAskAllowed, guardProvider } from './ask-notice';
import { AskConsentService } from './ask-consent.service';
import { answerStep, type AskCitation, type AskLawCitation } from './ask-answer';
import { checkedScope, inForceRows, keywordGroups, type AskScopePolicy } from './ask-candidates';
import { carriedKeys, checkedParent, mergeCandidates } from './ask-follow-up';
import {
  AnswerBlock,
  AskRow,
  JoGroup,
  buildContext,
  buildToc,
  groupRows,
  questionKeywords,
  rowLabel,
} from './ask-text';

/** 목차·본문 길이 상한(글자). 목차는 캐시되므로 넉넉히, 본문은 고른 조만이라 작게 */
const TOC_MAX_CHARS = 120_000;
const CONTEXT_MAX_CHARS = 60_000;
const DEFAULT_MONTHLY_LIMIT = 300;
/** 직원 한 명의 월 질문 한도 — 한 사람이 회사 한도를 다 쓰지 못하게 */
const DEFAULT_USER_MONTHLY_LIMIT = 60;
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

export type AskReason = 'no_regulations' | 'no_candidates' | 'no_basis' | 'refused';

export type { AskCitation, AskLawCitation } from './ask-answer';

export interface AskResult {
  answerable: boolean;
  reason?: AskReason;
  blocks: AnswerBlock[];
  citations: AskCitation[];
  lawCitations: AskLawCitation[];
  /** AI 에 본문을 준 조 — 답하지 못했을 때 직원이 직접 확인할 수 있게 */
  consulted: { policyId: string; policyTitle: string; number: number; branchNumber: number | null; label: string }[];
  usage: { used: number; limit: number; userUsed: number; userLimit: number };
}

/** 질문 응답 — 답과 함께 물을 때 고른 범위(그때의 이름·코드, 비었으면 회사 전체, T-219), 기록 id 와 이어 물은 앞 질문(T-220) */
export interface AskResponse extends AskResult {
  scope: AskScopePolicy[];
  /** 이 질문의 기록 — 다음 질문이 이어 물을 때 parentId 로 보낸다 */
  id: string;
  parentId: string | null;
}

/**
 * 회사별 월 질문 한도. 비었거나 숫자가 아니면 기본값 — compose 는 값이 없어도 빈 문자열로 넘기는데
 * `Number('')` 가 0 이라 그대로 읽으면 한도 0(모든 질문이 막힘)이 된다.
 */
export function monthlyLimitFrom(raw: string | undefined, fallback = DEFAULT_MONTHLY_LIMIT): number {
  const v = raw?.trim();
  const n = v ? Number(v) : NaN;
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : fallback;
}

/** 오류에 함께 실려 온 AI 사용량(거절·끊긴 응답) — 기록해야 비용이 빠지지 않는다 */
function usageOf(e: unknown): AiUsage | undefined {
  const u = (e as { usage?: AiUsage } | null)?.usage;
  return u && typeof u.inputTokens === 'number' ? u : undefined;
}

/** 이번 달 1일 0시(한국 시간)의 순간 */
export function kstMonthStart(now = new Date()): Date {
  const today = todayDateOnly(now); // 한국 날짜의 UTC 자정
  return new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1) - KST_OFFSET_MS);
}

/**
 * T-130 규정 근거 AI 질의응답(세규식, D-09 결정 2026-10-09).
 *
 * 근거는 **지금 시행 중인 본문**뿐이다 — 규정 상세·검색과 같은 "현재" 규칙(`common/as-of.ts` 의
 * `currentVersionsSql`, T-127): 오늘(한국 날짜) 이하에 시행된 발행분 중 가장 나중, 시행일 없는 예전 시행본도
 * 후보, 미래 시행 개정은 제외, 그날 폐지된 조문은 뺀다.
 */
@Injectable()
export class AskService {
  private readonly log = new Logger(AskService.name);
  private readonly provider: AskProvider | null;
  private readonly monthlyLimit: number;
  private readonly userMonthlyLimit: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly consent: AskConsentService,
  ) {
    // 제공사는 서버 설정으로 고른다(T-208, `ask-provider-factory.ts`) — 고지 판도 같은 설정을 따른다
    this.provider = createAskProvider();
    this.monthlyLimit = monthlyLimitFrom(process.env.AI_QA_MONTHLY_LIMIT);
    this.userMonthlyLimit = monthlyLimitFrom(process.env.AI_QA_USER_MONTHLY_LIMIT, DEFAULT_USER_MONTHLY_LIMIT);
  }

  /** 이번 달(한국 시간) 한도에 센 질문 수 — 회사 전체, 그리고 그중 이 직원 */
  private async usedThisMonth(db: Prisma.TransactionClient | PrismaService, tenantId: string, userId: string | null) {
    const since = kstMonthStart();
    const [used, userUsed] = await Promise.all([
      db.aiQaLog.count({ where: { tenantId, aiCalled: true, createdAt: { gte: since } } }),
      userId ? db.aiQaLog.count({ where: { tenantId, userId, aiCalled: true, createdAt: { gte: since } } }) : 0,
    ]);
    return { used, userUsed };
  }

  /**
   * `enabled` 는 실제 켜짐(동의한 판이 지금 판일 때만 true). 켜 두었지만 고지 판이 바뀌었으면 `needsConsent` —
   * 관리자가 다시 확인하기 전까지 꺼진 것과 같다(T-146). `notice` 는 화면이 그대로 그리는 외부 전송 고지다.
   */
  async status(tenantId: string, userId: string | null = null) {
    const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId }, select: AI_QA_CONSENT_SELECT });
    if (!tenant) throw new NotFoundException('Tenant not found');
    const { used, userUsed } = await this.usedThisMonth(this.prisma, tenantId, userId);
    const state = aiQaState(tenant);
    return {
      configured: this.provider !== null,
      provider: this.provider?.name ?? null,
      enabled: state === 'on',
      needsConsent: state === 'stale',
      notice: aiQaNotice(),
      consent: tenant.aiQaNoticeVersion
        ? { noticeVersion: tenant.aiQaNoticeVersion, consentedAt: tenant.aiQaConsentedAt }
        : null,
      used,
      limit: this.monthlyLimit,
      userUsed,
      userLimit: this.userMonthlyLimit,
    };
  }

  /** 켜기·끄기와 동의 기록은 `AskConsentService`(T-146) — 바뀐 상태를 돌려준다 */
  async setEnabled(tenantId: string, userId: string, enabled: boolean, noticeVersion?: number) {
    await this.consent.setEnabled(tenantId, userId, enabled, noticeVersion);
    return this.status(tenantId, userId);
  }

  /**
   * 한도 확인과 자리 잡기를 한 번에 한다 — **AI 를 부르기 전에 먼저 센다.**
   *
   * 예전에는 끝까지 간 질문만 기록해, AI 호출이 실패했거나(502) 고르기 단계에서 거절됐거나 답이 길이 제한에서
   * 끊긴 질문은 한도에 세지 않았다(비용은 나간다). 또 확인과 기록 사이가 떨어져 있어 동시에 들어온 질문이
   * 함께 한도를 넘을 수 있었다. 이제 회사 단위 잠금 아래에서 세고 "예약" 행을 먼저 남긴다 — AI 를 부르기
   * 전에 끝난 질문(시행 중인 규정이 없을 때, 그사이 관리자가 껐을 때 등)만 나중에 돌려준다.
   * 확인 차례는 켜짐·고지(403) → 질문 범위(400, T-219) → 이어 물을 앞 질문(400, T-220) → 한도(429)이고, 어디서 막히든 기록 행은 남지 않는다.
   */
  private async reserve(
    tenantId: string,
    userId: string | null,
    question: string,
    policyIds: string[] | undefined,
    parentId: string | undefined,
  ) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`ai_qa:${tenantId}`}))`;
      // 켜짐은 한도와 같은 트랜잭션에서 본다 — 꺼진 회사는 기록 행도 남기지 않는다
      const tenant = await tx.tenant.findUnique({ where: { id: tenantId }, select: AI_QA_CONSENT_SELECT });
      if (!tenant) throw new NotFoundException('Tenant not found');
      assertAskAllowed(aiQaState(tenant));
      const scope = await checkedScope(tx, tenantId, policyIds);
      const parent = await checkedParent(tx, tenantId, userId, parentId);
      const { used, userUsed } = await this.usedThisMonth(tx, tenantId, userId);
      if (used >= this.monthlyLimit) {
        throw new HttpException(
          {
            statusCode: 429,
            code: 'AI_QA_MONTHLY_LIMIT',
            message: `이번 달 회사의 규정 질문 한도(${this.monthlyLimit}회)를 모두 썼습니다. 다음 달 1일에 다시 열립니다.`,
          },
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
      if (userId && userUsed >= this.userMonthlyLimit) {
        throw new HttpException(
          {
            statusCode: 429,
            code: 'AI_QA_USER_MONTHLY_LIMIT',
            message: `이번 달 내 규정 질문 한도(${this.userMonthlyLimit}회)를 모두 썼습니다. 다음 달 1일에 다시 열립니다.`,
          },
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
      const row = await tx.aiQaLog.create({
        data: {
          tenantId,
          userId,
          question,
          answerable: false,
          aiCalled: true,
          citedArticleIds: [],
          scope: (scope ?? []) as unknown as Prisma.InputJsonValue,
          parentId: parent?.id ?? null,
        },
        select: { id: true },
      });
      return { id: row.id, used: used + 1, userUsed: userUsed + (userId ? 1 : 0), scope, parent };
    });
  }

  /**
   * 예약 행을 결과로 채운다. AI 를 한 번도 부르지 않았으면 한도에서 돌려준다(`aiCalled: false`).
   * 답하지 못한 까닭과 물은 때의 근거(조문 원문·법령 근거·살펴본 조문)도 남긴다 — 지난 질문을 그때 그대로 다시 보인다(T-218).
   * 근거 칸은 마무리할 때 늘 채운다(답하지 못했으면 빈 목록) — 비어 있는 칸은 T-218 전 기록이나 처리 중이던 기록뿐이다.
   */
  private async finish(
    logId: string,
    data: {
      aiCalled: boolean;
      answerable?: boolean;
      blocks?: AnswerBlock[];
      citedArticleIds?: string[];
      contextRowCount?: number;
      usages: AiUsage[];
      failure?: string;
      reason?: AskReason;
      snapshot?: Pick<AskResult, 'citations' | 'lawCitations' | 'consulted'>;
    },
  ) {
    const sum = (k: keyof Omit<AiUsage, 'model'>) => data.usages.reduce((n, u) => n + u[k], 0);
    const snapshot = data.snapshot ?? { citations: [], lawCitations: [], consulted: [] };
    const json = (v: unknown) => v as Prisma.InputJsonValue;
    await this.prisma.aiQaLog.update({
      where: { id: logId },
      data: {
        answerable: data.answerable ?? false,
        answer: data.answerable && data.blocks ? (data.blocks as unknown as Prisma.InputJsonValue) : Prisma.DbNull,
        citedArticleIds: data.citedArticleIds ?? [],
        contextRowCount: data.contextRowCount ?? 0,
        aiCalled: data.aiCalled,
        model: data.usages.at(-1)?.model ?? null,
        inputTokens: sum('inputTokens'),
        outputTokens: sum('outputTokens'),
        cacheReadTokens: sum('cacheReadTokens'),
        failure: data.failure ?? null,
        reason: data.reason ?? null,
        citations: json(snapshot.citations),
        lawCitations: json(snapshot.lawCitations),
        consulted: json(snapshot.consulted),
      },
    });
  }

  async ask(tenantId: string, userId: string | null, rawQuestion: string, policyIds?: string[], parentId?: string): Promise<AskResponse> {
    const question = rawQuestion.trim();
    const provider = this.provider;
    if (!provider) {
      throw new ServiceUnavailableException('규정 질문은 아직 준비 중입니다. 쓰려면 아스트룸에 문의하세요.');
    }
    // 범위(T-219)는 예약 안에서 한도에 세기 전에 본다 — 잘못 고른 질문은 기록도 한도 차감도 없다
    const slot = await this.reserve(tenantId, userId, question, policyIds, parentId);
    const withScope = (result: AskResult): AskResponse => ({ ...result, scope: slot.scope ?? [], id: slot.id, parentId: slot.parent?.id ?? null });
    // 예약 뒤에도 외부로 보내기 직전마다 회사 상태를 다시 본다 — 그사이 관리자가 끄면 보내지 않는다(T-146)
    const guard = guardProvider(provider, async () => {
      const latest = await this.prisma.tenant.findUnique({ where: { id: tenantId }, select: AI_QA_CONSENT_SELECT });
      return latest ? aiQaState(latest) : 'off';
    });
    const usages: AiUsage[] = [];
    const usage = (aiCalled: boolean) => ({
      used: slot.used - (aiCalled ? 0 : 1),
      limit: this.monthlyLimit,
      userUsed: slot.userUsed - (aiCalled || !userId ? 0 : 1),
      userLimit: this.userMonthlyLimit,
    });
    try {
      const scopeIds = slot.scope?.map((p) => p.id) ?? null;
      const carry = slot.parent?.articleIds ?? [];
      return withScope(await this.answerQuestion(guard.provider, tenantId, slot.id, question, usages, usage, scopeIds, carry));
    } catch (e) {
      const extra = usageOf(e);
      if (extra) usages.push(extra);
      if (e instanceof AskRefusedError) {
        await this.finish(slot.id, { aiCalled: true, usages, failure: `refused:${e.message}`, reason: 'refused' });
        return withScope({ answerable: false, reason: 'refused', blocks: [], citations: [], lawCitations: [], consulted: [], usage: usage(true) });
      }
      // AI 를 부르기 시작했으면 실패해도 비용이 났을 수 있다 — 예약을 그대로 두어 한도에 센다.
      // 부르기 전에 끝났으면(그사이 관리자가 껐을 때 등) 한도에서 돌려준다
      const failure = String((e as Error)?.message ?? e).slice(0, 500);
      await this.finish(slot.id, { aiCalled: guard.called(), usages, failure });
      throw e;
    }
  }

  private async answerQuestion(
    provider: AskProvider,
    tenantId: string,
    logId: string,
    question: string,
    usages: AiUsage[],
    usage: (aiCalled: boolean) => AskResult['usage'],
    scope: string[] | null,
    carryArticleIds: string[],
  ): Promise<AskResult> {
    // ① 근거 후보 — 목차에서 AI 가 고른 조 + 이어 물은 앞 답의 근거 조(T-220) + 질문 낱말이 든 조
    const rows = await inForceRows(this.prisma, tenantId, scope);
    const groups = groupRows(rows);
    if (!groups.length) {
      // AI 를 부르지 않았다 — 한도에서 돌려준다
      await this.finish(logId, { aiCalled: false, usages, reason: 'no_regulations' });
      return { answerable: false, reason: 'no_regulations', blocks: [], citations: [], lawCitations: [], consulted: [], usage: usage(false) };
    }
    const toc = buildToc(groups, TOC_MAX_CHARS);
    if (toc.truncated) this.log.warn(`목차가 ${TOC_MAX_CHARS}자를 넘어 일부만 보냄 (tenant ${tenantId})`);

    const sel = await provider.select({ toc: toc.text, question });
    usages.push(sel.usage);
    const byTocKey = new Map(toc.entries.map((e) => [e.key, e.group.key]));
    const selectedKeys = sel.keys.map((k) => byTocKey.get(k.trim())).filter((k): k is string => !!k);
    const liveKeys = new Set(groups.map((g) => g.key));
    const keywordKeys = await keywordGroups(this.prisma, tenantId, questionKeywords(question), liveKeys, scope);
    const chosen = mergeCandidates(carriedKeys(carryArticleIds, rows, liveKeys), selectedKeys, keywordKeys);
    if (!chosen.length) {
      await this.finish(logId, { aiCalled: true, usages, reason: 'no_candidates' });
      return { answerable: false, reason: 'no_candidates', blocks: [], citations: [], lawCitations: [], consulted: [], usage: usage(true) };
    }

    // ② 고른 조의 시행 중 본문만 참조 번호를 붙여 준다
    const groupByKey = new Map(groups.map((g) => [g.key, g]));
    const picked = chosen.map((k) => groupByKey.get(k)).filter((g): g is JoGroup => !!g);
    const versionIds = picked.flatMap((g) => g.rows.map((r) => (r as AskRow & { versionId: string | null }).versionId));
    const contents = await this.prisma.articleVersion.findMany({
      where: { id: { in: versionIds.filter((v): v is string => !!v) } },
      select: { articleId: true, content: true },
    });
    const contentOf = new Map(contents.map((c) => [c.articleId, c.content]));
    const filled = picked.map((g) => ({ ...g, rows: g.rows.map((r) => ({ ...r, content: contentOf.get(r.articleId) ?? '' })) }));
    const ctx = buildContext(filled, CONTEXT_MAX_CHARS);
    const consulted = ctx.used.map((g) => ({
      policyId: g.policyId,
      policyTitle: g.policyTitle,
      number: g.number,
      branchNumber: g.branchNumber,
      label: rowLabel({ number: g.number, branchNumber: g.branchNumber, clauseNumber: null, itemNumber: null }) +
        (g.title ? `(${g.title})` : ''),
    }));

    // ③ 답 — 법령 근거(T-209)를 붙여 정해진 칸을 받고(T-207), 준 번호 밖의 근거는 버린다. 근거가 남지 않으면 답하지 않은
    // 것으로 본다(`ask-answer.ts`)
    let step;
    try {
      step = await answerStep(this.prisma, provider, tenantId, question, ctx);
      usages.push(step.usage);
    } catch (e) {
      if (e instanceof AskRefusedError) {
        if (e.usage) usages.push(e.usage);
        await this.finish(logId, {
          aiCalled: true,
          usages,
          contextRowCount: ctx.refs.length,
          failure: `refused:${e.message}`,
          reason: 'refused',
          snapshot: { citations: [], lawCitations: [], consulted },
        });
        return { answerable: false, reason: 'refused', blocks: [], citations: [], lawCitations: [], consulted, usage: usage(true) };
      }
      throw e;
    }
    const { checked, citations, lawCitations } = step;
    if (checked.droppedCitations) this.log.warn(`준 적 없는 근거 ${checked.droppedCitations}건을 버림 (tenant ${tenantId})`);
    await this.finish(logId, {
      aiCalled: true,
      answerable: checked.answerable,
      blocks: checked.blocks,
      citedArticleIds: citations.map((c) => c.articleId),
      contextRowCount: ctx.refs.length,
      usages,
      ...(checked.answerable ? {} : { reason: 'no_basis' as const }),
      snapshot: { citations, lawCitations, consulted },
    });
    return {
      answerable: checked.answerable,
      ...(checked.answerable ? {} : { reason: 'no_basis' as const }),
      blocks: checked.blocks,
      citations,
      lawCitations,
      consulted,
      usage: usage(true),
    };
  }
}
