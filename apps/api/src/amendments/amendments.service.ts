import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { formatJo } from '../common/article-label';
import { toDateOnlyString } from '../common/date-only';
import { labelFromNodeKey } from '../laws/law-rows';
import {
  LawChangesService,
  UNRESOLVABLE_REMOVED,
  type ImpactedArticle,
  type ImpactSkipReason,
} from '../law-changes/law-changes.service';
import { diffLawText } from './amendment-text';
import { generateRuleCandidate, RULES, RULESET_VERSION, TEMPLATES } from './amendment-rules';
import { CANDIDATE_SELECT, presentCandidate } from './amendment-present';

const SOURCE_SELECT = {
  id: true,
  lawId: true,
  lawArticleId: true,
  nodeKey: true,
  changeType: true,
  beforeContent: true,
  afterContent: true,
  beforeVersionKey: true,
  afterVersionKey: true,
  promulgatedDate: true,
  lawEffectiveDate: true,
  law: { select: { lawName: true } },
  lawArticle: { select: { label: true } },
} satisfies Prisma.LawChangeEventSelect;

type SourceEvent = Prisma.LawChangeEventGetPayload<{ select: typeof SOURCE_SELECT }>;

const dateOnly = (d: Date | null) => (d ? toDateOnlyString(d) : null);

/** "취업규칙 제28조제2항" — 근거의 연결 경로 표기 */
function articlePathLabel(policyTitle: string, a: ImpactedArticle['article']): string {
  return (
    `${policyTitle} ${formatJo(a.number, a.branchNumber)}` +
    (a.clauseNumber ? `제${a.clauseNumber}항` : '') +
    (a.itemNumber ? `제${a.itemNumber}호` : '')
  );
}

export type CandidateBrief = {
  id: string;
  articleId: string;
  baseVersionId: string;
  confidence: string;
  reviewFlags: string[];
};

export type GenerateResult = {
  changeEventId: string;
  asOf: string;
  /** 이번에 새로 만든 후보 */
  created: CandidateBrief[];
  /** 같은 이벤트·조문·기준 발행본으로 이미 있던 후보 — 다시 만들지 않는다(사람이 손댄 것을 덮지 않는다) */
  existing: CandidateBrief[];
  /** 제1 조문이 없어 후보를 만들 수 없는 조문과 이유 */
  skipped: Array<{ articleId: string; policyId: string; label: string; reason: ImpactSkipReason }>;
  /** 연혁 표기만 바뀐 개정 — 고칠 내용이 없다 */
  noSubstantiveChange: boolean;
  /** 영향을 찾을 수 없는 이벤트(법령에서 사라진 조문)의 사유 */
  unresolvable: string | null;
};

/**
 * 개정 후보 (T-106, 특허 청구항 1 ⑤·4·6, 도 10·11).
 *
 * 법령 변경 이벤트 하나 → 이 회사의 영향 조문(확정 연결만, T-105 와 같은 판정)마다 규칙 기반 후보를
 * 만들어 `AmendmentCandidate`(작성 상태)로 저장한다. **발행 버전은 건드리지 않는다** — 후보는
 * 시점 조회·전문에 나오지 않고, 승인(T-108)될 때에만 후속 버전이 된다(ADR-0021).
 *
 * 만드는 길은 둘이다(코덱스 자문 결정 1):
 * - 자동 — 법령 동기화가 끝날 때 아직 처리하지 않은 이벤트(`amendmentsProcessedAt` null)를 회사별로
 *   처리하고, 새로 만든 후보가 있으면 그 회사의 검토 권한자(관리자·편집자)에게 알린다
 * - 수동 — 법령 화면의 "개정 후보 만들기". 연결을 나중에 확정했거나 시행일을 보정한 뒤에 쓴다
 */
@Injectable()
export class AmendmentsService {
  private readonly log = new Logger(AmendmentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly lawChanges: LawChangesService,
  ) {}

