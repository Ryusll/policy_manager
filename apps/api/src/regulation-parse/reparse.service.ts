import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash } from 'crypto';
import * as Diff from 'diff';
import { PrismaService } from '../common/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { ARTICLE_ORDER } from '../common/article-label';
import { toDateOnlyString } from '../common/date-only';
import type { RegulationArticleNode } from './regulation-tree.builder';
import { parsedFromTree } from './reparse-plan';
import {
  contentFingerprint,
  matchReparse,
  normalizeText,
  positionLabel,
  NORMALIZE_VERSION,
  REPARSE_ALGORITHM,
  type MatchItem,
  type ParsedChapter,
  type ParsedRow,
  type StoredChapter,
  type StoredRow,
} from './reparse-match';
import { undecidedCount, validateDecisions, type DecisionItem } from './reparse-decisions';
import { bundleState } from './reparse-state';

type Db = PrismaService | Prisma.TransactionClient;

const sha256 = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');
const fp = (content: string) => contentFingerprint(normalizeText(content));
const day = (d: Date | null) => (d ? toDateOnlyString(d) : null);

type StoredState = {
  rows: StoredRow[];
  chapters: StoredChapter[];
  /** 비교 대상 버전의 번호·시행일·폐지일(항목 기록용) */
  baseMeta: Map<string, { versionNum: number; effectiveDate: string | null; repealedOn: string | null }>;
  state: string;
};

/** 미리보기 트리의 지문 — 비교한 뒤 트리를 고쳤는지 본다 */
export function treeFingerprint(roots: unknown): string {
  return `tr1:${sha256(JSON.stringify(roots ?? []))}`;
}

/**
 * 재파싱 검토(T-110 ①, 특허 청구항 2·도 6) — 다시 가져온 원문을 대상 규정의 조문과 맞추고(계층·내용 지문 2축),
 * 결과와 사람의 결정을 남긴다. **규정 데이터는 바꾸지 않는다** — 반영(초안·새 조문·삭제 확인)과 묶음 승인은 2단계.
 */
