import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { VariablesService } from '../variables/variables.service';
import { VersionsService, assertAfterRepeal, previousIssued } from '../versions/versions.service';
import { RevisionNotifyService } from '../notifications/revision-notify.service';
import { parseDateOnly, toDateOnlyString, todayDateOnly } from '../common/date-only';
import {
  freezeIssued,
  liveStructures,
  parseProposal,
  parseSnapshot,
  sameStructure,
  type Position,
  type StructureProposal,
} from '../common/article-structure';
import { normalizeText, positionLabel } from './reparse-match';
import { bundleState } from './reparse-state';
import { planApply, type ApplyPlan, type ParsedJson, type PlanArticle, type PlanItem } from './reparse-apply-plan';
import { findBoundaryConflicts, type BoundaryArticle } from './reparse-boundary';
import { undecidedCount } from './reparse-decisions';
import { ReparseService, treeFingerprint } from './reparse.service';
import { LONG_LOCK_WAIT_MS, lockArticleRow, lockParseSessionRow, lockPolicyRow, lockPolicyWithArticles, lockReparseReviewRow } from '../common/row-locks';
import type { RegulationArticleNode } from './regulation-tree.builder';

type Tx = Prisma.TransactionClient;

/** 큰 규정(수백 조문)도 한 트랜잭션에 — 한꺼번에 시행과 같은 한도 */
const TX = { maxWait: 10_000, timeout: 60_000 };

type StoredPlan = {
  rowUpdates?: ApplyPlan['rowUpdates'];
  chapters: ApplyPlan['chapters'];
  sections: ApplyPlan['sections'];
  newArticles: ApplyPlan['newArticles'];
  repeals: ApplyPlan['repeals'];
};

const day = (d: Date | null) => (d ? toDateOnlyString(d) : null);
const labelOfPosition = (p: Position) =>
  positionLabel({ number: p.number, branch: p.branchNumber, clause: p.clauseNumber, item: p.itemNumber });

/**
 * 재파싱 반영과 묶음 승인 (T-110 ②, 특허 청구항 2·도 6 S650~S652, 사용자 지시로 코덱스 자문).
 *
 * 반영(apply) — 검토 대상 만들기: 기존 조문의 초안(본문·제안 계층)만 만든다. 새 조문·새 장·절은 계획에만 둔다(승인 때 만든다).
 * 묶음 검토 요청(submit) — 묶음 초안을 한꺼번에 검토 중으로(변수 표식은 그날 값으로).
 * 묶음 승인(approve, 관리자) — 같은 시행일로 전부 되거나 전부 안 된다: 계층이 바뀌는 조문의 발행 이력을 얼리고, 장·절을 만들거나
 *   고치고, 묶음 버전을 후속 버전으로 발행(제안 계층을 조문 행에), 새 조문을 만들고, 폐지로 정한 조문을 그 날로 폐지한다.
 * 묶음 반려(reject, 관리자) — 묶음 초안을 거둔다. 새 조문·장·절은 아직 만들지 않았으니 남는 행이 없다.
 * 단계마다 규정 → 조문(id 순) 잠금 아래 규정 상태 지문을 다시 계산해 그 사이 바뀌었으면 409.
 */