  async generateForEvent(
    tenantId: string,
    eventId: string,
    opts: { asOf?: string; userId: string | null; notify?: boolean },
  ): Promise<GenerateResult> {
    const event = await this.prisma.lawChangeEvent.findUnique({ where: { id: eventId }, select: SOURCE_SELECT });
    if (!event) throw new NotFoundException('변경 이벤트를 찾을 수 없습니다.');

    const asOfDate = this.lawChanges.referenceDate(event.lawEffectiveDate, opts.asOf);
    const result: GenerateResult = {
      changeEventId: event.id,
      asOf: toDateOnlyString(asOfDate),
      created: [],
      existing: [],
      skipped: [],
      noSubstantiveChange: false,
      unresolvable: null,
    };
    if (!event.lawArticleId) return { ...result, unresolvable: UNRESOLVABLE_REMOVED };
    if (!diffLawText(event.beforeContent, event.afterContent).length) {
      return { ...result, noSubstantiveChange: true };
    }

    const impacted = await this.lawChanges.impactedArticles(tenantId, event.lawArticleId, asOfDate);
    const rows: Prisma.AmendmentCandidateCreateManyInput[] = [];
    for (const item of impacted) {
      if (!item.baseVersion) {
        result.skipped.push({
          articleId: item.article.id,
          policyId: item.policy.id,
          label: articlePathLabel(item.policy.title, item.article),
          reason: item.skipReason ?? 'not_in_force',
        });
        continue;
      }
      rows.push(this.buildRow(tenantId, event, item, asOfDate, opts.userId));
    }
    if (!rows.length) return result;

    const created = await this.prisma.$transaction(async (tx) => {
      // ON CONFLICT DO NOTHING RETURNING — 자동 생성과 버튼이 겹쳐도, 다시 눌러도 같은 후보는 하나다.
      // 돌려받는 것은 이번에 실제로 만든 행뿐이라 알림·감사 기록이 두 번 남지 않는다
      const made = await tx.amendmentCandidate.createManyAndReturn({
        data: rows,
        skipDuplicates: true,
        select: { id: true, articleId: true, baseVersionId: true, confidence: true, reviewFlags: true },
      });
      if (!made.length) return made;

      await tx.auditLog.create({
        data: {
          tenantId,
          userId: opts.userId ?? undefined,
          action: 'amendment.generate',
          entityType: 'law_change_event',
          entityId: event.id,
          details: {
            trigger: opts.userId ? 'user' : 'system',
            law: event.law.lawName,
            label: event.lawArticle?.label ?? labelFromNodeKey(event.nodeKey),
            asOf: result.asOf,
            beforeVersionKey: event.beforeVersionKey,
            afterVersionKey: event.afterVersionKey,
            ruleset: RULESET_VERSION,
            candidates: made.map((m) => ({
              id: m.id,
              articleId: m.articleId,
              baseVersionId: m.baseVersionId,
              confidence: m.confidence,
              reviewFlags: m.reviewFlags,
            })),
          },
        },
      });
      if (opts.notify) await this.notify(tx, tenantId, event, made);
      return made;
    });

    result.created = created;
    const createdKeys = new Set(created.map((c) => `${c.articleId}/${c.baseVersionId}`));
    const notCreated = rows.filter((r) => !createdKeys.has(`${r.articleId}/${r.baseVersionId}`));
    if (notCreated.length) {
      result.existing = await this.prisma.amendmentCandidate.findMany({
        where: {
          tenantId,
          changeEventId: event.id,
          generationMethod: 'rule',
          variant: RULESET_VERSION,
          OR: notCreated.map((r) => ({ articleId: r.articleId, baseVersionId: r.baseVersionId })),
        },
        select: { id: true, articleId: true, baseVersionId: true, confidence: true, reviewFlags: true },
      });
    }
    return result;
  }

