import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { formatJo } from '../common/article-label';
import { parseDateOnly, toDateOnlyString, todayDateOnly } from '../common/date-only';
import { parseRevisionNotifyFromMetadata } from '../notifications/revision-notify.types';
import { AS_OF_VERSION_ORDER, asOfState, asOfVersionWhere } from '../common/as-of';
import { impactReferenceDate } from '../law-changes/law-impact';
import { tenantsReached } from '../law-changes/law-link-reach';
import { presentEventEffective } from '../laws/law-effective-info';
import { VariablesService } from '../variables/variables.service';
import { lockArticleRow } from '../common/row-locks';
import { evidenceInContent } from '../law-links/evidence-version';
import {
  compareVariableEffects,
  planVariables,
  variableFingerprint,
  type BindingInput,
  type ValueInput,
  type VariableEntry,
} from './amendment-variables';
import { labelFromNodeKey } from '../laws/law-rows';
import {
  LawChangesService,
  UNRESOLVABLE_REMOVED,
  type ImpactedArticle,
  type ImpactSkipReason,
} from '../law-changes/law-changes.service';
import { diffLawText } from './amendment-text';
import { generateRuleCandidate, RULES, RULESET_VERSION, TEMPLATES } from './amendment-rules';
import { articlesWithCandidates, capConfidence, PARENT_LINK_FLAG } from './amendment-reach';
import { CANDIDATE_SELECT, currentState, presentCandidate } from './amendment-present';
import { correctionAfter, detachStaleSources, recordSourceDetach, reopenRejectedLocked } from './amendment-correction';
import { contentHash, hasSubstantiveChange, historyFingerprint } from './amendment-revision';
import { diffCandidate, relinkDiff, type AppliedRule } from './amendment-diff';
import type {
  AmendmentListQueryDto,
  ApproveAmendmentDto,
  EditAmendmentDto,
  RejectAmendmentDto,
  RequestReviewDto,
} from './amendments.dto';

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
  effectiveInfo: true,
  law: { select: { lawName: true } },
  lawArticle: { select: { label: true } },
} satisfies Prisma.LawChangeEventSelect;

type SourceEvent = Prisma.LawChangeEventGetPayload<{ select: typeof SOURCE_SELECT }>;

const dateOnly = (d: Date | null) => (d ? toDateOnlyString(d) : null);

const LOCK_MESSAGE = '그 사이 다른 사람이 이 후보를 고쳤거나 검토를 요청했습니다. 최신 내용을 불러온 뒤 다시 하세요.';

/** 손질·검토 요청이 확인하는 후보 정보 */
const OWNED_SELECT = {
  id: true,
  articleId: true,
  changeEventId: true,
  baseVersionId: true,
  baseFingerprint: true,
  candidateContent: true,
  rationale: true,
  generationMeta: true,
  plannedEffectiveDate: true,
  revision: true,
  lockVersion: true,
  reviewState: true,
  createdBy: true,
  baseVersion: { select: { content: true, versionNum: true } },
  changeEvent: {
    select: {
      lawEffectiveDate: true,
      nodeKey: true,
      beforeVersionKey: true,
      afterVersionKey: true,
      law: { select: { lawName: true } },
      lawArticle: { select: { label: true } },
    },
  },
  article: {
    select: {
      number: true,
      branchNumber: true,
      clauseNumber: true,
      itemNumber: true,
      title: true,
      chapter: { select: { policy: { select: { id: true, code: true, title: true, metadata: true } } } },
    },
  },
} satisfies Prisma.AmendmentCandidateSelect;

type OwnedCandidate = Prisma.AmendmentCandidateGetPayload<{ select: typeof OWNED_SELECT }>;

/** 승인을 막는 이유 — 화면이 원인별로 안내한다(코덱스 자문 결정 3) */
/** issued_source — 이 후보로 발행한 버전이 이미 있다(T-178, amendment-correction 의 assertNoIssuedSource 가 같은 모양으로 던진다) */
type ApproveBlock = 'undated_history' | 'repealed' | 'base_mismatch' | 'later_version' | 'history_changed' | 'variable_changed' | 'issued_source';
/** 지금 다시 만들면 고를 기준 본문 — 기준일에 조문이 폐지돼 있으면 id 없이 repealed(T-126) */
type CurrentBase = { id: string | null; repealed: boolean };
const blocked = (reason: ApproveBlock, message: string) => new ConflictException({ message, reason });

