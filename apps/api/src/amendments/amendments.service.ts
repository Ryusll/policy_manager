import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { formatJo } from '../common/article-label';
import { toDateOnlyString, todayDateOnly } from '../common/date-only';
import { AS_OF_VERSION_ORDER, asOfVersionWhere } from '../common/as-of';
import { impactReferenceDate } from '../law-changes/law-impact';
import { labelFromNodeKey } from '../laws/law-rows';
import {
  LawChangesService,
  UNRESOLVABLE_REMOVED,
  type ImpactedArticle,
  type ImpactSkipReason,
} from '../law-changes/law-changes.service';
import { diffLawText } from './amendment-text';
import { generateRuleCandidate, RULES, RULESET_VERSION, TEMPLATES } from './amendment-rules';
import { CANDIDATE_SELECT, currentState, presentCandidate } from './amendment-present';
import { contentHash, hasSubstantiveChange } from './amendment-revision';
import { diffCandidate, relinkDiff, type AppliedRule } from './amendment-diff';
import type { AmendmentListQueryDto, EditAmendmentDto, RequestReviewDto } from './amendments.dto';

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

const LOCK_MESSAGE = '그 사이 다른 사람이 이 후보를 고쳤거나 검토를 요청했습니다. 최신 내용을 불러온 뒤 다시 하세요.';

/** 손질·검토 요청이 확인하는 후보 정보 */
const OWNED_SELECT = {
  id: true,
  articleId: true,
  changeEventId: true,
  baseVersionId: true,
  candidateContent: true,
  rationale: true,
  revision: true,
  lockVersion: true,
  reviewState: true,
  baseVersion: { select: { content: true } },
  changeEvent: { select: { lawEffectiveDate: true } },
} satisfies Prisma.AmendmentCandidateSelect;

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
    opts: { asOf?: string; userId: string | null; notify?: boolean; articleId?: string },
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

    const impacted = (await this.lawChanges.impactedArticles(tenantId, event.lawArticleId, asOfDate)).filter(
      // "다시 만들기"(T-107)는 그 조문만 — 같은 이벤트의 다른 조문까지 새로 만들지 않는다
      (item) => !opts.articleId || item.article.id === opts.articleId,
    );
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
          reviewState: true,
          revision: true,
          candidateContent: true,
          diff: true,
          confidence: true,
          reviewFlags: true,
          asOfDate: true,
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

    const current = await this.currentBaseIds(
      rows.map((r) => ({ articleId: r.articleId, lawEffectiveDate: r.changeEvent.lawEffectiveDate })),
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
          isCurrentBase: current.get(this.baseKey(r.articleId, e.lawEffectiveDate)) === r.baseVersionId,
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

    const applied = ((cand.rationale as { applications?: AppliedRule[] } | null)?.applications ?? []) as AppliedRule[];
    const diff = relinkDiff(cand.baseVersion.content, content, applied);
    const nextRevision = cand.revision + 1;
    const fromState = cand.reviewState;

    await this.prisma.$transaction(async (tx) => {
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
    const current = await this.currentBaseIds([{ articleId: cand.articleId, lawEffectiveDate: cand.changeEvent.lawEffectiveDate }]);
    const baseChanged = current.get(this.baseKey(cand.articleId, cand.changeEvent.lawEffectiveDate)) !== cand.baseVersionId;

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
  async regenerate(tenantId: string, id: string, userId: string) {
    const cand = await this.findOwned(tenantId, id);
    const r = await this.generateForEvent(tenantId, cand.changeEventId, { userId, articleId: cand.articleId });
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
   * 지금 다시 만들면 고를 제1 조문 — 시점 조회와 **같은 규칙**(`common/as-of.ts`)으로, 기준일마다 한 번씩 묻는다.
   * 규칙을 메모리에서 따로 흉내 내면 "화면에서 본 시행본"과 갈라진다.
   */
  private async currentBaseIds(items: Array<{ articleId: string; lawEffectiveDate: Date | null }>) {
    const byDate = new Map<string, { date: Date; articleIds: Set<string> }>();
    for (const it of items) {
      const date = impactReferenceDate(it.lawEffectiveDate, todayDateOnly());
      const key = toDateOnlyString(date);
      const entry = byDate.get(key) ?? { date, articleIds: new Set<string>() };
      entry.articleIds.add(it.articleId);
      byDate.set(key, entry);
    }
    const out = new Map<string, string | null>();
    for (const [key, { date, articleIds }] of byDate) {
      const versions = await this.prisma.articleVersion.findMany({
        where: { articleId: { in: [...articleIds] }, ...asOfVersionWhere(date) },
        orderBy: [{ articleId: 'asc' }, ...AS_OF_VERSION_ORDER],
        distinct: ['articleId'],
        select: { id: true, articleId: true },
      });
      for (const id of articleIds) out.set(`${id}|${key}`, versions.find((v) => v.articleId === id)?.id ?? null);
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
            promulgatedDate: true,
            law: { select: { lawName: true } },
            lawArticle: { select: { label: true } },
          },
        },
      },
    });
    if (!row) throw new NotFoundException('개정 후보를 찾을 수 없습니다.');
    const { article, changeEvent: e, ...rest } = row;

    const current = await this.currentBaseIds([{ articleId: row.articleId, lawEffectiveDate: e.lawEffectiveDate }]);
    const currentBaseId = current.get(this.baseKey(row.articleId, e.lawEffectiveDate)) ?? null;
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
    const names = await this.userNames(tenantId, [row.createdBy, reviewRequest?.actorId]);

    return {
      ...presentCandidate(rest),
      createdByName: row.createdBy ? names.get(row.createdBy) ?? null : null,
      isCurrentBase: currentBaseId === row.baseVersionId,
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