  /**
   * 동기화가 끝날 때 부른다 — 아직 처리하지 않은 이벤트마다, 확정 연결을 가진 회사별로 후보를 만든다.
   * 한 회사가 실패해도 다른 회사는 진행하고, 실패가 있었던 이벤트는 표시하지 않아 다음 실행에서
   * 다시 처리한다(이미 만든 후보는 중복 키로 건너뛰므로 알림도 다시 가지 않는다).
   */
  async processPendingEvents(limit = 100) {
    const events = await this.prisma.lawChangeEvent.findMany({
      where: { amendmentsProcessedAt: null },
      orderBy: { detectedAt: 'asc' },
      take: limit,
      select: { id: true, lawArticleId: true },
    });
    const summary = { events: events.length, tenants: 0, created: 0, failed: 0 };
    for (const e of events) {
      let ok = true;
      if (e.lawArticleId) {
        // 회사 경계를 넘는 조회지만 사용자에게 돌려주지 않는 시스템 처리다 — 회사별 생성은
        // generateForEvent 가 그 회사 조건으로 다시 한다
        const tenants = await this.prisma.lawLink.findMany({
          where: { lawArticleId: e.lawArticleId, confirmState: 'confirmed' },
          select: { tenantId: true },
          distinct: ['tenantId'],
        });
        for (const { tenantId } of tenants) {
          try {
            const r = await this.generateForEvent(tenantId, e.id, { userId: null, notify: true });
            if (r.created.length) {
              summary.tenants++;
              summary.created += r.created.length;
            }
          } catch (err) {
            ok = false;
            summary.failed++;
            this.log.warn(`개정 후보 자동 생성 실패 — event ${e.id}, tenant ${tenantId}: ${(err as Error)?.message ?? err}`);
          }
        }
      }
      if (ok) {
        await this.prisma.lawChangeEvent.update({ where: { id: e.id }, data: { amendmentsProcessedAt: new Date() } });
      }
    }
    return summary;
  }

  async get(tenantId: string, id: string) {
    const row = await this.prisma.amendmentCandidate.findFirst({
      // 후보의 tenantId 와 조문의 실제 소속을 둘 다 본다(T-41 교훈)
      where: { id, tenantId, article: { chapter: { policy: { tenantId } } } },
      select: {
        ...CANDIDATE_SELECT,
        article: {
          select: {
            id: true,
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
            lawId: true,
            nodeKey: true,
            changeType: true,
            beforeContent: true,
            afterContent: true,
            lawEffectiveDate: true,
            promulgatedDate: true,
            law: { select: { lawName: true } },
            lawArticle: { select: { label: true } },
          },
        },
      },
    });
    if (!row) throw new NotFoundException('개정 후보를 찾을 수 없습니다.');
    const { article, changeEvent: e, ...rest } = row;
    return {
      ...presentCandidate(rest),
      policy: article.chapter.policy,
      article: {
        id: article.id,
        number: article.number,
        branchNumber: article.branchNumber,
        clauseNumber: article.clauseNumber,
        itemNumber: article.itemNumber,
        title: article.title,
      },
      event: {
        id: e.id,
        lawId: e.lawId,
        lawName: e.law.lawName,
        label: e.lawArticle?.label ?? labelFromNodeKey(e.nodeKey),
        changeType: e.changeType,
        beforeContent: e.beforeContent,
        afterContent: e.afterContent,
        lawEffectiveDate: dateOnly(e.lawEffectiveDate),
        promulgatedDate: dateOnly(e.promulgatedDate),
      },
    };
  }

