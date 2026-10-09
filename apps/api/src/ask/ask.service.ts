import { HttpException, HttpStatus, Injectable, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { todayDateOnly } from '../common/date-only';
import { currentVersionsSql } from '../common/as-of';
import { AnthropicAskProvider, AskProvider, AskRefusedError, AiUsage, MockAskProvider } from './ask-provider';
import {
  AnswerBlock,
  AskRow,
  JoGroup,
  buildContext,
  buildToc,
  checkAnswer,
  groupRows,
  joKey,
  questionKeywords,
  rowLabel,
} from './ask-text';

/** 목차·본문 길이 상한(글자). 목차는 캐시되므로 넉넉히, 본문은 고른 조만이라 작게 */
const TOC_MAX_CHARS = 120_000;
const CONTEXT_MAX_CHARS = 60_000;
/** 본문을 읽을 조 수 상한(AI 가 고른 것 + 낱말이 든 것) */
const MAX_GROUPS = 12;
const DEFAULT_MONTHLY_LIMIT = 300;
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

export type AskReason = 'no_regulations' | 'no_candidates' | 'no_basis' | 'refused';

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

export interface AskResult {
  answerable: boolean;
  reason?: AskReason;
  blocks: AnswerBlock[];
  citations: AskCitation[];
  /** AI 에 본문을 준 조 — 답하지 못했을 때 직원이 직접 확인할 수 있게 */
  consulted: { policyId: string; policyTitle: string; number: number; branchNumber: number | null; label: string }[];
  usage: { used: number; limit: number };
}

/**
 * 회사별 월 질문 한도. 비었거나 숫자가 아니면 기본값 — compose 는 값이 없어도 빈 문자열로 넘기는데
 * `Number('')` 가 0 이라 그대로 읽으면 한도 0(모든 질문이 막힘)이 된다.
 */
export function monthlyLimitFrom(raw: string | undefined): number {
  const v = raw?.trim();
  const n = v ? Number(v) : NaN;
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : DEFAULT_MONTHLY_LIMIT;
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

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {
    const key = process.env.ANTHROPIC_API_KEY?.trim();
    this.provider =
      process.env.AI_QA_PROVIDER?.trim() === 'mock' ? new MockAskProvider() : key ? new AnthropicAskProvider(key) : null;
    this.monthlyLimit = monthlyLimitFrom(process.env.AI_QA_MONTHLY_LIMIT);
  }

  private async usedThisMonth(tenantId: string): Promise<number> {
    return this.prisma.aiQaLog.count({ where: { tenantId, aiCalled: true, createdAt: { gte: kstMonthStart() } } });
  }

  async status(tenantId: string) {
    const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { aiQaEnabled: true } });
    if (!tenant) throw new NotFoundException('Tenant not found');
    return {
      configured: this.provider !== null,
      provider: this.provider?.name ?? null,
      enabled: tenant.aiQaEnabled,
      used: await this.usedThisMonth(tenantId),
      limit: this.monthlyLimit,
    };
  }

  async setEnabled(tenantId: string, userId: string, enabled: boolean) {
    const before = await this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { aiQaEnabled: true } });
    if (!before) throw new NotFoundException('Tenant not found');
    await this.prisma.tenant.update({ where: { id: tenantId }, data: { aiQaEnabled: enabled } });
    if (before.aiQaEnabled !== enabled) {
      await this.audit.log({
        tenantId,
        userId,
        action: 'ai_qa.settings_change',
        entityType: 'Tenant',
        entityId: tenantId,
        details: { enabled },
      });
    }
    return this.status(tenantId);
  }

  /**
   * 지금 시행 중인 조문 행 전부(본문 없이) — 목차와 낱말 찾기의 기준. "현재" 판정은 규정 상세·검색과
   * 같은 규칙(`currentVersionsSql`, T-127)이다. 조 머리는 버전이 없어도(제목만 있는 조) 같은 조에 시행 중인
   * 행이 있으면 넣는다.
   */
  private async inForceRows(tenantId: string) {
    const today = todayDateOnly();
    const picked = await this.prisma.$queryRaw<{ article_id: string; version_id: string; repealed_on: Date | null }[]>(
      currentVersionsSql(tenantId, today, { activePoliciesOnly: true }),
    );
    const versionOf = new Map<string, string>();
    for (const r of picked) {
      if (r.repealed_on && r.repealed_on.getTime() <= today.getTime()) continue; // 그날 폐지 상태
      versionOf.set(r.article_id, r.version_id);
    }

    const articles = await this.prisma.article.findMany({
      where: { chapter: { policy: { tenantId, isActive: true } } },
      select: {
        id: true,
        number: true,
        branchNumber: true,
        clauseNumber: true,
        itemNumber: true,
        title: true,
        chapter: { select: { policy: { select: { id: true, title: true, code: true } } } },
      },
    });
    const rows: (AskRow & { versionId: string | null })[] = articles.map((a) => ({
      articleId: a.id,
      policyId: a.chapter.policy.id,
      policyTitle: a.chapter.policy.title,
      policyCode: a.chapter.policy.code,
      number: a.number,
      branchNumber: a.branchNumber,
      clauseNumber: a.clauseNumber,
      itemNumber: a.itemNumber,
      title: a.title,
      content: '',
      versionId: versionOf.get(a.id) ?? null,
    }));
    // 시행 중인 행이 하나라도 있는 조만 남기고, 그 조의 머리(버전 없는 제목 행)는 함께 둔다
    const liveJo = new Set(rows.filter((r) => r.versionId).map((r) => joKey(r.policyId, r.number, r.branchNumber)));
    return rows.filter(
      (r) =>
        liveJo.has(joKey(r.policyId, r.number, r.branchNumber)) &&
        (r.versionId || (r.clauseNumber == null && r.itemNumber == null)),
    );
  }

  /** 질문 낱말이 시행 중 본문·조문 제목에 들어 있는 조 — 들어 있는 낱말 수가 많은 순 */
  private async keywordGroups(tenantId: string, keywords: string[], liveKeys: Set<string>): Promise<string[]> {
    const score = new Map<string, number>();
    const today = todayDateOnly();
    for (const kw of keywords) {
      const pattern = `%${kw.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_')}%`;
      // 본문은 "현재" 버전만 본다(T-127) — 시행일 전인 개정 문구로 후보를 고르지 않는다
      const hits = await this.prisma.$queryRaw<{ policy_id: string; number: number; branch_number: number | null }[]>(
        Prisma.sql`
          SELECT DISTINCT c.policy_id, a.number, a.branch_number
          FROM articles a
          JOIN chapters c ON c.id = a.chapter_id
          JOIN policies p ON p.id = c.policy_id
          LEFT JOIN (${currentVersionsSql(tenantId, today, { activePoliciesOnly: true })}) cur ON cur.article_id = a.id
          WHERE p.tenant_id = ${tenantId} AND p.is_active = true
            AND (a.title LIKE ${pattern} ESCAPE '\\' OR cur.content LIKE ${pattern} ESCAPE '\\')
          LIMIT 200`,
      );
      for (const h of hits) {
        const key = joKey(h.policy_id, h.number, h.branch_number);
        if (liveKeys.has(key)) score.set(key, (score.get(key) ?? 0) + 1);
      }
    }
    return [...score.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => k);
  }

  private async record(
    tenantId: string,
    userId: string | null,
    question: string,
    data: {
      answerable: boolean;
      blocks?: AnswerBlock[];
      citedArticleIds?: string[];
      contextRowCount?: number;
      usages: AiUsage[];
    },
  ) {
    const sum = (k: keyof Omit<AiUsage, 'model'>) => data.usages.reduce((n, u) => n + u[k], 0);
    await this.prisma.aiQaLog.create({
      data: {
        tenantId,
        userId,
        question,
        answerable: data.answerable,
        answer: data.answerable && data.blocks ? (data.blocks as unknown as Prisma.InputJsonValue) : Prisma.DbNull,
        citedArticleIds: data.citedArticleIds ?? [],
        contextRowCount: data.contextRowCount ?? 0,
        aiCalled: data.usages.length > 0,
        model: data.usages.at(-1)?.model ?? null,
        inputTokens: sum('inputTokens'),
        outputTokens: sum('outputTokens'),
        cacheReadTokens: sum('cacheReadTokens'),
      },
    });
  }

  async ask(tenantId: string, userId: string | null, rawQuestion: string): Promise<AskResult> {
    const question = rawQuestion.trim();
    const provider = this.provider;
    if (!provider) {
      throw new ServiceUnavailableException('AI 질의응답이 설정되지 않았습니다(서버 환경변수 ANTHROPIC_API_KEY).');
    }
    const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { aiQaEnabled: true } });
    if (!tenant) throw new NotFoundException('Tenant not found');
    if (!tenant.aiQaEnabled) {
      throw new HttpException(
        { statusCode: 403, code: 'AI_QA_DISABLED', message: '회사 관리자가 규정 질문(AI)을 꺼 두었습니다.' },
        HttpStatus.FORBIDDEN,
      );
    }
    const used = await this.usedThisMonth(tenantId);
    if (used >= this.monthlyLimit) {
      throw new HttpException(
        {
          statusCode: 429,
          code: 'AI_QA_MONTHLY_LIMIT',
          message: `이번 달 규정 질문 한도(${this.monthlyLimit}회)를 모두 썼습니다. 다음 달 1일에 다시 열립니다.`,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const done = (r: Omit<AskResult, 'usage'>, calls: number): AskResult => ({
      ...r,
      usage: { used: used + (calls > 0 ? 1 : 0), limit: this.monthlyLimit },
    });

    // ① 근거 후보 — 목차에서 AI 가 고른 조 + 질문 낱말이 든 조
    const rows = await this.inForceRows(tenantId);
    const groups = groupRows(rows);
    if (!groups.length) {
      await this.record(tenantId, userId, question, { answerable: false, usages: [] });
      return done({ answerable: false, reason: 'no_regulations', blocks: [], citations: [], consulted: [] }, 0);
    }
    const toc = buildToc(groups, TOC_MAX_CHARS);
    if (toc.truncated) this.log.warn(`목차가 ${TOC_MAX_CHARS}자를 넘어 일부만 보냄 (tenant ${tenantId})`);

    const usages: AiUsage[] = [];
    let selectedKeys: string[];
    try {
      const sel = await provider.select({ toc: toc.text, question });
      usages.push(sel.usage);
      const byTocKey = new Map(toc.entries.map((e) => [e.key, e.group.key]));
      selectedKeys = sel.keys.map((k) => byTocKey.get(k.trim())).filter((k): k is string => !!k);
    } catch (e) {
      if (e instanceof AskRefusedError) {
        await this.record(tenantId, userId, question, { answerable: false, usages });
        return done({ answerable: false, reason: 'refused', blocks: [], citations: [], consulted: [] }, 1);
      }
      throw e;
    }
    const liveKeys = new Set(groups.map((g) => g.key));
    const keywordKeys = await this.keywordGroups(tenantId, questionKeywords(question), liveKeys);
    const chosen: string[] = [];
    for (const k of [...selectedKeys.slice(0, 10), ...keywordKeys]) {
      if (!chosen.includes(k)) chosen.push(k);
      if (chosen.length >= MAX_GROUPS) break;
    }
    if (!chosen.length) {
      await this.record(tenantId, userId, question, { answerable: false, usages });
      return done({ answerable: false, reason: 'no_candidates', blocks: [], citations: [], consulted: [] }, 1);
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

    // ③ 답 — 준 번호 밖의 근거는 버리고, 근거가 남지 않으면 답하지 않은 것으로 본다
    let checked;
    try {
      const ans = await provider.answer({ context: ctx.text, question });
      usages.push(ans.usage);
      checked = checkAnswer(ans.raw, new Set(ctx.refs.map((r) => r.ref)));
    } catch (e) {
      if (e instanceof AskRefusedError) {
        await this.record(tenantId, userId, question, { answerable: false, usages, contextRowCount: ctx.refs.length });
        return done({ answerable: false, reason: 'refused', blocks: [], citations: [], consulted }, 1);
      }
      throw e;
    }
    if (checked.droppedCitations) this.log.warn(`준 적 없는 근거 ${checked.droppedCitations}건을 버림 (tenant ${tenantId})`);

    const refRow = new Map(ctx.refs.map((r) => [r.ref, r.row]));
    const joTitle = new Map(ctx.used.map((g) => [g.key, g.title]));
    const citations: AskCitation[] = checked.citations.map((ref) => {
      const row = refRow.get(ref)!;
      return {
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
      };
    });
    await this.record(tenantId, userId, question, {
      answerable: checked.answerable,
      blocks: checked.blocks,
      citedArticleIds: citations.map((c) => c.articleId),
      contextRowCount: ctx.refs.length,
      usages,
    });
    return done(
      {
        answerable: checked.answerable,
        ...(checked.answerable ? {} : { reason: 'no_basis' as const }),
        blocks: checked.blocks,
        citations,
        consulted,
      },
      1,
    );
  }
}