@Injectable()
export class ReparseBundleService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
    private variables: VariablesService,
    private versions: VersionsService,
    private revisionNotify: RevisionNotifyService,
    private reparse: ReparseService,
  ) {}

  /**
   * 규정 → 그 규정의 모든 조문(id 순) → 이 검토 행 — 계층 변경 경로·버전 경로·결정·다시 비교와 같은 순서로 줄 세운다(T-131).
   * 검토 행까지 잡은 뒤에 결정·상태를 읽는다 — 그 전에 읽으면 그 사이 커밋된 결정이나 다시 비교를 보지 못한 채 묶음을 만든다
   */
  private async lockBundle(tx: Tx, policyId: string, reviewId: string, tenantId: string) {
    await lockPolicyWithArticles(tx, policyId, LONG_LOCK_WAIT_MS);
    if (!(await lockReparseReviewRow(tx, reviewId, tenantId, LONG_LOCK_WAIT_MS))) throw new NotFoundException('Reparse review not found');
  }

  private async loadReview(tenantId: string, id: string) {
    const review = await this.prisma.reparseReview.findFirst({ where: { id, tenantId }, select: { id: true, policyId: true } });
    if (!review) throw new NotFoundException('Reparse review not found');
    return review;
  }

  /** 반영 — 검토 대상(묶음 초안·계획)을 만든다. 지금 계층·본문은 바꾸지 않는다 */
  async apply(tenantId: string, userId: string, id: string) {
    const { policyId } = await this.loadReview(tenantId, id);
    await this.prisma.$transaction(async (tx) => {
      await this.lockBundle(tx, policyId, id, tenantId);
      // 원문 세션도 잡는다(T-131, 순서의 맨 끝) — 반영이 원문을 다 쓴 것으로 둘 때까지 원문 미리보기 고치기·다른 비교가 끼어들지 않게
      const { sessionId } = await tx.reparseReview.findUniqueOrThrow({ where: { id }, select: { sessionId: true } });
      if (sessionId) await lockParseSessionRow(tx, sessionId, LONG_LOCK_WAIT_MS);
      const review = await tx.reparseReview.findUniqueOrThrow({
        where: { id },
        include: { items: { orderBy: { seq: 'asc' } }, session: { select: { id: true, parseTree: true, status: true } } },
      });
      if (review.status !== 'open') throw new ConflictException('이미 반영했거나 지나간 검토입니다.');
      const undecided = undecidedCount(review.items);
      if (undecided) throw new BadRequestException(`결정이 남은 항목이 ${undecided}건 있습니다 — 모두 정하거나 보류로 두세요.`);
      const summary = review.summary as { treeFingerprint?: string; chapters?: { change: string; parsed: PlanChapter | null; stored: { id: string } | null }[] };
      if (!review.session) throw new ConflictException('원문이 지워졌습니다 — 원문을 다시 가져와 비교하세요.');
      if (treeFingerprint((review.session.parseTree as { roots?: RegulationArticleNode[] } | null)?.roots) !== summary.treeFingerprint) {
        throw new ConflictException('비교한 뒤 원문 미리보기를 고쳤습니다 — 다시 비교하세요.');
      }
      const stored = await this.reparse.loadStored(tx, policyId);
      if (stored.state !== review.stateFingerprint) throw new ConflictException('비교한 뒤 이 규정이 바뀌었습니다 — 다시 비교하세요.');

      const lives = await liveStructures(tx, stored.rows.map((r) => r.articleId));
      const articles = new Map<string, PlanArticle>(
        stored.rows.map((r) => [
          r.articleId,
          {
            id: r.articleId,
            live: lives.get(r.articleId)!,
            base: r.base,
            inForce: !!r.base && (r.base.status === 'published' || r.base.status === 'archived') && !r.repealed,
            repealed: r.repealed,
            pending: r.pending,
          },
        ]),
      );
      const planItems: PlanItem[] = review.items.map((i) => ({
        id: i.id,
        kind: i.kind,
        decision: i.decision,
        articleId: i.articleId,
        targetArticleId: i.targetArticleId,
        parsed: i.parsed as ParsedJson | null,
        label: (i.parsed as { label?: string } | null)?.label ?? (i.stored as { label?: string } | null)?.label ?? '항목',
      }));
      const plan = planApply(
        planItems,
        articles,
        stored.chapters,
        (summary.chapters ?? []).map((c) => ({ parsed: c.parsed, storedId: c.stored?.id ?? null, change: c.change })),
      );
      if (plan.conflicts.length) {
        const labels = plan.conflicts.map((c) => `${c.label}(${c.status === 'review' ? '검토 중' : '초안'})`).join(', ');
        throw new ConflictException(`초안·검토 중 버전이 남은 조문이 있어 반영하지 못합니다: ${labels} — 그 버전을 먼저 처리하거나 그 항목을 보류로 두세요.`);
      }
      const changes =
        plan.drafts.length + plan.newArticles.length + plan.rowUpdates.length + plan.chapters.create.length + plan.chapters.update.length +
        plan.sections.create.length + plan.sections.update.length + plan.repeals.length;
      if (!changes) throw new BadRequestException('반영할 변경이 없습니다 — 모두 그대로이거나 보류·유지입니다.');
      const labelOf = new Map(planItems.map((i) => [i.id, i.label]));
      // 바로 발행할 본문은 아니지만 새 조문은 고칠 수 없어서 지금 막는다. 개정 초안은 검토 요청 때 그날 값으로 바뀐다
      await this.variables.assertNoMarkers(
        tx,
        tenantId,
        plan.newArticles.map((n) => ({ label: labelOf.get(n.itemId) ?? '새 조문', content: n.content })),
        '새 조문은 고칠 수 없으니 원문을 고쳐 다시 비교하세요.',
      );

      // 묶음 초안 — 조문마다 다음 버전 번호
      const maxNums = plan.drafts.length
        ? await tx.articleVersion.groupBy({ by: ['articleId'], where: { articleId: { in: plan.drafts.map((d) => d.articleId) } }, _max: { versionNum: true } })
        : [];
      const nextNum = new Map(maxNums.map((m) => [m.articleId, (m._max.versionNum ?? 0) + 1]));
      const outcomes = new Map<string, Record<string, unknown>>();
      for (const d of plan.drafts) {
        const itemId = d.itemId;
        const v = await tx.articleVersion.create({
          data: {
            articleId: d.articleId,
            versionNum: nextNum.get(d.articleId) ?? 1,
            content: d.content,
            status: 'draft',
            changeNote: `재파싱 반영 — ${review.sourceName}`,
            createdBy: userId,
            structure: d.proposal ? (d.proposal as unknown as Prisma.InputJsonValue) : Prisma.DbNull,
            reparseItemId: itemId,
          },
        });
        outcomes.set(itemId, { action: d.reason, versionId: v.id, articleId: d.articleId });
      }
      for (const n of plan.newArticles) outcomes.set(n.itemId, { action: 'create' });
      for (const r of plan.rowUpdates) outcomes.set(r.itemId, { action: 'row', articleId: r.articleId });
      for (const r of plan.released) {
        outcomes.set(r.itemId, { ...(outcomes.get(r.itemId) ?? { action: 'create' }), released: { articleId: r.articleId } });
      }
      for (const r of plan.repeals) outcomes.set(r.itemId, { action: 'repeal', status: 'planned' });
      for (const u of plan.untouched) if (!outcomes.has(u.itemId)) outcomes.set(u.itemId, { action: u.why });
      for (const [itemId, outcome] of outcomes) {
        await tx.reparseReviewItem.update({ where: { id: itemId }, data: { outcome: outcome as Prisma.InputJsonValue } });
      }

      // 원문은 다 썼다 — 같은 원문으로 다른 반영·새 규정 등록을 하지 않는다(반려하면 되돌린다)
      const used = await tx.regulationParseSession.updateMany({
        where: { id: review.session.id, status: 'ready', committedPolicyId: null },
        data: { status: 'committed', committedPolicyId: policyId },
      });
      if (used.count !== 1) throw new ConflictException('이 원문은 이미 다른 반영이나 새 규정 등록에 썼습니다 — 원문을 다시 가져오세요.');
      const stored_: StoredPlan = {
        rowUpdates: plan.rowUpdates,
        chapters: plan.chapters,
        sections: plan.sections,
        newArticles: plan.newArticles,
        repeals: plan.repeals,
      };
      const fingerprint = await bundleState(tx, policyId, stored_, false);
      await tx.reparseReview.update({
        where: { id },
        data: {
          status: 'applied',
          appliedAt: new Date(),
          appliedBy: userId,
          plan: stored_ as unknown as Prisma.InputJsonValue,
          bundleFingerprint: fingerprint,
        },
      });
      await tx.auditLog.create({
        data: {
          tenantId,
          userId,
          action: 'reparse.apply',
          entityType: 'Policy',
          entityId: policyId,
          details: {
            reviewId: id,
            drafts: plan.drafts.map((d) => ({ articleId: d.articleId, reason: d.reason })),
            newArticles: plan.newArticles.length,
            chapters: { create: plan.chapters.create.length, update: plan.chapters.update.length },
            sections: { create: plan.sections.create.length, update: plan.sections.update.length },
            released: plan.released.length,
            repeals: plan.repeals.length,
          } as Prisma.InputJsonValue,
        },
      });
    }, TX);
    return this.reparse.get(tenantId, id);
  }

  /** 묶음 검토 요청 — 묶음 초안을 한꺼번에 검토 중으로. 본문의 변수 표식은 오늘 값으로 바꾼다(단건 검토 요청과 같다) */
  async submit(tenantId: string, userId: string, id: string) {
    const { policyId } = await this.loadReview(tenantId, id);
    const today = todayDateOnly();
    await this.prisma.$transaction(async (tx) => {
      await this.lockBundle(tx, policyId, id, tenantId);
      const review = await tx.reparseReview.findUniqueOrThrow({ where: { id } });
      if (review.status !== 'applied') throw new ConflictException('반영한 묶음만 검토 요청할 수 있습니다.');
      if ((await bundleState(tx, policyId, review.plan, false)) !== review.bundleFingerprint) {
        throw new ConflictException('반영한 뒤 이 규정이 바뀌었습니다(다른 초안·개정·순서 변경 등) — 묶음을 반려하고 다시 비교하세요.');
      }
      const drafts = await tx.articleVersion.findMany({ where: { reparseItem: { reviewId: id } }, orderBy: { articleId: 'asc' } });
      if (drafts.some((v) => v.status !== 'draft')) throw new ConflictException('묶음 초안의 상태가 바뀌었습니다 — 화면을 새로 고치세요.');
      const variables: { versionId: string; key: string; value: string }[] = [];
      for (const v of drafts) {
        const { content, applied } = await this.variables.resolveMarkers(tx, tenantId, v.content, today);
        await tx.articleVersion.update({
          where: { id: v.id },
          data: { status: 'review', reviewNote: null, ...(applied.length ? { content } : {}) },
        });
        if (applied.length) {
          await this.variables.reanchorVersion(tx, v.id, v.content, content);
          await this.variables.createMarkerBindings(tx, tenantId, { id: v.id, articleId: v.articleId, content }, applied, userId);
          for (const a of applied) variables.push({ versionId: v.id, key: a.key, value: a.value });
        }
      }
      const fingerprint = await bundleState(tx, policyId, review.plan, true);
      await tx.reparseReview.update({
        where: { id },
        data: { status: 'submitted', submittedAt: new Date(), submittedBy: userId, bundleFingerprint: fingerprint },
      });
      await tx.auditLog.create({
        data: {
          tenantId,
          userId,
          action: 'reparse.submit',
          entityType: 'Policy',
          entityId: policyId,
          details: { reviewId: id, versions: drafts.length, ...(variables.length ? { variables } : {}) } as Prisma.InputJsonValue,
        },
      });
    }, TX);
    return this.reparse.get(tenantId, id);
  }

  /** 묶음 승인(관리자) — 같은 시행일로 전부 되거나 전부 안 된다 */
  async approve(tenantId: string, userId: string, id: string, dto: { effectiveDate: string; changeNote: string }) {
    const reason = dto.changeNote?.trim();
    if (!reason) throw new BadRequestException('개정 사유를 입력하세요.');
    const effective = parseDateOnly(dto.effectiveDate);
    if (!effective) throw new BadRequestException('사내 규정 시행일(YYYY-MM-DD)을 입력하세요.');
    const E = toDateOnlyString(effective);
    const today = todayDateOnly();
    const { policyId } = await this.loadReview(tenantId, id);
    const result = await this.prisma.$transaction(async (tx) => {
      await this.lockBundle(tx, policyId, id, tenantId);
      const review = await tx.reparseReview.findUniqueOrThrow({ where: { id }, include: { items: true } });
      if (review.status !== 'submitted') throw new ConflictException('검토 요청한 묶음만 승인할 수 있습니다.');
      if ((await bundleState(tx, policyId, review.plan, true)) !== review.bundleFingerprint) {
        throw new ConflictException('검토 요청한 뒤 이 규정이 바뀌었습니다 — 묶음을 반려하고 다시 비교하세요.');
      }
      const plan = review.plan as unknown as StoredPlan;
      const bundle = await tx.articleVersion.findMany({ where: { reparseItem: { reviewId: id } } });
      if (bundle.some((v) => v.status !== 'review')) throw new ConflictException('묶음 버전의 상태가 바뀌었습니다 — 화면을 새로 고치세요.');
      const articles = await tx.article.findMany({
        where: { chapter: { policyId } },
        select: {
          id: true,
          sectionId: true,
          chapterId: true,
          versions: {
            where: { status: { in: ['published', 'archived'] } },
            select: { id: true, versionNum: true, status: true, effectiveDate: true, repealedOn: true, structure: true },
          },
        },
      });
      const lives = await liveStructures(tx, articles.map((a) => a.id));
      const touchedChapters = new Set(plan.chapters.update.map((c) => c.id));
      const touchedSections = new Set(plan.sections.update.map((s) => s.id));
      const bundleOf = new Map(bundle.map((v) => [v.articleId, v]));
      const proposalOf = new Map(bundle.map((v) => [v.articleId, parseProposal(v.structure)]));
      const label = (articleId: string) => {
        const live = lives.get(articleId)!;
        return labelOfPosition(live);
      };

      // 1) 묶음 버전마다: 더 늦은 시행본 없음, 폐지 뒤 다시 시행이면 폐지일 이후, 변수, 제안의 기준 계층
      for (const v of bundle) {
        const a = articles.find((x) => x.id === v.articleId)!;
        const later = a.versions.find((x) => x.effectiveDate && toDateOnlyString(x.effectiveDate) > E);
        if (later) {
          throw new ConflictException(`${label(v.articleId)}: ${toDateOnlyString(later.effectiveDate!)} 시행본이 있어 그보다 이른 날(${E})로 승인할 수 없습니다.`);
        }
        await assertAfterRepeal(tx, v.articleId, effective);
        await this.variables.assertNoMarkers(tx, tenantId, [{ label: label(v.articleId), content: v.content }]);
        await this.variables.assertMarkerValuesAt(tx, v.id, effective);
        const proposal = proposalOf.get(v.articleId);
        if (proposal && !sameStructure(proposal.base, lives.get(v.articleId)!)) {
          throw new ConflictException(`${label(v.articleId)}: 제안할 때와 지금 계층이 다릅니다 — 묶음을 반려하고 다시 비교하세요.`);
        }
      }
      // 새 조문 본문도 다시 본다(T-131) — 반영한 뒤 변수가 등록되면 그 문구가 표식이 된다. 새 조문은 고칠 수 없으니 반려하고 다시 비교
      const newBodies = plan.newArticles.filter((n) => normalizeText(n.content));
      await this.variables.assertNoMarkers(
        tx,
        tenantId,
        newBodies.map((n) => ({
          label: `${labelOfPosition({ number: n.number, branchNumber: n.branchNumber, clauseNumber: n.clauseNumber, itemNumber: n.itemNumber })}(새 조문)`,
          content: n.content,
        })),
        '새 조문은 고칠 수 없으니 묶음을 반려하고 원문을 고쳐 다시 비교하세요.',
      );
      // 2) 폐지 — 시행일이 오늘 이전이면 그 날로(그날 시행 중인 시행본, 더 늦은 시행본 없음). 미래면 미결로 남긴다
      const executeRepeals = effective.getTime() <= today.getTime();
      const repealVersions = new Map<string, string>();
      for (const r of plan.repeals) {
        const a = articles.find((x) => x.id === r.articleId);
        if (!a) continue;
        if (!executeRepeals) {
          const live = lives.get(a.id)!;
          if (touchedChapters.has(live.chapter.id) || (live.section && touchedSections.has(live.section.id))) {
            throw new ConflictException(`${label(a.id)}: 폐지로 정한 조문이 번호·제목이 바뀌는 장·절에 있어, 시행일이 미래면 함께 처리할 수 없습니다 — 시행일을 오늘로 하거나 묶음을 다시 만드세요.`);
          }
          continue;
        }
        const current = a.versions.find((x) => x.status === 'published');
        if (!current || !current.effectiveDate || toDateOnlyString(current.effectiveDate) > E) {
          throw new ConflictException(`${label(a.id)}: ${E}에 시행 중인 시행본이 없어 그 날로 폐지할 수 없습니다.`);
        }
        repealVersions.set(a.id, current.id);
      }
      // 3) 승인 시행일부터 모든 경계에서 자리 겹침
      const after = (articleId: string): Position => {
        const p = proposalOf.get(articleId);
        return p ?? lives.get(articleId)!;
      };
      const boundary: BoundaryArticle[] = articles
        .filter((a) => a.versions.length || bundleOf.has(a.id))
        .map((a) => {
          const live = lives.get(a.id)!;
          const bv = bundleOf.get(a.id);
          return {
            id: a.id,
            label: labelOfPosition(live),
            after: after(a.id),
            repealAt: repealVersions.has(a.id) ? E : null,
            versions: [
              ...a.versions.map((x) => ({
                versionNum: x.versionNum,
                effectiveDate: day(x.effectiveDate),
                repealedOn: day(x.repealedOn),
                frozen: parseSnapshot(x.structure),
              })),
              ...(bv ? [{ versionNum: bv.versionNum, effectiveDate: E, repealedOn: null, frozen: null, bundle: true }] : []),
            ],
          };
        });
      for (const n of plan.newArticles) {
        // 본문 없는 조 머리 행은 버전이 없어 시행 중인 조문이 아니다
        if (!normalizeText(n.content)) continue;
        const position = { number: n.number, branchNumber: n.branchNumber, clauseNumber: n.clauseNumber, itemNumber: n.itemNumber };
        boundary.push({
          id: `new:${n.itemId}`,
          label: `${labelOfPosition(position)}(새 조문)`,
          after: position,
          versions: [{ versionNum: 1, effectiveDate: E, repealedOn: null, frozen: null, bundle: true }],
        });
      }
      const clashes = findBoundaryConflicts(boundary, E);
      if (clashes.length) {
        const first = clashes
          .slice(0, 3)
          .map((c) => `${c.date} ${c.labels.join('·')}`)
          .join(' / ');
        throw new ConflictException(`승인하면 같은 자리에 시행 중인 조문이 둘 이상이 됩니다: ${first} — 원문에 없는 조문을 폐지로 정하거나 묶음을 다시 만드세요.`);
      }

      // 4) 계층이 바뀌는 조문의 발행 이력을 얼린다 — 장·절 번호·제목이 바뀌는 조문(폐지된 것까지)도
      for (const a of articles) {
        const live = lives.get(a.id)!;
        const changes =
          !!proposalOf.get(a.id) || touchedChapters.has(live.chapter.id) || (!!live.section && touchedSections.has(live.section.id));
        if (changes && a.versions.length) await freezeIssued(tx, a.id, live);
      }
      // 5) 장·절 — 새로 만들고, 기존 장·절의 번호·제목을 바꾼다
      const chapterIdOf = new Map<string, string>();
      for (const c of plan.chapters.create) {
        const created = await tx.chapter.create({ data: { policyId, number: c.number, title: c.title, suppressHeader: c.hidden } });
        chapterIdOf.set(c.key, created.id);
      }
      for (const c of plan.chapters.update) {
        await tx.chapter.update({ where: { id: c.id }, data: { number: c.number, title: c.title, suppressHeader: c.hidden } });
      }
      const chapterRef = (ref: { id: string | null; key: string | null }) => ref.id ?? chapterIdOf.get(ref.key!)!;
      const sectionIdOf = new Map<string, string>();
      for (const s of plan.sections.create) {
        const created = await tx.section.create({ data: { chapterId: chapterRef(s.chapter), number: s.number, title: s.title } });
        sectionIdOf.set(s.key, created.id);
      }
      for (const s of plan.sections.update) {
        await tx.section.update({ where: { id: s.id }, data: { number: s.number, title: s.title } });
      }
      const sectionRef = (ref: { id: string | null; key: string | null } | null) => (ref ? ref.id ?? sectionIdOf.get(ref.key!)! : null);

      // 6) 묶음 버전 발행 — 앞 시행본은 내려가고, 제안 계층은 조문 행으로
      const now = new Date();
      const published: { articleId: string; versionId: string }[] = [];
      for (const v of bundle) {
        const previous = await previousIssued(tx, v.articleId, v.id);
        await tx.articleVersion.updateMany({ where: { articleId: v.articleId, status: 'published', id: { not: v.id } }, data: { status: 'archived' } });
        await tx.articleVersion.update({
          where: { id: v.id },
          data: {
            status: 'published',
            approvedBy: userId,
            approvedAt: now,
            publishedAt: now,
            effectiveDate: effective,
            changeNote: reason,
            structure: Prisma.DbNull,
          },
        });
        const proposal: StructureProposal | null = proposalOf.get(v.articleId) ?? null;
        if (proposal) {
          await tx.article.update({
            where: { id: v.articleId },
            data: {
              chapterId: chapterRef(proposal.chapter),
              sectionId: sectionRef(proposal.section),
              number: proposal.number,
              branchNumber: proposal.branchNumber,
              clauseNumber: proposal.clauseNumber,
              itemNumber: proposal.itemNumber,
              title: proposal.title,
            },
          });
        }
        await this.variables.inheritBindings(tx, tenantId, previous, { id: v.id, articleId: v.articleId, content: v.content }, userId);
        published.push({ articleId: v.articleId, versionId: v.id });
      }
      // 6-2) 버전이 없는 조 머리 행 — 이력이 없으니 조문 행만 고친다(제안할 때의 계층과 같을 때만)
      for (const r of plan.rowUpdates ?? []) {
        const live = lives.get(r.articleId);
        if (!live || !sameStructure(r.proposal.base, live)) {
          throw new ConflictException('제안할 때와 지금 계층이 다른 조 머리 행이 있습니다 — 묶음을 반려하고 다시 비교하세요.');
        }
        await tx.article.update({
          where: { id: r.articleId },
          data: {
            chapterId: chapterRef(r.proposal.chapter),
            sectionId: sectionRef(r.proposal.section),
            number: r.proposal.number,
            branchNumber: r.proposal.branchNumber,
            clauseNumber: r.proposal.clauseNumber,
            itemNumber: r.proposal.itemNumber,
            title: r.proposal.title,
          },
        });
      }
      // 7) 새 조문 — 행과 첫 버전(그 시행일로 발행). 본문 없는 조 머리 행은 가져오기와 같이 버전 없이 행만
      const createdArticles: { itemId: string; articleId: string; versionId: string | null }[] = [];
      for (const n of plan.newArticles) {
        const article = await tx.article.create({
          data: {
            chapterId: chapterRef(n.chapter),
            sectionId: sectionRef(n.section),
            number: n.number,
            branchNumber: n.branchNumber,
            clauseNumber: n.clauseNumber,
            itemNumber: n.itemNumber,
            title: n.title,
          },
        });
        if (!normalizeText(n.content)) {
          createdArticles.push({ itemId: n.itemId, articleId: article.id, versionId: null });
          continue;
        }
        const v = await tx.articleVersion.create({
          data: {
            articleId: article.id,
            versionNum: 1,
            content: n.content,
            status: 'published',
            changeNote: reason,
            createdBy: userId,
            approvedBy: userId,
            approvedAt: now,
            publishedAt: now,
            effectiveDate: effective,
            reparseItemId: n.itemId,
          },
        });
        createdArticles.push({ itemId: n.itemId, articleId: article.id, versionId: v.id });
      }
      // 8) 폐지
      for (const [articleId, versionId] of repealVersions) {
        await tx.articleVersion.update({ where: { id: versionId }, data: { status: 'archived', repealedOn: effective } });
        void articleId;
      }
      // 9) 항목 결과·검토·감사
      for (const c of createdArticles) {
        const item = review.items.find((i) => i.id === c.itemId)!;
        await tx.reparseReviewItem.update({
          where: { id: c.itemId },
          data: { outcome: { ...((item.outcome as object) ?? {}), action: 'create', articleId: c.articleId, versionId: c.versionId } as Prisma.InputJsonValue },
        });
      }
      for (const r of plan.rowUpdates ?? []) {
        const item = review.items.find((i) => i.id === r.itemId)!;
        await tx.reparseReviewItem.update({
          where: { id: r.itemId },
          data: { outcome: { ...((item.outcome as object) ?? {}), action: 'row', status: 'done' } as Prisma.InputJsonValue },
        });
      }
      for (const r of plan.repeals) {
        const item = review.items.find((i) => i.id === r.itemId)!;
        await tx.reparseReviewItem.update({
          where: { id: r.itemId },
          data: {
            outcome: (executeRepeals
              ? { action: 'repeal', status: 'done', repealedOn: E, versionId: repealVersions.get(r.articleId) ?? null }
              : { action: 'repeal', status: 'deferred' }) as Prisma.InputJsonValue,
          },
        });
        void item;
      }
      await tx.reparseReview.update({
        where: { id },
        data: { status: 'approved', effectiveDate: effective, changeNote: reason, approvedAt: now, approvedBy: userId },
      });
      await tx.auditLog.create({
        data: {
          tenantId,
          userId,
          action: 'reparse.approve',
          entityType: 'Policy',
          entityId: policyId,
          details: {
            reviewId: id,
            effectiveDate: E,
            changeNote: reason,
            published: published.map((p) => p.versionId),
            created: createdArticles.map((c) => c.articleId),
            repealed: executeRepeals ? [...repealVersions.keys()] : [],
            repealDeferred: executeRepeals ? [] : plan.repeals.map((r) => r.articleId),
            chapters: { create: plan.chapters.create.length, update: plan.chapters.update.length },
          } as Prisma.InputJsonValue,
        },
      });
      return { published, createdArticles };
    }, TX);

    // 개정 알림 — 조문 수만큼이 아니라 한 번
    const first = result.published[0] ?? result.createdArticles.find((c) => c.versionId);
    if (first) {
      const policy = await this.prisma.policy.findUnique({ where: { id: policyId }, select: { id: true, title: true, code: true, metadata: true } });
      const count = result.published.length + result.createdArticles.filter((c) => c.versionId).length;
      const notify = await this.revisionNotify.dispatchPolicyRevisionApproved({
        tenantId,
        policyId,
        policyTitle: policy!.title,
        policyCode: policy!.code,
        articleId: first.articleId,
        articleLabel: `재파싱 반영 ${count}개 조문`,
        versionId: first.versionId,
        changeNote: reason,
        approvedByUserId: userId,
        metadata: policy!.metadata,
        effectiveDate: effective,
      });
      if (notify.sent > 0) {
        await this.audit.log({
          tenantId,
          userId,
          action: 'revision.notify_sent',
          entityType: 'Policy',
          entityId: policyId,
          details: { reparseReviewId: id, count, recipientCount: notify.sent },
        });
      }
    }
    return this.reparse.get(tenantId, id);
  }

  /** 묶음 반려(관리자) — 묶음 초안을 거두고, 원문을 다시 비교할 수 있게 돌려 둔다 */
  async reject(tenantId: string, userId: string, id: string, reasonInput: string) {
    const reason = reasonInput?.trim();
    if (!reason) throw new BadRequestException('반려 사유를 입력하세요.');
    const { policyId } = await this.loadReview(tenantId, id);
    await this.prisma.$transaction(async (tx) => {
      await this.lockBundle(tx, policyId, id, tenantId);
      const review = await tx.reparseReview.findUniqueOrThrow({ where: { id } });
      if (review.status !== 'applied' && review.status !== 'submitted') throw new ConflictException('반영했거나 검토 요청한 묶음만 반려할 수 있습니다.');
      // 묶음 초안은 발행된 적 없는 검토 대상이라 지운다(무엇을 제안했는지는 검토 항목·감사 기록에 남는다). 제안 계층을 가진 초안이
      // 일반 초안으로 남아 단건 승인되면 제안이 시행본에 남기 때문에 떼어 두지 않는다
      const rejected = await tx.articleVersion.deleteMany({
        where: { reparseItem: { reviewId: id }, status: { in: ['draft', 'review'] } },
      });
      await tx.reparseReview.update({
        where: { id },
        data: { status: 'rejected', rejectedAt: new Date(), rejectedBy: userId, rejectReason: reason },
      });
      if (review.sessionId) {
        await tx.regulationParseSession.updateMany({
          where: { id: review.sessionId, status: 'committed', committedPolicyId: policyId },
          data: { status: 'ready', committedPolicyId: null },
        });
      }
      await tx.auditLog.create({
        data: {
          tenantId,
          userId,
          action: 'reparse.reject',
          entityType: 'Policy',
          entityId: policyId,
          details: { reviewId: id, reason, versions: rejected.count } as Prisma.InputJsonValue,
        },
      });
    }, TX);
    return this.reparse.get(tenantId, id);
  }

  /**
   * 원문에 없는 조문의 삭제 여부를 승인 뒤에 정한다 — 유지로 닫거나, 관리자가 오늘 폐지(T-126 절차 그대로).
   * 반영 전에는 검토의 결정으로 정하고, 반영부터 승인 전까지는 묶음 계획이라 바꾸지 않는다.
   */
  async resolveMissing(tenantId: string, userId: string, role: string, id: string, itemId: string, decision: 'keep' | 'repeal') {
    const { policyId } = await this.loadReview(tenantId, id);
    const pre = await this.prisma.reparseReviewItem.findFirst({ where: { id: itemId, reviewId: id }, select: { kind: true, articleId: true } });
    if (!pre || pre.kind !== 'missing' || !pre.articleId) throw new BadRequestException('원문에 없는 조문 항목이 아닙니다.');
    const articleId = pre.articleId;
    // 규정 → 조문 → 검토 행 순서로 잡고(T-131) 상태·항목을 다시 읽는다. 폐지와 항목 결과는 한 트랜잭션 — 폐지만 남거나, 함께 누른
    // 유지가 폐지 결과를 덮지 않게
    await this.prisma.$transaction(async (tx) => {
      await lockPolicyRow(tx, policyId);
      await lockArticleRow(tx, articleId);
      if (!(await lockReparseReviewRow(tx, id, tenantId))) throw new NotFoundException('Reparse review not found');
      const review = await tx.reparseReview.findUniqueOrThrow({ where: { id }, select: { status: true } });
      if (review.status !== 'approved' && review.status !== 'rejected') {
        throw new ConflictException('원문에 없는 조문은 묶음을 승인하거나 반려한 뒤에 따로 정합니다(그 전에는 검토의 결정으로).');
      }
      const item = await tx.reparseReviewItem.findUniqueOrThrow({ where: { id: itemId }, select: { outcome: true } });
      const outcome = (item.outcome ?? {}) as { action?: string; status?: string };
      if (outcome.action === 'repeal' && outcome.status === 'done') throw new ConflictException('이미 폐지한 조문입니다.');
      if (decision === 'keep') {
        await tx.reparseReviewItem.update({
          where: { id: itemId },
          data: { decision: 'keep', decidedBy: userId, decidedAt: new Date(), outcome: { action: 'keep' } },
        });
        return;
      }
      if (role !== 'admin') throw new ForbiddenException('폐지는 관리자만 할 수 있습니다.');
      const published = await tx.articleVersion.findFirst({
        where: { articleId, status: 'published' },
        orderBy: { versionNum: 'desc' },
        select: { id: true },
      });
      if (!published) throw new ConflictException('시행 중인 버전이 없는 조문입니다.');
      const archived = await this.versions.archiveLocked(tx, tenantId, { id: published.id, articleId }, userId);
      await tx.reparseReviewItem.update({
        where: { id: itemId },
        data: {
          decision: 'repeal',
          decidedBy: userId,
          decidedAt: new Date(),
          outcome: { action: 'repeal', status: 'done', repealedOn: day(archived.repealedOn), versionId: published.id },
        },
      });
    });
    return this.reparse.get(tenantId, id);
  }
}

type PlanChapter = { index: number; number: number; title: string; hidden: boolean };