  private buildRow(
    tenantId: string,
    event: SourceEvent,
    item: ImpactedArticle,
    asOfDate: Date,
    userId: string | null,
  ): Prisma.AmendmentCandidateCreateManyInput {
    const base = item.baseVersion!;
    const r = generateRuleCandidate({
      lawBefore: event.beforeContent,
      lawAfter: event.afterContent,
      baseContent: base.content,
      relationType: item.relationType,
      scope: item.scope,
      evidenceText: item.evidenceText,
    });
    const lawLabel = event.lawArticle?.label ?? labelFromNodeKey(event.nodeKey);
    const asOf = toDateOnlyString(asOfDate);
    const usedRules = [...new Set(r.applications.map((a) => a.ruleId))];
    const usedTemplates = [...new Set(r.applications.map((a) => a.templateId))];

    // 근거는 만들 때의 스냅샷이다 — 연결·법령 본문이 나중에 바뀌어도 "그때 왜"가 남아야 한다(특허 도 12)
    const rationale = {
      version: 'rationale/1',
      law: {
        lawId: event.lawId,
        lawName: event.law.lawName,
        lawArticleId: event.lawArticleId,
        label: lawLabel,
        changeType: event.changeType,
        promulgatedDate: dateOnly(event.promulgatedDate),
        lawEffectiveDate: dateOnly(event.lawEffectiveDate),
        beforeVersionKey: event.beforeVersionKey,
        afterVersionKey: event.afterVersionKey,
      },
      lawChanges: r.lawChanges,
      link: {
        id: item.linkId,
        relationType: item.relationType,
        scope: item.scope,
        evidenceText: item.evidenceText,
        confirmState: item.confirmState,
        confidence: item.linkConfidence,
        confirmedAt: item.confirmedAt,
      },
      path: [
        { type: 'lawArticle', id: event.lawArticleId, label: `${event.law.lawName} ${lawLabel}` },
        { type: 'lawLink', id: item.linkId, label: item.relationType },
        { type: 'article', id: item.article.id, label: articlePathLabel(item.policy.title, item.article) },
      ],
      base: { versionId: base.id, versionNum: base.versionNum, effectiveDate: base.effectiveDate, asOf },
      applications: r.applications,
      unmapped: r.unmapped,
      conflicts: r.conflicts,
    };
    const generationMeta = {
      engine: RULESET_VERSION,
      rules: Object.values(RULES).filter((x) => usedRules.includes(x.id)),
      templates: Object.values(TEMPLATES).filter((x) => usedTemplates.includes(x.id)),
      confidence: r.confidence,
      trigger: userId ? 'user' : 'system',
      // 입력 원천을 묶어 둔다 — 다른 개정의 본문이 섞이지 않았음을 확인할 수 있게(특허 도 10 입력 1010)
      source: {
        changeEventId: event.id,
        beforeVersionKey: event.beforeVersionKey,
        afterVersionKey: event.afterVersionKey,
        articleId: item.article.id,
        baseVersionId: base.id,
        lawLinkId: item.linkId,
        asOf,
      },
    };

    return {
      tenantId,
      articleId: item.article.id,
      baseVersionId: base.id,
      changeEventId: event.id,
      lawLinkId: item.linkId,
      candidateContent: r.content,
      rationale: rationale as unknown as Prisma.InputJsonValue,
      diff: r.diff as unknown as Prisma.InputJsonValue,
      generationMethod: 'rule',
      variant: RULESET_VERSION,
      generationMeta: generationMeta as unknown as Prisma.InputJsonValue,
      confidence: r.confidence.level,
      reviewFlags: r.flags,
      asOfDate,
      createdBy: userId,
    };
  }

  /** 회사·이벤트마다 알림 하나 — 검토 권한자(관리자·편집자)에게 */
  private async notify(
    tx: Prisma.TransactionClient,
    tenantId: string,
    event: SourceEvent,
    made: Array<{ reviewFlags: string[] }>,
  ) {
    const users = await tx.user.findMany({
      where: { tenantId, role: { in: ['admin', 'editor'] } },
      select: { id: true },
    });
    if (!users.length) return;
    const label = event.lawArticle?.label ?? labelFromNodeKey(event.nodeKey);
    const manual = made.filter((m) => m.reviewFlags.includes('manual_draft_required')).length;
    const body = [
      `우리 조문 ${made.length}곳에 개정 후보를 만들었습니다.`,
      manual ? `그중 ${manual}곳은 규칙으로 고칠 수 없어 직접 작성해야 합니다.` : null,
      event.lawEffectiveDate ? `법령 시행일 ${toDateOnlyString(event.lawEffectiveDate)}` : null,
      '검토하고 승인해야 우리 규정에 반영됩니다.',
    ]
      .filter(Boolean)
      .join('\n');
    await tx.userNotification.createMany({
      data: users.map((u) => ({
        tenantId,
        userId: u.id,
        kind: 'law_amendment',
        title: `[법령 개정] ${event.law.lawName} ${label}`,
        body,
        link: `/laws/${event.lawId}?change=${event.id}`,
      })),
    });
  }
}