@Injectable()
export class ReparseService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
  ) {}

  /**
   * 저장 쪽 — 대상 규정의 장·절·조문과 비교 대상 버전. 비교 대상은 최근 발행본(시행 예정 발행본 포함), 발행 이력이 없으면
   * 최신 작업본. 마지막 발행이 폐지면 폐지 표시(자동 대응에서 뺀다). 비교 대상보다 뒤의 작업본은 따로 표시한다.
   */
  async loadStored(db: Db, policyId: string): Promise<StoredState> {
    const chapters = await db.chapter.findMany({
      where: { policyId },
      orderBy: { number: 'asc' },
      select: {
        id: true,
        number: true,
        title: true,
        suppressHeader: true,
        sections: { orderBy: { number: 'asc' }, select: { id: true, number: true, title: true } },
      },
    });
    const articles = await db.article.findMany({
      where: { chapter: { policyId } },
      orderBy: ARTICLE_ORDER,
      select: {
        id: true,
        chapterId: true,
        sectionId: true,
        number: true,
        branchNumber: true,
        clauseNumber: true,
        itemNumber: true,
        title: true,
        versions: {
          where: { status: { in: ['published', 'archived', 'draft', 'review'] } },
          orderBy: { versionNum: 'desc' },
          select: { id: true, versionNum: true, status: true, effectiveDate: true, repealedOn: true },
        },
      },
    });
    const chosen = articles.map((a) => {
      const issued = a.versions.find((v) => v.status === 'published' || v.status === 'archived');
      const work = a.versions.find((v) => v.status === 'draft' || v.status === 'review');
      const base = issued ?? work ?? null;
      const pending = issued && work && work.versionNum > issued.versionNum ? work : null;
      return { a, base, pending };
    });
    const ids = chosen.filter((c) => c.base).map((c) => c.base!.id);
    const contents = new Map(
      (ids.length ? await db.articleVersion.findMany({ where: { id: { in: ids } }, select: { id: true, content: true } }) : []).map(
        (v) => [v.id, v.content],
      ),
    );
    const baseMeta = new Map<string, { versionNum: number; effectiveDate: string | null; repealedOn: string | null }>();
    const rows: StoredRow[] = chosen.map(({ a, base, pending }, order) => {
      if (base) baseMeta.set(base.id, { versionNum: base.versionNum, effectiveDate: day(base.effectiveDate), repealedOn: day(base.repealedOn) });
      return {
        articleId: a.id,
        chapterId: a.chapterId,
        sectionId: a.sectionId,
        number: a.number,
        branch: a.branchNumber,
        clause: a.clauseNumber,
        item: a.itemNumber,
        title: a.title ?? '',
        base: base ? { versionId: base.id, status: base.status, content: contents.get(base.id) ?? '' } : null,
        repealed: !!base && (base.status === 'published' || base.status === 'archived') && !!base.repealedOn,
        pending: pending ? { versionId: pending.id, status: pending.status } : null,
        order,
      };
    });
    const storedChapters: StoredChapter[] = chapters.map((c) => ({
      id: c.id,
      number: c.number,
      title: c.title,
      hidden: c.suppressHeader,
      sections: c.sections,
    }));
    const lines = [
      ...chapters.map((c) => `C|${c.id}|${c.number}|${c.title}|${c.suppressHeader ? 1 : 0}`),
      ...chapters.flatMap((c) => c.sections.map((s) => `S|${c.id}|${s.id}|${s.number}|${s.title}`)),
      ...rows.map(
        (r) =>
          `A|${r.articleId}|${r.chapterId}|${r.sectionId ?? ''}|${r.number}|${r.branch ?? ''}|${r.clause ?? ''}|${r.item ?? ''}|${r.title}|` +
          (r.base ? `${r.base.versionId}|${r.base.status}|${fp(r.base.content) ?? ''}` : '-') +
          `|${r.repealed ? 'R' : ''}|${r.pending ? `${r.pending.versionId}|${r.pending.status}` : ''}`,
      ),
    ].sort();
    return { rows, chapters: storedChapters, baseMeta, state: `st1:${sha256(lines.join('\n'))}` };
  }

  async compare(tenantId: string, userId: string, sessionId: string, policyId: string) {
    const session = await this.prisma.regulationParseSession.findFirst({ where: { id: sessionId, tenantId } });
    if (!session) throw new NotFoundException('Parse session not found');
    if (session.committedPolicyId) {
      throw new BadRequestException('이미 새 규정으로 등록한 원문입니다 — 기존 규정과 비교하려면 원문을 다시 가져오세요.');
    }
    const roots = (session.parseTree as { roots?: RegulationArticleNode[] } | null)?.roots;
    if (session.status !== 'ready' || !roots?.length) {
      throw new BadRequestException('미리보기가 준비된 원문만 비교할 수 있습니다.');
    }
    const policy = await this.prisma.policy.findFirst({ where: { id: policyId, tenantId }, select: { id: true } });
    if (!policy) throw new NotFoundException('Policy not found');

    const parsed = parsedFromTree(roots);
    if (!parsed.rows.length) throw new BadRequestException('비교할 조문이 없습니다.');
    const stored = await this.loadStored(this.prisma, policyId);
    const result = matchReparse(parsed.rows, parsed.chapters, stored.rows, stored.chapters);
    const items = buildItems(result.items, parsed.rows, parsed.chapters, stored, result.chapterMap, result.sectionMap);
    const counts = countKinds(result.items);
    const summary = {
      counts,
      chapters: result.chapters.map((c) => {
        const pc = c.parsed != null ? parsed.chapters[c.parsed] : null;
        const sc = c.storedId ? stored.chapters.find((x) => x.id === c.storedId) : null;
        return {
          change: c.change,
          parsed: pc ? { index: pc.index, number: pc.number, title: pc.title, hidden: pc.hidden } : null,
          stored: sc ? { id: sc.id, number: sc.number, title: sc.title, hidden: sc.hidden } : null,
        };
      }),
      appendixCount: parsed.appendixCount,
      pendingConflicts: items.filter((i) => (i.kind === 'moved' || i.kind === 'changed') && i.stored?.pending).length,
      treeFingerprint: treeFingerprint(roots),
    };

    const review = await this.prisma.$transaction(async (tx) => {
      // 같은 원문을 같은 규정과 다시 비교하면 앞 검토는 지나간 것으로 — 사람이 정한 결정은 같은 항목이면 옮겨 온다
      const previous = await tx.reparseReview.findMany({
        where: { tenantId, policyId, sessionId, status: 'open' },
        include: { items: true },
      });
      if (previous.length) {
        await tx.reparseReview.updateMany({ where: { id: { in: previous.map((p) => p.id) } }, data: { status: 'superseded' } });
      }
      // 묶음을 반려한 뒤 같은 원문으로 다시 비교하면 그 검토의 결정도 옮겨 온다(열린 검토가 먼저)
      const rejected = await tx.reparseReview.findFirst({
        where: { tenantId, policyId, sessionId, status: 'rejected' },
        orderBy: { rejectedAt: 'desc' },
        include: { items: true },
      });
      const earlier = [...previous.flatMap((p) => p.items), ...(rejected?.items ?? [])];
      carryDecisions(items, earlier);
      addCompanions(items, earlier);
      summary.counts = countBuilt(items);
      return tx.reparseReview.create({
        data: {
          tenantId,
          policyId,
          sessionId,
          sourceName: session.fileName,
          algorithm: REPARSE_ALGORITHM,
          normalizer: NORMALIZE_VERSION,
          stateFingerprint: stored.state,
          summary: summary as unknown as Prisma.InputJsonValue,
          createdBy: userId,
          items: {
            create: items.map((i, seq) => ({
              seq,
              kind: i.kind,
              articleId: i.articleId,
              parsed: (i.parsed ?? Prisma.JsonNull) as Prisma.InputJsonValue,
              stored: (i.stored ?? Prisma.JsonNull) as Prisma.InputJsonValue,
              candidates: (i.candidates.length ? i.candidates : Prisma.JsonNull) as Prisma.InputJsonValue,
              reasons: i.reasons as unknown as Prisma.InputJsonValue,
              changes: (i.changes ?? Prisma.JsonNull) as Prisma.InputJsonValue,
              recommended: i.recommended,
              decision: i.decision,
              targetArticleId: i.targetArticleId,
              decidedBy: i.decidedBy,
              decidedAt: i.decidedAt,
            })),
          },
        },
      });
    });
    await this.audit.log({
      tenantId,
      userId,
      action: 'reparse.compare',
      entityType: 'Policy',
      entityId: policyId,
      details: { reviewId: review.id, sessionId, sourceName: session.fileName, counts: summary.counts, algorithm: REPARSE_ALGORITHM, normalizer: NORMALIZE_VERSION },
    });
    return this.get(tenantId, review.id);
  }

  async get(tenantId: string, id: string) {
    const review = await this.prisma.reparseReview.findFirst({
      where: { id, tenantId },
      include: {
        items: {
          orderBy: { seq: 'asc' },
          // 이 항목이 만든 묶음 버전(T-110 ②)
          include: { version: { select: { id: true, articleId: true, versionNum: true, status: true, content: true, structure: true, reviewNote: true } } },
        },
        policy: { select: { id: true, code: true, title: true } },
      },
    });
    if (!review) throw new NotFoundException('Reparse review not found');
    // 결정 중이면: 비교한 뒤 규정이 바뀌었거나(다른 개정·재정렬) 원문 트리를 고쳤으면 다시 비교해야 한다.
    // 반영·검토 요청 뒤면: 그때의 묶음 지문과 지금이 다르면 그 단계로 넘어갈 수 없다(반려하고 다시 비교)
    let stale = false;
    let sourceChanged = false;
    if (review.status === 'open') {
      const current = await this.loadStored(this.prisma, review.policyId);
      stale = current.state !== review.stateFingerprint;
      const session = review.sessionId
        ? await this.prisma.regulationParseSession.findUnique({ where: { id: review.sessionId }, select: { parseTree: true } })
        : null;
      const summary = review.summary as { treeFingerprint?: string };
      sourceChanged = !!session && treeFingerprint((session.parseTree as { roots?: unknown } | null)?.roots) !== summary.treeFingerprint;
    } else if (review.status === 'applied' || review.status === 'submitted') {
      stale = (await bundleState(this.prisma, review.policyId, review.plan, review.status === 'submitted')) !== review.bundleFingerprint;
    }
    return {
      ...review,
      stale,
      sourceChanged,
      undecided: undecidedCount(review.items),
      items: review.items.map((i) => {
        const parsed = i.parsed as { content?: string } | null;
        const stored = i.stored as { base?: { content?: string } | null } | null;
        const changes = i.changes as { content?: boolean } | null;
        return {
          ...i,
          diff:
            changes?.content && parsed && stored?.base
              ? Diff.diffWords(stored.base.content ?? '', parsed.content ?? '').map((p) => ({
                  value: p.value,
                  ...(p.added ? { added: true } : {}),
                  ...(p.removed ? { removed: true } : {}),
                }))
              : null,
        };
      }),
    };
  }

  async listForPolicy(tenantId: string, policyId: string) {
    const policy = await this.prisma.policy.findFirst({ where: { id: policyId, tenantId }, select: { id: true } });
    if (!policy) throw new NotFoundException('Policy not found');
    const reviews = await this.prisma.reparseReview.findMany({
      where: { tenantId, policyId },
      orderBy: { createdAt: 'desc' },
      take: 20,
      include: { items: { select: { kind: true, decision: true } } },
    });
    return reviews.map(({ items, ...r }) => ({
      id: r.id,
      status: r.status,
      sourceName: r.sourceName,
      createdAt: r.createdAt,
      createdBy: r.createdBy,
      counts: (r.summary as { counts?: unknown }).counts,
      undecided: undecidedCount(items),
      /** 원문에 없는데 그대로 둠·폐지를 정하지 않은 조문 */
      deletionUndecided: items.filter((i) => i.kind === 'missing' && i.decision == null).length,
    }));
  }

  /** 사람의 결정 — 항목별 허용 결정, 한 기존 조문은 한 항목만, 폐지는 관리자. 검토 행을 잠가 결정끼리 줄 세운다 */
  async decide(
    tenantId: string,
    userId: string,
    role: string,
    id: string,
    changes: { id: string; decision?: string | null; targetArticleId?: string | null }[],
  ) {
    await this.prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM reparse_reviews WHERE id = ${id} AND tenant_id = ${tenantId} FOR UPDATE`;
      if (!locked.length) throw new NotFoundException('Reparse review not found');
      const review = await tx.reparseReview.findUniqueOrThrow({ where: { id }, include: { items: true } });
      if (review.status !== 'open') throw new ConflictException('지나간 검토입니다 — 최근 비교 결과에서 정하세요.');
      const byId = new Map(review.items.map((i) => [i.id, i]));
      const next = new Map<string, { decision: string | null; targetArticleId: string | null }>();
      for (const c of changes) {
        if (!byId.has(c.id)) throw new BadRequestException('이 검토의 항목이 아닙니다.');
        next.set(c.id, { decision: c.decision ?? null, targetArticleId: c.targetArticleId ?? null });
      }
      const view = review.items.map((i) => toDecisionItem(i, next.get(i.id)));
      const changedIds = new Set(
        [...next].filter(([itemId, d]) => {
          const cur = byId.get(itemId)!;
          return cur.decision !== d.decision || cur.targetArticleId !== d.targetArticleId;
        }).map(([itemId]) => itemId),
      );
      const errors = validateDecisions(view, role, changedIds);
      if (errors.length) throw new BadRequestException(errors.map((e) => e.message).join(' / '));
      const now = new Date();
      for (const [itemId, d] of next) {
        const cur = byId.get(itemId)!;
        if (cur.decision === d.decision && cur.targetArticleId === d.targetArticleId) continue;
        await tx.reparseReviewItem.update({
          where: { id: itemId },
          data: { decision: d.decision, targetArticleId: d.targetArticleId, decidedBy: userId, decidedAt: now },
        });
      }
      // 옮김·본문 바뀜을 새 조문으로 돌리면 그 기존 조문은 원문에 없음(삭제 여부 확인) 항목이 된다 — 반영 전에 유지·폐지를
      // 정할 수 있게 지금 만든다. 다시 돌려놓으면 그 항목을 거둔다(그 조문을 다른 항목이 잇고 있으면 위 검사에서 이미 막힌다)
      let seq = review.items.reduce((m, i) => Math.max(m, i.seq), -1) + 1;
      for (const [itemId, d] of next) {
        const cur = byId.get(itemId)!;
        if ((cur.kind !== 'moved' && cur.kind !== 'changed') || !cur.articleId) continue;
        const companion = review.items.find((i) => isCompanion(i) && i.articleId === cur.articleId);
        if (d.decision === 'new' && !companion) {
          await tx.reparseReviewItem.create({
            data: {
              reviewId: id,
              seq: seq++,
              kind: 'missing',
              articleId: cur.articleId,
              stored: (cur.stored ?? Prisma.JsonNull) as Prisma.InputJsonValue,
              reasons: ['released'] as unknown as Prisma.InputJsonValue,
            },
          });
        } else if (d.decision !== 'new' && companion) {
          await tx.reparseReviewItem.delete({ where: { id: companion.id } });
        }
      }
    });
    return this.get(tenantId, id);
  }
}

/** 새 조문으로 돌린 짝의 기존 조문을 맡은 원문에 없음 항목 */
const isCompanion = (i: { kind: string; reasons: unknown }) =>
  i.kind === 'missing' && Array.isArray(i.reasons) && (i.reasons as string[]).includes('released');

function countBuilt(items: { kind: string }[]) {
  const counts: Record<string, number> = { same: 0, moved: 0, changed: 0, ambiguous: 0, new: 0, missing: 0 };
  for (const i of items) counts[i.kind] += 1;
  return counts;
}

/**
 * 다시 비교한 뒤에도 새 조문으로 돌린 짝이 있으면 그 기존 조문의 원문에 없음 항목을 다시 둔다 — 앞 검토에서 정한 유지·폐지도 옮긴다.
 */
function addCompanions(items: BuiltItem[], previous: { kind: string; reasons: unknown; articleId: string | null; decision: string | null; decidedBy: string | null; decidedAt: Date | null }[]) {
  const before = new Map(previous.filter((i) => isCompanion(i) && i.decidedBy).map((i) => [i.articleId, i]));
  for (const item of [...items]) {
    if ((item.kind !== 'moved' && item.kind !== 'changed') || item.decision !== 'new' || !item.articleId) continue;
    if (items.some((x) => x.kind === 'missing' && x.articleId === item.articleId)) continue;
    const prev = before.get(item.articleId);
    items.push({
      kind: 'missing',
      articleId: item.articleId,
      parsed: null,
      stored: item.stored,
      candidates: [],
      reasons: ['released'],
      changes: null,
      recommended: false,
      decision: prev?.decision === 'keep' || prev?.decision === 'repeal' ? prev.decision : null,
      targetArticleId: null,
      decidedBy: prev?.decidedBy ?? null,
      decidedAt: prev?.decidedAt ?? null,
    });
  }
}

type ItemRow = { id: string; kind: string; articleId: string | null; candidates: unknown; decision: string | null; targetArticleId: string | null; parsed: unknown; stored: unknown };

function toDecisionItem(i: ItemRow, override?: { decision: string | null; targetArticleId: string | null }): DecisionItem {
  const parsed = i.parsed as { label?: string } | null;
  const stored = i.stored as { label?: string } | null;
  return {
    id: i.id,
    kind: i.kind,
    articleId: i.articleId,
    candidates: ((i.candidates as { articleId: string }[] | null) ?? []).map((c) => c.articleId),
    decision: override ? override.decision : i.decision,
    targetArticleId: override ? override.targetArticleId : i.targetArticleId,
    label: parsed?.label ?? stored?.label ?? '항목',
  };
}

type BuiltItem = {
  kind: string;
  articleId: string | null;
  parsed: Record<string, unknown> | null;
  stored: (Record<string, unknown> & { pending?: unknown }) | null;
  candidates: Record<string, unknown>[];
  reasons: string[];
  changes: Record<string, boolean> | null;
  recommended: boolean;
  decision: string | null;
  targetArticleId: string | null;
  decidedBy: string | null;
  decidedAt: Date | null;
};

function countKinds(items: MatchItem[]) {
  const counts: Record<string, number> = { same: 0, moved: 0, changed: 0, ambiguous: 0, new: 0, missing: 0 };
  for (const i of items) counts[i.kind] += 1;
  return counts;
}

function buildItems(
  matched: MatchItem[],
  parsedRows: ParsedRow[],
  parsedChapters: ParsedChapter[],
  stored: StoredState,
  chapterMap: Record<number, string | null>,
  sectionMap: Record<string, string | null>,
): BuiltItem[] {
  const byArticle = new Map(stored.rows.map((r) => [r.articleId, r]));
  const chapterById = new Map(stored.chapters.map((c) => [c.id, c]));
  const storedView = (r: StoredRow) => {
    const ch = chapterById.get(r.chapterId);
    const sec = r.sectionId ? ch?.sections.find((s) => s.id === r.sectionId) : null;
    const meta = r.base ? stored.baseMeta.get(r.base.versionId) : null;
    return {
      articleId: r.articleId,
      label: positionLabel(r),
      number: r.number,
      branch: r.branch,
      clause: r.clause,
      item: r.item,
      title: r.title,
      chapter: ch ? { id: ch.id, number: ch.number, title: ch.title, hidden: ch.hidden } : null,
      section: sec ? { id: sec.id, number: sec.number, title: sec.title } : null,
      base: r.base
        ? {
            versionId: r.base.versionId,
            status: r.base.status,
            versionNum: meta?.versionNum ?? null,
            effectiveDate: meta?.effectiveDate ?? null,
            repealedOn: meta?.repealedOn ?? null,
            content: r.base.content,
            fingerprint: fp(r.base.content),
          }
        : null,
      repealed: r.repealed,
      pending: r.pending,
    };
  };
  const parsedView = (p: ParsedRow) => {
    const ch = parsedChapters[p.chapterIndex];
    const sec = p.sectionIndex != null ? ch?.sections[p.sectionIndex] : null;
    const chapterTarget = chapterMap[p.chapterIndex] ?? null;
    const sectionTarget = p.sectionIndex != null ? sectionMap[`${p.chapterIndex}:${p.sectionIndex}`] ?? null : null;
    return {
      index: p.index,
      nodeId: p.nodeId,
      label: positionLabel(p),
      number: p.number,
      branch: p.branch,
      clause: p.clause,
      item: p.item,
      title: p.title,
      content: p.content,
      fingerprint: fp(p.content),
      renumbered: p.renumbered,
      chapter: ch ? { index: ch.index, number: ch.number, title: ch.title, hidden: ch.hidden, storedId: chapterTarget } : null,
      section: sec ? { index: sec.index, number: sec.number, title: sec.title, storedId: sectionTarget } : null,
    };
  };
  return matched.map((m) => {
    const row = m.articleId ? byArticle.get(m.articleId) : undefined;
    const p = m.parsed != null ? parsedRows[m.parsed] : undefined;
    // 근거가 충분한 옮김과 후보가 전혀 없는 새 조문은 결정을 미리 골라 둔다(사람이 바꿀 수 있다)
    const decision = m.recommended && m.kind === 'moved' ? 'accept' : m.recommended && m.kind === 'new' ? 'new' : null;
    return {
      kind: m.kind,
      articleId: m.articleId,
      parsed: p ? parsedView(p) : null,
      stored: row ? storedView(row) : null,
      candidates: m.candidates.map((id) => {
        const r = byArticle.get(id)!;
        const v = storedView(r);
        return { articleId: id, label: v.label, title: v.title, content: v.base?.content ?? '', repealed: v.repealed };
      }),
      reasons: m.reasons,
      changes: m.changes,
      recommended: m.recommended,
      decision,
      targetArticleId: null,
      decidedBy: null,
      decidedAt: null,
    };
  });
}

/**
 * 다시 비교할 때 사람이 정한 결정을 옮긴다 — 종류·재파싱 행·기존 조문·후보가 모두 같은 항목만, 그리고 옮긴 뒤에도
 * 결정 규칙에 맞을 때만(한 조문을 두 항목이 가리키게 되면 옮기지 않는다).
 */
function carryDecisions(items: BuiltItem[], previous: (ItemRow & { decidedBy: string | null; decidedAt: Date | null })[]) {
  const keyOf = (kind: string, parsedIndex: number | null, articleId: string | null, candidates: string[]) =>
    `${kind}|${parsedIndex ?? ''}|${articleId ?? ''}|${[...candidates].sort().join(',')}`;
  const old = new Map(
    previous
      .filter((i) => i.decidedBy)
      .map((i) => [
        keyOf(
          i.kind,
          (i.parsed as { index?: number } | null)?.index ?? null,
          i.articleId,
          ((i.candidates as { articleId: string }[] | null) ?? []).map((c) => c.articleId),
        ),
        i,
      ]),
  );
  for (const item of items) {
    const prev = old.get(
      keyOf(item.kind, (item.parsed as { index?: number } | null)?.index ?? null, item.articleId, item.candidates.map((c) => c.articleId as string)),
    );
    if (!prev) continue;
    const before = { decision: item.decision, targetArticleId: item.targetArticleId, decidedBy: item.decidedBy, decidedAt: item.decidedAt };
    Object.assign(item, { decision: prev.decision, targetArticleId: prev.targetArticleId, decidedBy: prev.decidedBy, decidedAt: prev.decidedAt });
    const view = items.map((x, idx) => ({
      id: String(idx),
      kind: x.kind,
      articleId: x.articleId,
      candidates: x.candidates.map((c) => c.articleId as string),
      decision: x.decision,
      targetArticleId: x.targetArticleId,
      label: '',
    }));
    // 관리자 결정(폐지)도 옮긴다 — 결정한 사람이 이미 정한 것이다
    if (validateDecisions(view, 'admin').length) Object.assign(item, before);
  }
}