/** "취업규칙 제28조제2항" — 근거의 연결 경로 표기. 사내 규정은 조·항·목이다(법령의 호와 다르다) */
function articlePathLabel(policyTitle: string, a: ImpactedArticle['article']): string {
  return (
    `${policyTitle} ${formatJo(a.number, a.branchNumber)}` +
    (a.clauseNumber ? `제${a.clauseNumber}항` : '') +
    (a.itemNumber ? `제${a.itemNumber}목` : '')
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
  /** 예정 사내 시행일 — 변수 값을 고른 날(T-109 ②) */
  plannedEffectiveDate: string;
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
    private readonly variables: VariablesService,
  ) {}

  async generateForEvent(
    tenantId: string,
    eventId: string,
    // onlyNew — 자동 생성: 이 변경으로 이미 후보가 있는 조문은 건너뛴다(T-148, amendment-reach.ts)
    opts: { asOf?: string; plannedEffectiveDate?: string; userId: string | null; notify?: boolean; articleId?: string; onlyNew?: boolean },
  ): Promise<GenerateResult> {
    const event = await this.prisma.lawChangeEvent.findUnique({ where: { id: eventId }, select: SOURCE_SELECT });
    if (!event) throw new NotFoundException('변경 이벤트를 찾을 수 없습니다.');

    const asOfDate = this.lawChanges.referenceDate(event.lawEffectiveDate, opts.asOf);
    // 예정 사내 시행일 — 변수 값을 고르는 날(T-109 ②). 따로 주지 않으면 기준일(시행 전 개정이면 법령 시행일)
    const planned = opts.plannedEffectiveDate !== undefined ? parseDateOnly(opts.plannedEffectiveDate) : asOfDate;
    if (!planned) throw new BadRequestException('예정 사내 시행일(plannedEffectiveDate)은 실제로 있는 날짜여야 합니다.');
    const result: GenerateResult = {
      changeEventId: event.id,
      asOf: toDateOnlyString(asOfDate),
      plannedEffectiveDate: toDateOnlyString(planned),
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

    const reached = (await this.lawChanges.impactedArticles(tenantId, event.lawArticleId, asOfDate)).filter(
      // "다시 만들기"(T-107)는 그 조문만 — 같은 이벤트의 다른 조문까지 새로 만들지 않는다
      (item) => !opts.articleId || item.article.id === opts.articleId,
    );
    const had = opts.onlyNew
      ? await articlesWithCandidates(this.prisma, tenantId, event.id, reached.map((i) => i.article.id))
      : new Set<string>();
    const impacted = reached.filter((item) => !had.has(item.article.id));
    const rows: Prisma.AmendmentCandidateCreateManyInput[] = [];
    // 기준 본문과 함께 그 조문의 발행 이력 지문을 고정한다(T-108) — 승인 때 다시 계산해 그 사이 다른 발행을 잡는다
    const fps = await this.fingerprints(impacted.filter((i) => i.baseVersion).map((i) => i.article.id));
    // 기준 본문 버전의 변수 연결과 그 변수들의 값(T-109 ②) — 영향 조문이면서 연결된 조문에만 값을 넣는다
    const vars = await this.variableInputs(this.prisma, tenantId, impacted.flatMap((i) => (i.baseVersion ? [i.baseVersion.id] : [])));
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
      rows.push(
        this.buildRow(tenantId, event, item, asOfDate, opts.userId, fps.get(item.article.id)!, {
          planned,
          bindings: vars.bindings.get(item.baseVersion.id) ?? [],
          values: vars.values,
        }),
      );
    }
    if (!rows.length) return result;
    // 조문 id 순으로 넣는다(T-131) — FK 확인이 조문을 id 순으로 잡아, 조문을 id 순으로 잡고 지우는 규정·장 삭제와 엇갈리지 않게
    rows.sort((a, b) => (a.articleId < b.articleId ? -1 : a.articleId > b.articleId ? 1 : 0));

    const created = await this.prisma.$transaction(async (tx) => {
      // ON CONFLICT DO NOTHING RETURNING — 자동 생성과 버튼이 겹쳐도, 다시 눌러도 같은 후보는 하나다.
      // 돌려받는 것은 이번에 실제로 만든 행뿐이라 알림·감사 기록이 두 번 남지 않는다
      const made = await tx.amendmentCandidate.createManyAndReturn({
        data: rows,
        skipDuplicates: true,
        select: { id: true, articleId: true, baseVersionId: true, confidence: true, reviewFlags: true },
      });
      if (!made.length) return made;

      // 생성본을 판 1 로 남긴다(T-107) — 판 테이블은 생성본부터 모든 판을 갖는다
      const rowOf = (m: { articleId: string; baseVersionId: string }) =>
        rows.find((r) => r.articleId === m.articleId && r.baseVersionId === m.baseVersionId)!;
      await tx.amendmentRevision.createMany({
        data: made.map((m) => ({
          tenantId,
          candidateId: m.id,
          revision: 1,
          content: rowOf(m).candidateContent,
          contentHash: contentHash(rowOf(m).candidateContent),
          diff: rowOf(m).diff as Prisma.InputJsonValue,
        })),
      });

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
            plannedEffectiveDate: result.plannedEffectiveDate,
            beforeVersionKey: event.beforeVersionKey,
            afterVersionKey: event.afterVersionKey,
            ruleset: RULESET_VERSION,
            candidates: made.map((m) => ({
              id: m.id,
              articleId: m.articleId,
              baseVersionId: m.baseVersionId,
              confidence: m.confidence,
              reviewFlags: m.reviewFlags,
              // 변수 선택(T-109 ②) — 어느 연결에 어떤 값을 넣었는지·왜 넣지 않았는지
              variables: variableSummary(rowOf(m).rationale),
            })),
          },
        },
      });
      if (opts.notify) await this.notify(tx, tenantId, event, made);
      return made;
    });

    result.created = created;
    const createdArticles = new Set(created.map((c) => c.articleId));
    const notCreated = rows.filter((r) => !createdArticles.has(r.articleId));
    if (notCreated.length) {
      result.existing = await this.prisma.amendmentCandidate.findMany({
        where: {
          tenantId,
          changeEventId: event.id,
          generationMethod: 'rule',
          variant: RULESET_VERSION,
          OR: notCreated.map((r) => ({
            articleId: r.articleId,
            baseVersionId: r.baseVersionId,
            baseFingerprint: r.baseFingerprint,
            plannedEffectiveDate: r.plannedEffectiveDate,
            variableFingerprint: r.variableFingerprint,
          })),
        },
        select: { id: true, articleId: true, baseVersionId: true, confidence: true, reviewFlags: true },
      });
    }
    return result;
  }

  /**
   * 동기화가 끝날 때 부른다 — 아직 처리하지 않은 이벤트마다, 확정 연결을 가진 회사별로 후보를 만든다.
   * 한 회사가 실패해도 다른 회사는 진행하고, 실패가 있었던 이벤트는 표시하지 않아 다음 실행에서
   * 다시 처리한다(이 변경으로 이미 후보가 있는 조문은 건너뛰므로 알림도 다시 가지 않는다 — onlyNew, T-148).
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
        // 회사 경계를 넘는 조회지만 사용자에게 돌려주지 않는 시스템 처리다 — 바뀐 조항과 그 위 조항에 확정 연결이 닿는
        // 회사(T-148). 회사별 생성은 generateForEvent 가 그 회사 조건으로 다시 하고, 이미 후보가 있는 조문은 건너뛴다
        for (const tenantId of await tenantsReached(this.prisma, e.lawArticleId)) {
          try {
            const r = await this.generateForEvent(tenantId, e.id, { userId: null, notify: true, onlyNew: true });
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

  /**
   * 후보 목록 (T-107). 기본은 처리할 것(작성·검토). 조문의 실제 소속으로도 회사 경계를 건다.
   * 행마다 `isCurrentBase` — 지금 다시 만들면 고를 기준 본문이 이 후보의 제1 조문과 같은지.
   * 다르면 그 사이 조문이 개정됐다는 뜻이다(승인 때 다시 확인하는 것은 T-108).
   */
  async list(tenantId: string, q: AmendmentListQueryDto) {
    const page = q.page ?? 1;
    const limit = q.limit ?? 30;
    const state = q.state ?? 'open';
    const where: Prisma.AmendmentCandidateWhereInput = {
      tenantId,
      article: {
        chapter: {
          policy: {
            tenantId,
            ...(q.policyId ? { id: q.policyId } : {}),
            ...(q.policyActive ? { isActive: q.policyActive === 'active' } : {}),
          },
        },
      },
      ...(q.changeEventId ? { changeEventId: q.changeEventId } : {}),
      ...(state === 'open'
        ? { reviewState: { in: ['draft', 'review'] } }
        : state === 'all'
          ? {}
          : { reviewState: state }),
    };
    const [rows, total] = await Promise.all([
      this.prisma.amendmentCandidate.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        skip: (page - 1) * limit,
        take: limit,
        select: {
          id: true,
          articleId: true,
          baseVersionId: true,
          baseFingerprint: true,
          reviewState: true,
          revision: true,
          candidateContent: true,
          diff: true,
          confidence: true,
          reviewFlags: true,
          asOfDate: true,
          plannedEffectiveDate: true,
          rationale: true,
          createdBy: true,
          createdAt: true,
          updatedAt: true,
          baseVersion: { select: { versionNum: true, content: true } },
          article: {
            select: {
              number: true,
              branchNumber: true,
              clauseNumber: true,
              itemNumber: true,
              title: true,
              chapter: { select: { policy: { select: { id: true, code: true, title: true, isActive: true } } } },
            },
          },
          changeEvent: {
            select: {
              id: true,
              lawId: true,
              nodeKey: true,
              changeType: true,
              lawEffectiveDate: true,
              law: { select: { lawName: true } },
              lawArticle: { select: { label: true } },
            },
          },
        },
      }),
      this.prisma.amendmentCandidate.count({ where }),
    ]);

    const current = await this.currentBases(
      rows.map((r) => ({ articleId: r.articleId, lawEffectiveDate: r.changeEvent.lawEffectiveDate })),
    );
    const fps = await this.fingerprints([...new Set(rows.map((r) => r.articleId))]);
    const drifted = await this.variableDrift(
      tenantId,
      rows.map((r) => ({ id: r.id, baseVersionId: r.baseVersionId, baseContent: r.baseVersion.content, planned: r.plannedEffectiveDate, rationale: r.rationale })),
    );
    const creatorIds = [...new Set(rows.map((r) => r.createdBy).filter((v): v is string => !!v))];
    const creators = creatorIds.length
      ? await this.prisma.user.findMany({ where: { tenantId, id: { in: creatorIds } }, select: { id: true, name: true } })
      : [];

    return {
      rows: rows.map((r) => {
        const { article, changeEvent: e } = r;
        return {
          id: r.id,
          reviewState: r.reviewState,
          current: currentState({
            revision: r.revision,
            candidateContent: r.candidateContent,
            diff: r.diff,
            baseContent: r.baseVersion.content,
          }),
          confidence: r.confidence,
          reviewFlags: r.reviewFlags,
          asOf: toDateOnlyString(r.asOfDate),
          createdAt: r.createdAt,
          updatedAt: r.updatedAt,
          createdBy: r.createdBy ? { id: r.createdBy, name: creators.find((c) => c.id === r.createdBy)?.name ?? null } : null,
          policy: article.chapter.policy,
          article: {
            id: r.articleId,
            number: article.number,
            branchNumber: article.branchNumber,
            clauseNumber: article.clauseNumber,
            itemNumber: article.itemNumber,
            title: article.title,
          },
          baseVersion: { id: r.baseVersionId, versionNum: r.baseVersion.versionNum },
          ...this.staleness(
            r,
            current.get(this.baseKey(r.articleId, e.lawEffectiveDate)) ?? null,
            fps.get(r.articleId) ?? null,
            drifted.has(r.id),
          ),
          plannedEffectiveDate: toDateOnlyString(r.plannedEffectiveDate),
          event: {
            id: e.id,
            lawId: e.lawId,
            lawName: e.law.lawName,
            label: e.lawArticle?.label ?? labelFromNodeKey(e.nodeKey),
            changeType: e.changeType,
            lawEffectiveDate: dateOnly(e.lawEffectiveDate),
          },
        };
      }),
      total,
      page,
      limit,
    };
  }

  /**
   * 손질 (T-107, 특허 도 11) — 새 판을 만든다. 수정 사유는 필수이고, 판은 바꾸지 않고 쌓는다.
   *
   * - 검토 중인 후보를 고치면 작성으로 되돌린다. 검토 요청은 그 판에 대한 것이었으므로 새 판으로 다시
   *   요청해야 한다(요청 기록은 상태 전환 이력에 남는다). 반려된 후보도 고치면 작성으로(T-108)
   * - 승인된 후보는 고칠 수 없다
   * - 화면이 본 판·잠금 버전이 지금과 다르면 409 — 그 사이 누가 고쳤거나 검토를 요청했다
   * - 비교 정보는 다시 만든다. 규칙이 낸 문구가 그 자리에 그대로 남은 곳만 규칙 근거로 잇고, 사람이 고친
   *   곳은 근거 없는 변경(검토 대상)으로 남긴다. 생성 때의 신뢰도·검토 표시는 바꾸지 않는다
   */
  async edit(tenantId: string, id: string, userId: string, dto: EditAmendmentDto) {
    const note = dto.note?.trim();
    if (!note) throw new BadRequestException('수정 사유를 입력하세요 — 누가 왜 고쳤는지가 승인 판단의 근거가 됩니다.');
    const cand = await this.findOwned(tenantId, id);
    if (cand.reviewState === 'approved') throw new BadRequestException('승인된 후보는 고칠 수 없습니다.');
    this.assertLock(cand, dto);
    const content = dto.candidateContent;
    if (content === cand.candidateContent) throw new BadRequestException('바뀐 내용이 없습니다.');

    const rationaleIn = cand.rationale as { applications?: AppliedRule[]; variables?: VariableEntry[] } | null;
    const applied = (rationaleIn?.applications ?? []) as AppliedRule[];
    // 변수 값을 넣은 자리도 다시 잇는다(T-109 ②) — 사람이 그 자리를 고쳤으면 변수 근거가 끊긴다
    const appliedVariables = (rationaleIn?.variables ?? []).flatMap((v) =>
      v.status === 'applied' && v.candidate ? [{ id: v.index, base: v.base, candidate: { text: v.candidate.text } }] : [],
    );
    const diff = relinkDiff(cand.baseVersion.content, content, applied, appliedVariables);
    const nextRevision = cand.revision + 1;
    const fromState = cand.reviewState;

    await this.prisma.$transaction(async (tx) => {
      // 반려된 후보를 고쳐 다시 여는 것 — 반려 정정과 같은 판정·떼기(T-178: 발행본이 후보를 쥐면 409, 옛 철회 초안의 원천 연결 떼기)
      const detached =
        fromState === 'rejected'
          ? await reopenRejectedLocked(tx, { tenantId, userId, candidateId: id, articleId: cand.articleId, cause: 'amendment.edit', what: '고쳐도 다시 승인할 수 없습니다' })
          : null;
      // 조건부 갱신 — 읽은 뒤 다른 요청이 먼저 바꿨으면 0건이다
      const updated = await tx.amendmentCandidate.updateMany({
        where: { id, tenantId, revision: cand.revision, lockVersion: cand.lockVersion },
        data: {
          candidateContent: content,
          diff: diff as unknown as Prisma.InputJsonValue,
          revision: nextRevision,
          lockVersion: { increment: 1 },
          reviewState: 'draft',
        },
      });
      if (updated.count !== 1) throw new ConflictException(LOCK_MESSAGE);
      await tx.amendmentRevision.create({
        data: {
          tenantId,
          candidateId: id,
          revision: nextRevision,
          content,
          contentHash: contentHash(content),
          diff: diff as unknown as Prisma.InputJsonValue,
          note,
          editedBy: userId,
          stateBefore: fromState,
        },
      });
      if (fromState !== 'draft') {
        await tx.amendmentStateChange.create({
          data: {
            tenantId,
            candidateId: id,
            fromState,
            toState: 'draft',
            revision: nextRevision,
            reason:
              fromState === 'review'
                ? '본문을 고쳐 검토 요청이 취소됨 — 새 판으로 다시 요청해야 한다'
                : '반려된 후보를 고쳐 작성 상태로',
            actorId: userId,
          },
        });
      }
      await tx.auditLog.create({
        data: {
          tenantId,
          userId,
          action: 'amendment.edit',
          entityType: 'amendment_candidate',
          entityId: id,
          details: {
            fromRevision: cand.revision,
            toRevision: nextRevision,
            fromHash: contentHash(cand.candidateContent),
            toHash: contentHash(content),
            note,
            fromState,
            toState: 'draft',
            unexplained: diff.unexplained,
            ...(detached ? { detachedVersionIds: [detached.id] } : {}),
          },
        },
      });
    });
    return this.get(tenantId, id);
  }

  /**
   * 검토 요청 (작성 → 검토, 특허 도 12 단계 1220) — 요청 시점과 검토 대상 판을 남긴다. 승인(T-108)은 이 판에
   * 대해서만 유효하다. 본문이 제1 조문과 (공백 말고) 다르지 않으면 "개정이 필요 없다"는 판단을 검토로 받는
   * 것이라 이유가 필수다. 기준 본문이 그 사이 바뀌었어도 막지 않는다 — 화면이 경고하고 T-108 이 다시 확인한다.
   */
  async requestReview(tenantId: string, id: string, userId: string, dto: RequestReviewDto) {
    const cand = await this.findOwned(tenantId, id);
    if (cand.reviewState !== 'draft') {
      throw new BadRequestException(
        cand.reviewState === 'review' ? '이미 검토를 요청한 후보입니다.' : '작성 상태의 후보만 검토를 요청할 수 있습니다.',
      );
    }
    this.assertLock(cand, dto);
    const reason = dto.reason?.trim() || null;
    if (!hasSubstantiveChange(cand.baseVersion.content, cand.candidateContent) && !reason) {
      throw new BadRequestException(
        '본문이 기준 본문과 같습니다 — 개정이 필요 없다고 보는 이유를 적어 검토를 요청하세요.',
      );
    }
    const current = await this.currentBases([{ articleId: cand.articleId, lawEffectiveDate: cand.changeEvent.lawEffectiveDate }]);
    const fps = await this.fingerprints([cand.articleId]);
    const drifted = await this.variableDrift(tenantId, [
      { id: cand.id, baseVersionId: cand.baseVersionId, baseContent: cand.baseVersion.content, planned: cand.plannedEffectiveDate, rationale: cand.rationale },
    ]);
    const baseChanged = !this.staleness(
      cand,
      current.get(this.baseKey(cand.articleId, cand.changeEvent.lawEffectiveDate)) ?? null,
      fps.get(cand.articleId) ?? null,
      drifted.has(cand.id),
    ).isCurrentBase;

    await this.prisma.$transaction(async (tx) => {
      const updated = await tx.amendmentCandidate.updateMany({
        where: { id, tenantId, revision: cand.revision, lockVersion: cand.lockVersion, reviewState: 'draft' },
        data: { reviewState: 'review', lockVersion: { increment: 1 } },
      });
      if (updated.count !== 1) throw new ConflictException(LOCK_MESSAGE);
      const change = await tx.amendmentStateChange.create({
        data: { tenantId, candidateId: id, fromState: 'draft', toState: 'review', revision: cand.revision, reason, actorId: userId },
      });
      await tx.auditLog.create({
        data: {
          tenantId,
          userId,
          action: 'amendment.request_review',
          entityType: 'amendment_candidate',
          entityId: id,
          details: {
            requestId: change.id,
            revision: cand.revision,
            contentHash: contentHash(cand.candidateContent),
            reason,
            noChange: !hasSubstantiveChange(cand.baseVersion.content, cand.candidateContent),
            baseChanged,
          },
        },
      });
    });
    return this.get(tenantId, id);
  }

  /**
   * 다시 만들기 — 기준 본문이 바뀐 후보에서, 같은 변경·조문으로 지금 기준 본문의 후보를 만든다(그 조문만).
   * 옛 후보는 그대로 두고(사람이 고친 것을 옮기지 않는다) 둘은 같은 변경·조문의 후보로 이어진다.
   * 지금 기준 본문의 후보가 이미 있으면 그것을 돌려준다.
   */
  async regenerate(tenantId: string, id: string, userId: string, asOf?: string, plannedEffectiveDate?: string) {
    const cand = await this.findOwned(tenantId, id);
    // asOf — 승인하려던 시행일로 다시 만들 때(T-108). 그 날 시행 중인 본문이 새 후보의 기준 본문이 된다.
    // 예정 사내 시행일(T-109 ②)은 따로 주지 않으면 asOf 와 같은 날 — 승인하려던 시행일의 변수 값으로 다시 만든다
    const r = await this.generateForEvent(tenantId, cand.changeEventId, {
      userId,
      articleId: cand.articleId,
      asOf,
      plannedEffectiveDate: plannedEffectiveDate ?? asOf,
    });
    const hit = [...r.created, ...r.existing].find((c) => c.articleId === cand.articleId) ?? null;
    return {
      candidateId: hit?.id ?? null,
      created: !!hit && r.created.some((c) => c.id === hit.id),
      /** 기준 본문이 그대로라 같은 후보다 */
      unchanged: hit?.id === id,
      skipped: r.skipped.find((x) => x.articleId === cand.articleId)?.reason ?? null,
      noSubstantiveChange: r.noSubstantiveChange,
      unresolvable: r.unresolvable,
    };
  }

  /**
   * 승인 → 후속 버전 발행 (T-108, 특허 청구항 1 ⑦·6, 도 12). 관리자만(일반 조문 승인과 같다).
   *
   * 결정(사용자 지시로 코덱스 자문):
   * - 검토 중인 후보만, 그리고 검토를 요청한 **그 판**만 승인한다. 화면이 본 판·잠금 버전이 다르면 409
   * - 사내 규정 시행일은 필수이고 소급하지 않는다(오늘 이후). 법령 시행일보다 이르면 이유가 있어야 한다
   * - 본문은 그 판(바뀌지 않는 기록)을 그대로 발행한다. 기준 본문과 (공백 말고) 같으면 400 — "개정 불필요"는 반려로
   * - 조문 행을 잠그고 다시 확인한다: 시행일 미기록 이력 / 그 시행일에 조문이 폐지돼 있는가(T-126) / 그 시행일의
   *   시점 조회 결과가 기준 본문인가 / 그보다 늦은 시행본이 있는가 / 발행 이력 지문이 그대로인가 — 하나라도 어긋나면
   *   원인을 담아 409(다시 만들어 검토, 폐지면 반려로 닫는다)
   * - 같은 요청을 다시 보내면(응답 유실) 기존 결과를 돌려주고, 다른 시행일·사유면 409
   * - 버전 생성·후보 전환·상태 기록·감사 기록·알림은 한 트랜잭션
   */
  async approve(tenantId: string, id: string, userId: string, dto: ApproveAmendmentDto) {
    const changeNote = dto.changeNote?.trim();
    if (!changeNote) throw new BadRequestException('개정 사유를 입력하세요.');
    const effective = parseDateOnly(dto.effectiveDate);
    if (!effective) throw new BadRequestException('사내 규정 시행일은 실제로 있는 날짜(YYYY-MM-DD)여야 합니다.');
    const today = todayDateOnly();
    const cand = await this.findOwned(tenantId, id);

    if (cand.reviewState === 'approved') {
      // 응답을 못 받고 다시 누른 경우 — 같은 요청이면 이미 발행한 결과를 돌려준다(버전·감사·알림을 또 만들지 않는다)
      const v = await this.prisma.articleVersion.findUnique({
        where: { sourceCandidateId: id },
        select: { effectiveDate: true, changeNote: true },
      });
      const same =
        !!v &&
        dto.expectedRevision === cand.revision &&
        !!v.effectiveDate &&
        toDateOnlyString(v.effectiveDate) === toDateOnlyString(effective) &&
        v.changeNote === changeNote;
      if (same) return { ...(await this.get(tenantId, id)), alreadyApproved: true };
      throw new ConflictException('이미 승인된 후보입니다 — 다른 시행일·사유로 다시 승인할 수 없습니다.');
    }
    if (cand.reviewState !== 'review') {
      throw new BadRequestException('검토 중인 후보만 승인할 수 있습니다 — 먼저 검토를 요청하세요.');
    }
    this.assertLock(cand, dto);
    if (effective.getTime() < today.getTime()) {
      throw new BadRequestException('사내 규정 시행일은 오늘이나 그 뒤여야 합니다 — 소급 개정은 하지 않습니다.');
    }
    const lawEffective = cand.changeEvent.lawEffectiveDate;
    const earlyReason = dto.earlyReason?.trim() || null;
    if (lawEffective && effective.getTime() < lawEffective.getTime() && !earlyReason) {
      throw new BadRequestException(
        `사내 규정 시행일이 법령 시행일(${toDateOnlyString(lawEffective)})보다 이릅니다 — 그렇게 하는 이유를 적어 주세요.`,
      );
    }
    const request = await this.prisma.amendmentStateChange.findFirst({
      where: { candidateId: id, tenantId, toState: 'review' },
      orderBy: { createdAt: 'desc' },
      select: { id: true, revision: true, actorId: true },
    });
    if (!request || request.revision !== cand.revision) {
      throw new ConflictException('검토를 요청한 판과 지금 판이 다릅니다 — 다시 검토를 요청하세요.');
    }
    const rev = await this.prisma.amendmentRevision.findUnique({
      where: { candidateId_revision: { candidateId: id, revision: cand.revision } },
      select: { id: true, content: true, contentHash: true, diff: true },
    });
    if (!rev || rev.content !== cand.candidateContent || rev.contentHash !== contentHash(rev.content)) {
      throw new ConflictException('판 기록이 후보 본문과 맞지 않습니다 — 관리자에게 알려 주세요.');
    }
    if (!hasSubstantiveChange(cand.baseVersion.content, rev.content)) {
      throw new BadRequestException('본문이 기준 본문과 같습니다 — 개정이 필요 없으면 반려로 닫으세요.');
    }
    const E = toDateOnlyString(effective);

    await this.prisma.$transaction(async (tx) => {
      // 조문 단위로 줄 세운다 — 같은 조문의 다른 후보 승인·일반 승인과 겹치면 앞선 개정을 덮어쓴다
      await lockArticleRow(tx, cand.articleId);
      const history = await tx.articleVersion.findMany({
        where: { articleId: cand.articleId },
        select: { id: true, status: true, effectiveDate: true, versionNum: true, repealedOn: true },
      });
      const issued = history.filter((v) => v.status === 'published' || v.status === 'archived');
      if (issued.some((v) => !v.effectiveDate)) {
        throw blocked('undated_history', '시행일이 기록되지 않은 시행본이 있습니다 — 규정 화면에서 시행일을 먼저 보정하세요.');
      }
      const asOf = await tx.articleVersion.findFirst({
        where: { articleId: cand.articleId, ...asOfVersionWhere(effective) },
        orderBy: AS_OF_VERSION_ORDER,
        select: { id: true, repealedOn: true },
      });
      // 폐지된 조문은 다시 만들어도 기준 본문이 없다 — "기준 본문 불일치"보다 먼저 까닭을 알린다
      if (asOfState(asOf, effective) === 'repealed') {
        throw blocked(
          'repealed',
          `이 조문은 ${toDateOnlyString(asOf!.repealedOn!)}에 폐지돼 ${E}에 시행 중이 아닙니다 — 이 후보는 승인할 수 없으니 반려로 닫으세요.`,
        );
      }
      // 폐지 예정(T-132 ③)이 시행일 뒤에 있으면 승인하지 않는다 — 새 버전이 폐지 예정을 덮어 폐지가 조용히 사라진다
      const pendingRepeal = history
        .filter((v) => v.repealedOn && v.repealedOn.getTime() > effective.getTime())
        .sort((a, b) => b.repealedOn!.getTime() - a.repealedOn!.getTime())[0];
      if (pendingRepeal) {
        throw blocked(
          'repealed',
          `이 조문은 ${toDateOnlyString(pendingRepeal.repealedOn!)}에 폐지될 예정이라 ${E} 시행으로 승인할 수 없습니다 — 규정 화면에서 폐지 예정을 먼저 취소하세요.`,
        );
      }
      if (asOf?.id !== cand.baseVersionId) {
        throw blocked(
          'base_mismatch',
          `${E}에 시행 중일 본문이 이 후보의 기준 본문(v${cand.baseVersion.versionNum})이 아닙니다 — 이 시행일 기준으로 다시 만들어 검토하세요.`,
        );
      }
      if (issued.some((v) => v.effectiveDate!.getTime() > effective.getTime())) {
        throw blocked('later_version', `${E}보다 늦게 시행되는 버전이 이미 있습니다 — 그 버전과 함께 정리한 뒤 승인하세요.`);
      }
      if (cand.baseFingerprint && historyFingerprint(history) !== cand.baseFingerprint) {
        throw blocked(
          'history_changed',
          '후보를 만든 뒤 이 조문에 다른 발행·폐지·시행일 보정이 있었습니다 — 다시 만들어 검토하세요.',
        );
      }
      // 변수 값(T-109 ②) — 승인하는 시행일에 다시 골라도 후보가 넣은 값과 같아야 한다. 변수를 잠그고 읽는다(값 고치기와 줄 세움)
      const vin = await this.variableInputs(tx, tenantId, [cand.baseVersionId], true);
      const expectedVars = planVariables(cand.baseVersion.content, vin.bindings.get(cand.baseVersionId) ?? [], vin.values, effective).entries;
      const storedVars = (cand.rationale as { variables?: VariableEntry[] } | null)?.variables;
      const mismatches = compareVariableEffects(storedVars, expectedVars);
      if (mismatches.length) {
        const what = mismatches.map((m) =>
          m.released
            ? `${m.label} "${m.candidate}"(연결이 풀림)`
            : `${m.label} "${m.candidate}" → ${m.expected === null ? '값을 정할 수 없음' : `"${m.expected}"`}`,
        );
        throw blocked('variable_changed', `${E}에 쓸 변수 값이 이 후보와 다릅니다 — ${what.join(', ')}. 이 시행일 기준으로 다시 만들어 검토하세요.`);
      }

      const updated = await tx.amendmentCandidate.updateMany({
        where: { id, tenantId, reviewState: 'review', revision: cand.revision, lockVersion: cand.lockVersion },
        data: { reviewState: 'approved', lockVersion: { increment: 1 } },
      });
      if (updated.count !== 1) throw new ConflictException(LOCK_MESSAGE);
      // 변수 표식이 남은 본문은 발행하지 않는다(T-109) — 옛 본문에 표식이 남아 있던 조문
      await this.variables.assertNoMarkers(tx, tenantId, [{ label: '후보 본문', content: rev.content }]);

      const now = new Date();
      await tx.articleVersion.updateMany({
        where: { articleId: cand.articleId, status: 'published' },
        data: { status: 'archived' },
      });
      // T-178 전 철회가 원천 후보를 남긴 초안이 있으면 연결을 뗀다(원천 후보 id 는 유일)
      const detached = await detachStaleSources(tx, id);
      const version = await tx.articleVersion.create({
        data: {
          articleId: cand.articleId, // 조문 식별자를 유지한다 — 연결·이력이 그대로 이어진다(청구항 1)
          versionNum: Math.max(0, ...history.map((v) => v.versionNum)) + 1,
          content: rev.content,
          status: 'published',
          effectiveDate: effective,
          changeNote,
          approvedBy: userId,
          approvedAt: now,
          publishedAt: now,
          createdBy: userId,
          changeEventId: cand.changeEventId,
          sourceCandidateId: id,
        },
        select: { id: true, versionNum: true },
      });
      if (detached) await recordSourceDetach(tx, { tenantId, userId, candidateId: id, newVersionId: version.id, cause: 'amendment.approve', detached });
      // 기준 본문의 변수 연결을 새 버전으로 옮긴다(T-109) — 후보가 값을 넣은 자리는 그 값으로 잇고, 그 밖에 후보가
      // 바꾼 구간에 걸린 연결은 "다시 이어야 함"
      await this.variables.inheritBindings(
        tx,
        tenantId,
        { id: cand.baseVersionId, content: cand.baseVersion.content },
        { id: version.id, articleId: cand.articleId, content: rev.content },
        userId,
        new Map(
          (storedVars ?? [])
            .filter((v) => v.status === 'applied' && v.value !== null)
            .map((v) => [v.bindingId, { text: v.value!, valueId: v.valueId }] as const),
        ),
      );
      const decision = await tx.amendmentStateChange.create({
        data: {
          tenantId,
          candidateId: id,
          fromState: 'review',
          toState: 'approved',
          revision: cand.revision,
          reason: earlyReason ? `${changeNote}\n(법령 시행일보다 이른 시행: ${earlyReason})` : changeNote,
          actorId: userId,
        },
      });

      // 감사 기록 — 발행 버전·변경 이벤트·후보·비교 정보·승인자를 한 줄에(청구항 6), 개정 당시 근거도 함께(PAT-20)
      const rationale = (cand.rationale ?? {}) as { link?: unknown };
      const meta = (cand.generationMeta ?? {}) as { engine?: unknown; rules?: unknown; templates?: unknown };
      const revDiff = (rev.diff ?? {}) as { changes?: unknown[]; unexplained?: number };
      await tx.auditLog.create({
        data: {
          tenantId,
          userId,
          action: 'amendment.approve',
          entityType: 'amendment_candidate',
          entityId: id,
          details: {
            version: {
              id: version.id,
              versionNum: version.versionNum,
              contentHash: rev.contentHash,
              effectiveDate: E,
              publishedAt: now.toISOString(),
            },
            changeEvent: {
              id: cand.changeEventId,
              law: cand.changeEvent.law.lawName,
              label: cand.changeEvent.lawArticle?.label ?? labelFromNodeKey(cand.changeEvent.nodeKey),
              lawEffectiveDate: dateOnly(lawEffective),
              beforeVersionKey: cand.changeEvent.beforeVersionKey,
              afterVersionKey: cand.changeEvent.afterVersionKey,
            },
            candidate: {
              id,
              revision: cand.revision,
              revisionHash: rev.contentHash,
              reviewRequestId: request.id,
              decisionId: decision.id,
              baseVersionId: cand.baseVersionId,
              baseFingerprint: cand.baseFingerprint,
            },
            // 비교 정보는 승인한 판(바뀌지 않는 기록)의 것 — 기준 본문 대 승인 본문
            comparison: {
              revisionId: rev.id,
              changes: revDiff.changes?.length ?? 0,
              unexplained: revDiff.unexplained ?? 0,
            },
            changeNote,
            earlyReason,
            evidence: { link: rationale.link ?? null, engine: meta.engine ?? null, rules: meta.rules ?? null, templates: meta.templates ?? null },
            // 변수 선택(T-109 ②, 특허 도 12) — 어느 연결에 어떤 값(유효기간·범위)을 넣었는지
            plannedEffectiveDate: dateOnly(cand.plannedEffectiveDate),
            variables: variableSummary(cand.rationale),
            ...(detached ? { detachedVersionIds: [detached.id] } : {}),
          } as Prisma.InputJsonValue,
        },
      });

      await this.notifyDecision(tx, tenantId, cand, {
        kind: 'approved',
        actorId: userId,
        requesterId: request.actorId,
        versionId: version.id,
        effectiveDate: effective,
        today,
        note: changeNote,
      });
    });
    return this.get(tenantId, id);
  }

  /** 반려 (T-108, 도 12 단계 1280) — 검토 중인 후보만, 관리자만, 사유 필수. 발행본은 그대로 둔다 */
  async reject(tenantId: string, id: string, userId: string, dto: RejectAmendmentDto) {
    const reason = dto.reason?.trim();
    if (!reason) throw new BadRequestException('반려 사유를 입력하세요.');
    const cand = await this.findOwned(tenantId, id);
    if (cand.reviewState !== 'review') throw new BadRequestException('검토 중인 후보만 반려할 수 있습니다.');
    this.assertLock(cand, dto);
    const request = await this.prisma.amendmentStateChange.findFirst({
      where: { candidateId: id, tenantId, toState: 'review' },
      orderBy: { createdAt: 'desc' },
      select: { id: true, actorId: true },
    });

    await this.prisma.$transaction(async (tx) => {
      const updated = await tx.amendmentCandidate.updateMany({
        where: { id, tenantId, reviewState: 'review', revision: cand.revision, lockVersion: cand.lockVersion },
        data: { reviewState: 'rejected', lockVersion: { increment: 1 } },
      });
      if (updated.count !== 1) throw new ConflictException(LOCK_MESSAGE);
      const decision = await tx.amendmentStateChange.create({
        data: { tenantId, candidateId: id, fromState: 'review', toState: 'rejected', revision: cand.revision, reason, actorId: userId },
      });
      await tx.auditLog.create({
        data: {
          tenantId,
          userId,
          action: 'amendment.reject',
          entityType: 'amendment_candidate',
          entityId: id,
          details: {
            revision: cand.revision,
            contentHash: contentHash(cand.candidateContent),
            reason,
            reviewRequestId: request?.id ?? null,
            decisionId: decision.id,
            changeEventId: cand.changeEventId,
          },
        },
      });
      await this.notifyDecision(tx, tenantId, cand, {
        kind: 'rejected',
        actorId: userId,
        requesterId: request?.actorId ?? null,
        note: reason,
      });
    });
    return this.get(tenantId, id);
  }

  /**
   * 결정 알림 — 같은 트랜잭션에서 저장한다. 승인이면 규정에 지정한 개정 알림 수신자에게 개정 시행(미래면 시행 예정)
   * 알림, 검토를 요청한 사람·후보를 만든 사람에게 결과 알림. 반려면 요청자·생성자에게만. 결정한 사람은 빼고, 한
   * 사람에게 한 건만 간다.
   */
  private async notifyDecision(
    tx: Prisma.TransactionClient,
    tenantId: string,
    cand: OwnedCandidate,
    d: {
      kind: 'approved' | 'rejected';
      actorId: string;
      requesterId: string | null;
      note: string;
      versionId?: string;
      effectiveDate?: Date;
      today?: Date;
    },
  ) {
    const policy = cand.article.chapter.policy;
    const articleLabel = `${formatJo(cand.article.number, cand.article.branchNumber)}${cand.article.clauseNumber ? `제${cand.article.clauseNumber}항` : ''}${cand.article.itemNumber ? `제${cand.article.itemNumber}목` : ''}`;
    const lawLabel = `${cand.changeEvent.law.lawName} ${cand.changeEvent.lawArticle?.label ?? labelFromNodeKey(cand.changeEvent.nodeKey)}`;
    const inTenant = async (ids: string[]) =>
      ids.length
        ? (await tx.user.findMany({ where: { tenantId, id: { in: ids } }, select: { id: true } })).map((u) => u.id)
        : [];

    const notified = new Set<string>([d.actorId]);
    const rows: Prisma.UserNotificationCreateManyInput[] = [];
    const E = d.effectiveDate ? toDateOnlyString(d.effectiveDate) : null;
    const future = !!(d.effectiveDate && d.today && d.effectiveDate.getTime() > d.today.getTime());

    // 요청자·생성자 — 결과 알림(개정 검토 화면으로)
    for (const uid of await inTenant([d.requesterId, cand.createdBy].filter((v): v is string => !!v))) {
      if (notified.has(uid)) continue;
      notified.add(uid);
      rows.push({
        tenantId,
        userId: uid,
        kind: 'law_amendment',
        title: `[개정 후보 ${d.kind === 'approved' ? '승인' : '반려'}] ${policy.title} ${articleLabel}`,
        body: [
          `법령 개정: ${lawLabel}`,
          d.kind === 'approved' ? `${future ? '발행 완료 · 시행 예정' : '시행'} ${E}` : null,
          `${d.kind === 'approved' ? '개정 사유' : '반려 사유'}: ${d.note}`,
        ]
          .filter(Boolean)
          .join('\n'),
        link: `/amendments/${cand.id}`,
      });
    }

    // 승인이면 규정에 지정한 개정 알림 수신자에게 — 일반 조문 승인과 같은 대상(revisionNotify)
    if (d.kind === 'approved') {
      const cfg = parseRevisionNotifyFromMetadata(policy.metadata);
      if (cfg.enabled) {
        const ids = new Set<string>(cfg.userIds);
        if (cfg.groupIds.length) {
          const members = await tx.notificationGroupMember.findMany({
            where: { groupId: { in: cfg.groupIds }, group: { tenantId } },
            select: { userId: true },
          });
          members.forEach((m) => ids.add(m.userId));
        }
        for (const uid of await inTenant([...ids])) {
          if (notified.has(uid)) continue;
          notified.add(uid);
          rows.push({
            tenantId,
            userId: uid,
            kind: 'policy_revision',
            title: future ? `[개정 발행 · ${E} 시행 예정] ${policy.title}` : `[개정 시행] ${policy.title}`,
            body: [`규정: ${policy.code} · ${policy.title}`, `조문: ${articleLabel}`, `개정 사유: ${d.note}`, `법령 개정 반영: ${lawLabel}`].join('\n'),
            policyId: policy.id,
            articleId: cand.articleId,
            versionId: d.versionId,
          });
        }
      }
    }
    if (rows.length) await tx.userNotification.createMany({ data: rows });
  }

  /** 판과 상태 전환 이력 — 판마다 직전 판 대비 바뀐 곳을 함께 */
  async history(tenantId: string, id: string) {
    await this.findOwned(tenantId, id);
    const [revisions, changes] = await Promise.all([
      this.prisma.amendmentRevision.findMany({ where: { tenantId, candidateId: id }, orderBy: { revision: 'asc' } }),
      this.prisma.amendmentStateChange.findMany({ where: { tenantId, candidateId: id }, orderBy: { createdAt: 'asc' } }),
    ]);
    const names = await this.userNames(tenantId, [...revisions.map((r) => r.editedBy), ...changes.map((c) => c.actorId)]);
    const who = (uid: string | null) => (uid ? { id: uid, name: names.get(uid) ?? null } : null);
    return {
      revisions: revisions.map((r, i) => ({
        revision: r.revision,
        content: r.content,
        contentHash: r.contentHash,
        note: r.note,
        editedBy: who(r.editedBy),
        stateBefore: r.stateBefore,
        createdAt: r.createdAt,
        /** 직전 판 대비 바뀐 곳 — 판 1(생성본)은 없다 */
        fromPrevious: i > 0 ? diffCandidate(revisions[i - 1].content, r.content).parts : null,
      })),
      stateChanges: changes.map((c) => ({
        id: c.id,
        fromState: c.fromState,
        toState: c.toState,
        revision: c.revision,
        reason: c.reason,
        actor: who(c.actorId),
        createdAt: c.createdAt,
        /** 정정 전환(T-178) — 반려 정정·승인 철회 */
        kind: c.kind,
      })),
    };
  }

  /** 후보의 tenantId 와 조문의 실제 소속을 둘 다 본다(T-41 교훈) — 다른 회사 후보는 404 */
  private async findOwned(tenantId: string, id: string) {
    const row = await this.prisma.amendmentCandidate.findFirst({
      where: { id, tenantId, article: { chapter: { policy: { tenantId } } } },
      select: OWNED_SELECT,
    });
    if (!row) throw new NotFoundException('개정 후보를 찾을 수 없습니다.');
    return row;
  }

  private assertLock(c: { revision: number; lockVersion: number }, dto: { expectedRevision: number; expectedLockVersion: number }) {
    if (c.revision !== dto.expectedRevision || c.lockVersion !== dto.expectedLockVersion) {
      throw new ConflictException({ message: LOCK_MESSAGE, revision: c.revision, lockVersion: c.lockVersion });
    }
  }

  private async userNames(tenantId: string, ids: Array<string | null | undefined>) {
    const unique = [...new Set(ids.filter((v): v is string => !!v))];
    const users = unique.length
      ? await this.prisma.user.findMany({ where: { tenantId, id: { in: unique } }, select: { id: true, name: true } })
      : [];
    return new Map(users.map((u) => [u.id, u.name]));
  }

  private baseKey(articleId: string, lawEffectiveDate: Date | null) {
    return `${articleId}|${toDateOnlyString(impactReferenceDate(lawEffectiveDate, todayDateOnly()))}`;
  }

  /**
   * 기준 본문 버전들의 변수 연결과 그 변수들의 값(T-109 ②). 승인 때는 변수를 잠근 뒤 값을 읽는다(값 고치기와 줄 세움).
   */
  private async variableInputs(db: Prisma.TransactionClient, tenantId: string, versionIds: string[], lock = false) {
    const bindings = new Map<string, BindingInput[]>();
    if (!versionIds.length) return { bindings, values: [] as ValueInput[] };
    const rows = await db.variableBinding.findMany({
      where: { tenantId, versionId: { in: [...new Set(versionIds)] }, state: 'active' },
      select: {
        id: true,
        versionId: true,
        variableId: true,
        origin: true,
        start: true,
        end: true,
        text: true,
        variable: { select: { key: true, label: true } },
      },
    });
    const variableIds = [...new Set(rows.map((r) => r.variableId))];
    if (lock && variableIds.length) await db.$queryRaw`SELECT id FROM variables WHERE id = ANY(${variableIds}::text[]) FOR SHARE`;
    const values = variableIds.length
      ? await db.variableValue.findMany({
          where: { tenantId, variableId: { in: variableIds } },
          select: { id: true, variableId: true, value: true, validFrom: true, validTo: true, periodConfirmed: true },
        })
      : [];
    for (const r of rows) {
      const list = bindings.get(r.versionId) ?? [];
      list.push({ id: r.id, variableId: r.variableId, key: r.variable.key, label: r.variable.label, origin: r.origin, start: r.start, end: r.end, text: r.text });
      bindings.set(r.versionId, list);
    }
    return { bindings, values };
  }

  /** 조문별 발행 이력 지문(T-108) */
  private async fingerprints(articleIds: string[], db: Prisma.TransactionClient = this.prisma) {
    if (!articleIds.length) return new Map<string, string>();
    const versions = await db.articleVersion.findMany({
      where: { articleId: { in: articleIds }, status: { in: ['published', 'archived'] } },
      select: { id: true, articleId: true, status: true, effectiveDate: true, versionNum: true, repealedOn: true },
    });
    return new Map(articleIds.map((aid) => [aid, historyFingerprint(versions.filter((v) => v.articleId === aid))]));
  }

  /**
   * 기준 본문이 그 사이 바뀌었나 — 기준일에 조문이 폐지돼 있거나(`repealed`, T-126), 지금 다시 만들면 고를 기준
   * 본문이 다르거나(`base_changed`), 기준 본문은 같아도 발행 이력이 바뀌었으면(`history_changed` — 다른 버전
   * 발행·폐지·시행일 보정) 낡은 후보다.
   */
  private staleness(
    c: { baseVersionId: string; baseFingerprint: string | null },
    current: CurrentBase | null,
    currentFingerprint: string | null,
    variableChanged = false,
  ): { isCurrentBase: boolean; staleReason: 'repealed' | 'base_changed' | 'history_changed' | 'variable_changed' | null } {
    if (current?.repealed) return { isCurrentBase: false, staleReason: 'repealed' };
    if ((current?.id ?? null) !== c.baseVersionId) return { isCurrentBase: false, staleReason: 'base_changed' };
    if (c.baseFingerprint && currentFingerprint && currentFingerprint !== c.baseFingerprint) {
      return { isCurrentBase: false, staleReason: 'history_changed' };
    }
    // 기준 본문은 그대로여도 예정 시행일의 변수 값(값·유효기간·연결)이 바뀌었으면 낡은 후보다(T-109 ②)
    if (variableChanged) return { isCurrentBase: false, staleReason: 'variable_changed' };
    return { isCurrentBase: true, staleReason: null };
  }

  /**
   * 후보가 넣은 변수 값이 지금 예정 시행일 기준으로 다시 골라도 같은가 — 다른 후보 id 들(T-109 ②). 값을 고치거나
   * 연결을 새로 잇거나 풀면 후보는 그대로라, 화면이 그 사실을 알려야 한다(승인은 어차피 다시 확인한다).
   */
  private async variableDrift(
    tenantId: string,
    rows: Array<{ id: string; baseVersionId: string; baseContent: string; planned: Date; rationale: unknown }>,
  ): Promise<Set<string>> {
    const vin = await this.variableInputs(this.prisma, tenantId, rows.map((r) => r.baseVersionId));
    const drifted = new Set<string>();
    for (const r of rows) {
      const expected = planVariables(r.baseContent, vin.bindings.get(r.baseVersionId) ?? [], vin.values, r.planned).entries;
      const stored = (r.rationale as { variables?: VariableEntry[] } | null)?.variables;
      if (compareVariableEffects(stored, expected).length) drifted.add(r.id);
    }
    return drifted;
  }

  /**
   * 지금 다시 만들면 고를 제1 조문 — 시점 조회와 **같은 규칙**(`common/as-of.ts`)으로, 기준일마다 한 번씩 묻는다.
   * 규칙을 메모리에서 따로 흉내 내면 "화면에서 본 시행본"과 갈라진다. 기준일에 폐지된 조문은 기준 본문이 없다.
   */
  private async currentBases(items: Array<{ articleId: string; lawEffectiveDate: Date | null }>) {
    const byDate = new Map<string, { date: Date; articleIds: Set<string> }>();
    for (const it of items) {
      const date = impactReferenceDate(it.lawEffectiveDate, todayDateOnly());
      const key = toDateOnlyString(date);
      const entry = byDate.get(key) ?? { date, articleIds: new Set<string>() };
      entry.articleIds.add(it.articleId);
      byDate.set(key, entry);
    }
    const out = new Map<string, CurrentBase>();
    for (const [key, { date, articleIds }] of byDate) {
      const versions = await this.prisma.articleVersion.findMany({
        where: { articleId: { in: [...articleIds] }, ...asOfVersionWhere(date) },
        orderBy: [{ articleId: 'asc' }, ...AS_OF_VERSION_ORDER],
        distinct: ['articleId'],
        select: { id: true, articleId: true, repealedOn: true },
      });
      for (const id of articleIds) {
        const picked = versions.find((v) => v.articleId === id);
        const state = asOfState(picked, date);
        out.set(`${id}|${key}`, { id: state === 'in_force' ? picked!.id : null, repealed: state === 'repealed' });
      }
    }
    return out;
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
            effectiveInfo: true,
            promulgatedDate: true,
            law: { select: { lawName: true } },
            lawArticle: { select: { label: true } },
          },
        },
      },
    });
    if (!row) throw new NotFoundException('개정 후보를 찾을 수 없습니다.');
    const { article, changeEvent: e, ...rest } = row;

    const current = await this.currentBases([{ articleId: row.articleId, lawEffectiveDate: e.lawEffectiveDate }]);
    const currentNow = current.get(this.baseKey(row.articleId, e.lawEffectiveDate)) ?? null;
    const currentBaseId = currentNow?.id ?? null;
    const fps = await this.fingerprints([row.articleId]);
    const drifted = await this.variableDrift(tenantId, [
      { id: row.id, baseVersionId: row.baseVersionId, baseContent: row.baseVersion.content, planned: row.plannedEffectiveDate, rationale: row.rationale },
    ]);
    const stale = this.staleness(row, currentNow, fps.get(row.articleId) ?? null, drifted.has(row.id));
    const decision = await this.prisma.amendmentStateChange.findFirst({
      where: { candidateId: id, tenantId, toState: { in: ['approved', 'rejected'] } },
      orderBy: { createdAt: 'desc' },
      select: { toState: true, revision: true, reason: true, actorId: true, createdAt: true },
    });
    const correction = await correctionAfter(this.prisma, tenantId, id, decision?.createdAt ?? null);
    // 발행된 것만 결과다 — T-178 전 철회가 남긴 초안은 원천 후보를 쥐고 있어도 결과가 아니다
    const resultRow = await this.prisma.articleVersion.findUnique({
      where: { sourceCandidateId: id },
      select: { id: true, versionNum: true, effectiveDate: true, publishedAt: true, status: true },
    });
    const resultVersion =
      resultRow && (resultRow.status === 'published' || resultRow.status === 'archived')
        ? { id: resultRow.id, versionNum: resultRow.versionNum, effectiveDate: resultRow.effectiveDate, publishedAt: resultRow.publishedAt }
        : null;
    const currentBase =
      currentBaseId && currentBaseId !== row.baseVersionId
        ? await this.prisma.articleVersion.findUnique({
            where: { id: currentBaseId },
            select: { id: true, versionNum: true, effectiveDate: true, content: true },
          })
        : null;
    const reviewRequest =
      row.reviewState === 'review'
        ? await this.prisma.amendmentStateChange.findFirst({
            where: { candidateId: id, tenantId, toState: 'review' },
            orderBy: { createdAt: 'desc' },
            select: { id: true, revision: true, reason: true, actorId: true, createdAt: true },
          })
        : null;
    const siblings = await this.prisma.amendmentCandidate.findMany({
      where: { tenantId, changeEventId: row.changeEventId, articleId: row.articleId, id: { not: id } },
      orderBy: { createdAt: 'desc' },
      select: { id: true, reviewState: true, revision: true, createdAt: true, baseVersion: { select: { versionNum: true } } },
    });
    const names = await this.userNames(tenantId, [row.createdBy, reviewRequest?.actorId, decision?.actorId, correction?.actorId]);

    return {
      ...presentCandidate(rest),
      createdByName: row.createdBy ? names.get(row.createdBy) ?? null : null,
      ...stale,
      /** 마지막 결정(승인·반려) — 누가, 언제, 어느 판에, 왜 */
      decision: decision
        ? {
            state: decision.toState,
            revision: decision.revision,
            reason: decision.reason,
            at: decision.createdAt,
            by: decision.actorId ? { id: decision.actorId, name: names.get(decision.actorId) ?? null } : null,
          }
        : null,
      /** 마지막 결정 뒤의 정정(T-178) — 반려 정정(reject)·승인 철회(withdraw). 그 뒤 새 결정이 있으면 null */
      correction: correction
        ? {
            kind: correction.kind,
            revision: correction.revision,
            reason: correction.reason,
            at: correction.createdAt,
            by: correction.actorId ? { id: correction.actorId, name: names.get(correction.actorId) ?? null } : null,
          }
        : null,
      /** 승인으로 발행된 후속 버전 */
      resultVersion: resultVersion
        ? { ...resultVersion, effectiveDate: dateOnly(resultVersion.effectiveDate) }
        : null,
      /** 지금 다시 만들면 고를 기준 본문 — 이 후보의 제1 조문과 다를 때만(그 사이 조문이 개정됐다) */
      currentBase: currentBase
        ? { ...currentBase, effectiveDate: dateOnly(currentBase.effectiveDate) }
        : null,
      reviewRequest: reviewRequest
        ? {
            id: reviewRequest.id,
            revision: reviewRequest.revision,
            reason: reviewRequest.reason,
            requestedAt: reviewRequest.createdAt,
            requestedBy: reviewRequest.actorId ? { id: reviewRequest.actorId, name: names.get(reviewRequest.actorId) ?? null } : null,
          }
        : null,
      siblings: siblings.map((x) => ({
        id: x.id,
        reviewState: x.reviewState,
        revision: x.revision,
        createdAt: x.createdAt,
        baseVersionNum: x.baseVersion.versionNum,
      })),
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
        // 조별로 다른 시행일 표기(T-144) — 계획용 날짜(lawEffectiveDate)는 그대로이고, 알려 주기 위한 기록
        effectiveNotes: presentEventEffective(e.effectiveInfo),
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
    baseFingerprint: string,
    variables: { planned: Date; bindings: BindingInput[]; values: ValueInput[] },
  ): Prisma.AmendmentCandidateCreateManyInput {
    const base = item.baseVersion!;
    // 변수 값(T-109 ②) — 예정 사내 시행일에 맞는 값을 연결된 자리에. 법령 고침과 같은 자리면 엔진이 원문을 둔다
    const plan = planVariables(base.content, variables.bindings, variables.values, variables.planned);
    const r = generateRuleCandidate({
      lawBefore: event.beforeContent,
      lawAfter: event.afterContent,
      baseContent: base.content,
      relationType: item.relationType,
      scope: item.scope,
      evidenceText: item.evidenceText,
      variables: plan.proposals,
    });
    const variableEntries: VariableEntry[] = plan.entries.map((e) => {
      const applied = r.variableApplications.find((a) => a.ref === e.index);
      if (applied) return { ...e, candidate: applied.candidate };
      if (r.variableConflicts.includes(e.index)) return { ...e, status: 'conflict', reason: 'law_conflict' };
      return e;
    });
    const flags = new Set<string>(r.flags);
    if (variableEntries.some((e) => e.status === 'held')) flags.add('variable_unresolved');
    // 위 조항(조·항)에 건 연결로 찾았으면 바뀐 항·호가 이 조문에 맞는지 사람이 본다 — 규칙이 다 반영해도 '보통'까지(T-148)
    if (item.viaParent) flags.add(PARENT_LINK_FLAG);
    const confidence = item.viaParent
      ? { ...r.confidence, level: capConfidence(r.confidence.level, 'medium'), reasons: [...r.confidence.reasons, PARENT_LINK_FLAG] }
      : r.confidence;
    const lawLabel = event.lawArticle?.label ?? labelFromNodeKey(event.nodeKey);
    const asOf = toDateOnlyString(asOfDate);
    const usedRules = [...new Set(r.applications.map((a) => a.ruleId))];
    const usedTemplates = [...new Set(r.applications.map((a) => a.templateId))];

    // 근거는 만들 때의 스냅샷이다 — 연결·법령 본문이 나중에 바뀌어도 "그때 왜"가 남아야 한다(특허 도 12)
    const rationale = {
      version: 'rationale/2',
      law: {
        lawId: event.lawId,
        lawName: event.law.lawName,
        lawArticleId: event.lawArticleId,
        label: lawLabel,
        changeType: event.changeType,
        promulgatedDate: dateOnly(event.promulgatedDate),
        lawEffectiveDate: dateOnly(event.lawEffectiveDate),
        // 만들 때의 스냅샷(T-144) — 이후 판에서 표기가 바뀌어도 그때 어땠는지 남는다
        effectiveNotes: presentEventEffective(event.effectiveInfo),
        beforeVersionKey: event.beforeVersionKey,
        afterVersionKey: event.afterVersionKey,
      },
      lawChanges: r.lawChanges,
      link: {
        id: item.linkId,
        relationType: item.relationType,
        scope: item.scope,
        evidenceText: item.evidenceText,
        // 근거 문구의 원천 판과, 근거 문구가 기준 본문에 있는가(T-177) — 만들 때의 값. 기준 본문은 발행본이라 바뀌지 않는다.
        // 화면은 원천과 판이 다르다고 알리지 않고 근거 문구가 기준 본문에 없을 때 알린다. 재는 것은 본문에서 찾은 근거뿐(본문 밖 문구는 null)
        evidenceVersion: item.evidenceVersion ?? null,
        evidenceInBase: item.evidenceFromBody ? evidenceInContent(base.content, item.evidenceText) : null,
        confirmState: item.confirmState,
        confidence: item.linkConfidence,
        confirmedAt: item.confirmedAt,
        // 연결이 걸린 법령조항 — 바뀐 조항의 위 조항이면 viaParent(T-148)
        lawArticleId: item.linkLawArticleId,
        label: item.linkLabel,
        viaParent: item.viaParent,
      },
      path: [
        { type: 'lawArticle', id: event.lawArticleId, label: `${event.law.lawName} ${lawLabel}` },
        ...(item.viaParent ? [{ type: 'lawArticle', id: item.linkLawArticleId, label: `${event.law.lawName} ${item.linkLabel}` }] : []),
        { type: 'lawLink', id: item.linkId, label: item.relationType },
        { type: 'article', id: item.article.id, label: articlePathLabel(item.policy.title, item.article) },
      ],
      base: { versionId: base.id, versionNum: base.versionNum, effectiveDate: base.effectiveDate, asOf },
      applications: r.applications,
      unmapped: r.unmapped,
      conflicts: r.conflicts,
      // 변수 근거 — 법령 근거와 따로(특허 도 9·11): 연결·고른 값·유효기간·범위·위치 전후·넣었는지와 까닭
      variables: variableEntries,
    };
    const generationMeta = {
      engine: RULESET_VERSION,
      rules: Object.values(RULES).filter((x) => usedRules.includes(x.id)),
      templates: Object.values(TEMPLATES).filter((x) => usedTemplates.includes(x.id)),
      confidence,
      trigger: userId ? 'user' : 'system',
      // 입력 원천을 묶어 둔다 — 다른 개정의 본문이 섞이지 않았음을 확인할 수 있게(특허 도 10 입력 1010)
      source: {
        changeEventId: event.id,
        beforeVersionKey: event.beforeVersionKey,
        afterVersionKey: event.afterVersionKey,
        articleId: item.article.id,
        baseVersionId: base.id,
        baseFingerprint,
        lawLinkId: item.linkId,
        asOf,
        plannedEffectiveDate: toDateOnlyString(variables.planned),
      },
      variables: {
        version: 'var/1',
        plannedEffectiveDate: toDateOnlyString(variables.planned),
        applied: variableEntries.filter((e) => e.status === 'applied').length,
        held: variableEntries.filter((e) => e.status === 'held').length,
        conflict: variableEntries.filter((e) => e.status === 'conflict').length,
      },
    };

    return {
      tenantId,
      articleId: item.article.id,
      baseVersionId: base.id,
      baseFingerprint,
      changeEventId: event.id,
      lawLinkId: item.linkId,
      candidateContent: r.content,
      rationale: rationale as unknown as Prisma.InputJsonValue,
      diff: r.diff as unknown as Prisma.InputJsonValue,
      generationMethod: 'rule',
      variant: RULESET_VERSION,
      generationMeta: generationMeta as unknown as Prisma.InputJsonValue,
      confidence: confidence.level,
      reviewFlags: [...flags],
      asOfDate,
      plannedEffectiveDate: variables.planned,
      variableFingerprint: variableFingerprint(variableEntries),
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

/** 감사 기록용 변수 선택 요약(T-109 ②) */
function variableSummary(rationale: unknown) {
  return ((rationale as { variables?: VariableEntry[] } | null)?.variables ?? []).map((v) => ({
    bindingId: v.bindingId,
    key: v.key,
    status: v.status,
    reason: v.reason,
    valueId: v.valueId,
    value: v.value,
    validFrom: v.validFrom,
    validTo: v.validTo,
    scope: v.scope,
  }));
}
