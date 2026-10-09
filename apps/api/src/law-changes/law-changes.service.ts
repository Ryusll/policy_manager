import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { AS_OF_VERSION_ORDER, asOfState, asOfVersionWhere } from '../common/as-of';
import { parseDateOnly, toDateOnlyString, todayDateOnly } from '../common/date-only';
import { labelFromNodeKey } from '../laws/law-rows';
import { impactReferenceDate } from './law-impact';
import { CANDIDATE_SELECT, presentCandidate } from '../amendments/amendment-present';

const EVENT_SELECT = {
  id: true,
  lawId: true,
  lawArticleId: true,
  nodeKey: true,
  changeType: true,
  beforeContent: true,
  afterContent: true,
  promulgatedDate: true,
  lawEffectiveDate: true,
  receivedVia: true,
  detectedAt: true,
  law: { select: { lawName: true } },
  lawArticle: { select: { label: true } },
} satisfies Prisma.LawChangeEventSelect;

type EventRow = Prisma.LawChangeEventGetPayload<{ select: typeof EVENT_SELECT }>;

const dateOnly = (d: Date | null) => (d ? toDateOnlyString(d) : null);

function presentEvent(e: EventRow) {
  return {
    id: e.id,
    lawId: e.lawId,
    lawName: e.law.lawName,
    lawArticleId: e.lawArticleId,
    nodeKey: e.nodeKey,
    // 조문이 법령에서 사라졌으면 LawArticle 행이 없다 — nodeKey 로 표기를 되살린다
    label: e.lawArticle?.label ?? labelFromNodeKey(e.nodeKey),
    changeType: e.changeType,
    beforeContent: e.beforeContent,
    afterContent: e.afterContent,
    promulgatedDate: dateOnly(e.promulgatedDate),
    lawEffectiveDate: dateOnly(e.lawEffectiveDate),
    receivedVia: e.receivedVia,
    detectedAt: e.detectedAt,
  };
}

/** 제1 조문이 없는 이유 — `impactedArticles` 참고 */
export type ImpactSkipReason = 'not_in_force' | 'effective_date_missing' | 'repealed';

export type ImpactedArticle = Awaited<ReturnType<LawChangesService['impactedArticles']>>[number];

/**
 * 조문이 법령에서 통째로 사라지면 LawArticle 이 지워지고 거기 걸린 LawLink 도 함께 지워진다
 * (T-101 FK cascade). "영향 없음"으로 보이면 안 되므로 사유를 실어 보낸다
 */
/**
 * 조항 행이 없는 이벤트 — 예전 동기화가 법령에서 사라진 조항을 지우던 때(T-124 이전)의 "삭제됨" 이벤트이거나
 * 법령 추적 해제로 조항이 지워진 경우. 지금은 사라진 조항을 지우지 않고 표시만 해서 연결이 이어진다.
 */
export const UNRESOLVABLE_REMOVED =
  '이 조문이 법령에서 사라질 때 연결 정보도 함께 지워졌습니다(예전 동기화). 영향받던 사내 조문을 자동으로 찾을 수 없습니다.';

/**
 * 법령 변경 이벤트와 그 영향 (T-105, 청구항 1 ④·3).
 *
 * ⚠️ **테넌트 경계.** `LawChangeEvent`·`LawArticle` 은 모든 회사가 함께 쓰는 데이터라 tenantId 가
 * 없다. 영향(= 어느 회사의 어느 조문이 걸려 있나)은 `LawLink` 가 정하므로, **이 서비스의 모든
 * `lawLink` 조회는 `tenantId` 를 where 에 넣는다.** 빠뜨리면 다른 회사가 이 법에 어떻게 대응해
 * 뒀는지(회사 기밀)가 새어 나간다 — T-41 에서 찾은 사고와 같은 모양이다.
 *
 * **확정(`confirmed`)된 연결만 영향으로 본다.** 자동 추천(`suggested`)으로 초안을 만들면 틀린
 * 연결이 그럴듯한 개정안을 만든다 — 추천은 "확인이 필요한 연결 N건"으로만 알린다.
 */
@Injectable()
export class LawChangesService {
  constructor(private readonly prisma: PrismaService) {}

  /** 변경 이벤트 목록 + 각 이벤트가 우리 회사에 미치는 영향 수 */
  async list(tenantId: string, query: { lawId?: string; affected?: boolean; limit?: number }) {
    const where: Prisma.LawChangeEventWhereInput = {};
    if (query.lawId) where.lawId = query.lawId;
    if (query.affected) {
      const linked = await this.prisma.lawLink.findMany({
        where: { tenantId, confirmState: 'confirmed' },
        select: { lawArticleId: true },
        distinct: ['lawArticleId'],
      });
      where.lawArticleId = { in: linked.map((l) => l.lawArticleId) };
    }

    const events = await this.prisma.lawChangeEvent.findMany({
      where,
      orderBy: [{ detectedAt: 'desc' }, { nodeKey: 'asc' }],
      take: Math.min(100, Math.max(1, Math.trunc(query.limit ?? 50))),
      select: EVENT_SELECT,
    });

    const lawArticleIds = [...new Set(events.map((e) => e.lawArticleId).filter((v): v is string => !!v))];
    const counts = lawArticleIds.length
      ? await this.prisma.lawLink.groupBy({
          by: ['lawArticleId', 'confirmState'],
          where: {
            tenantId,
            lawArticleId: { in: lawArticleIds },
            confirmState: { in: ['confirmed', 'suggested'] },
          },
          _count: { _all: true },
        })
      : [];
    const countOf = (lawArticleId: string | null, state: 'confirmed' | 'suggested') =>
      counts.find((c) => c.lawArticleId === lawArticleId && c.confirmState === state)?._count._all ?? 0;

    return events.map((e) => ({
      ...presentEvent(e),
      impact: {
        confirmed: countOf(e.lawArticleId, 'confirmed'),
        suggested: countOf(e.lawArticleId, 'suggested'),
      },
    }));
  }

  /**
   * 이 변경이 우리 회사의 어느 조문에 걸리는지, 그리고 각 조문의 **제1 조문**(영향 분석
   * 기준일에 시행 중인 발행 버전)까지. 개정 후보 생성(T-106)도 같은 판정(`referenceDate`·
   * `impactedArticles`)을 쓴다 — 화면에서 본 영향과 후보가 갈라지지 않게.
   *
   * 기준일에 시행 중인 버전이 없는 조문은 빼지 않고 `baseVersion: null` 로 돌려준다 — 조용히
   * 빠지면 "영향이 없다"로 읽힌다. 후보를 만들 수 없을 뿐이다.
   */
  async impact(tenantId: string, eventId: string, asOf?: string) {
    const event = await this.prisma.lawChangeEvent.findUnique({
      where: { id: eventId },
      select: EVENT_SELECT,
    });
    if (!event) throw new NotFoundException('변경 이벤트를 찾을 수 없습니다.');

    const asOfDate = this.referenceDate(event.lawEffectiveDate, asOf);
    const base = {
      event: presentEvent(event),
      asOf: toDateOnlyString(asOfDate),
    };

    if (!event.lawArticleId) {
      return { ...base, impacted: [], suggestedCount: 0, unresolvable: UNRESOLVABLE_REMOVED };
    }

    const impacted = await this.impactedArticles(tenantId, event.lawArticleId, asOfDate);
    const suggestedCount = await this.prisma.lawLink.count({
      where: { tenantId, lawArticleId: event.lawArticleId, confirmState: 'suggested' },
    });

    // 이 변경으로 만든 개정 후보(T-106)를 조문마다 붙인다 — 지금 기준 본문으로 만든 것이 있으면 그것,
    // 없으면 가장 최근 것(그 사이 기준 본문이 바뀌었다는 뜻이라 isCurrentBase 로 알린다)
    const candidates = impacted.length
      ? await this.prisma.amendmentCandidate.findMany({
          where: {
            tenantId,
            changeEventId: event.id,
            articleId: { in: impacted.map((i) => i.article.id) },
            article: { chapter: { policy: { tenantId } } },
          },
          orderBy: { createdAt: 'desc' },
          select: CANDIDATE_SELECT,
        })
      : [];
    const withCandidates = impacted.map((item) => {
      const c =
        candidates.find((x) => x.articleId === item.article.id && x.baseVersionId === item.baseVersion?.id) ??
        candidates.find((x) => x.articleId === item.article.id) ??
        null;
      return {
        ...item,
        candidate: c ? { ...presentCandidate(c), isCurrentBase: c.baseVersionId === item.baseVersion?.id } : null,
      };
    });
    return { ...base, impacted: withCandidates, suggestedCount, unresolvable: null };
  }

  /** 영향 분석 기준일 — 지정하면 그날, 아니면 법령 시행일과 오늘 중 늦은 날(T-105) */
  referenceDate(lawEffectiveDate: Date | null, asOf?: string): Date {
    if (asOf !== undefined) {
      const parsed = parseDateOnly(asOf);
      if (!parsed) throw new BadRequestException('기준일(asOf)은 실제로 있는 날짜여야 합니다.');
      return parsed;
    }
    return impactReferenceDate(lawEffectiveDate, todayDateOnly());
  }

  /**
   * 법령조항에 **확정된** 연결로 걸린 우리 회사 조문과 각 조문의 제1 조문.
   *
   * 제1 조문이 없으면 이유를 가른다(사용자 지시로 코덱스 자문, T-123 결정 2):
   * - `effective_date_missing` — 시행본은 있는데 시행일이 기록되지 않았다(T-123 이전에 가져온
   *   규정). 규정 화면에서 시행일을 보정하면 풀린다. 임의 날짜로 기준 본문을 만들지 않는다
   * - `not_in_force` — 기준일에 시행 중인 버전이 없다(초안뿐이거나 시행 전)
   * - `repealed` — 기준일에 이 조문은 폐지돼 있다(T-126). 연결은 남아 있으니 목록에서 빼지 않고 폐지일과 함께
   *   보인다 — 사라지면 "왜 영향 조문이 줄었나"를 설명할 수 없다. 개정 후보는 만들지 않는다
   */
  async impactedArticles(tenantId: string, lawArticleId: string, asOfDate: Date) {
    const links = await this.prisma.lawLink.findMany({
      where: {
        tenantId,
        lawArticleId,
        confirmState: 'confirmed',
        // 연결 자체의 tenantId 와 별개로 조문의 실제 소속도 본다 — 부모를 안 보고 자식만 확인한
        // T-41 사고의 재발 방지
        article: { chapter: { policy: { tenantId } } },
      },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        relationType: true,
        scope: true,
        evidenceText: true,
        confidence: true,
        confirmState: true,
        confirmedAt: true,
        article: {
          select: {
            id: true,
            number: true,
            branchNumber: true,
            clauseNumber: true,
            itemNumber: true,
            title: true,
            chapter: { select: { policy: { select: { id: true, code: true, title: true, isActive: true } } } },
            versions: {
              where: asOfVersionWhere(asOfDate),
              orderBy: AS_OF_VERSION_ORDER,
              take: 1,
              select: { id: true, versionNum: true, status: true, effectiveDate: true, content: true, repealedOn: true },
            },
          },
        },
      },
    });

    const missingBase = links.filter((l) => !l.article.versions.length).map((l) => l.article.id);
    const undated = missingBase.length
      ? new Set(
          (
            await this.prisma.articleVersion.findMany({
              where: { articleId: { in: missingBase }, status: { in: ['published', 'archived'] }, effectiveDate: null },
              select: { articleId: true },
              distinct: ['articleId'],
            })
          ).map((v) => v.articleId),
        )
      : new Set<string>();

    return links
      .map((link) => {
        const picked = link.article.versions[0] ?? null;
        const state = asOfState(picked, asOfDate);
        const version = state === 'in_force' ? picked : null;
        const skipReason: ImpactSkipReason | null =
          state === 'in_force'
            ? null
            : state === 'repealed'
              ? 'repealed'
              : undated.has(link.article.id)
                ? 'effective_date_missing'
                : 'not_in_force';
        return {
          linkId: link.id,
          relationType: link.relationType,
          scope: link.scope,
          evidenceText: link.evidenceText,
          linkConfidence: link.confidence,
          confirmState: link.confirmState,
          confirmedAt: link.confirmedAt,
          policy: link.article.chapter.policy,
          article: {
            id: link.article.id,
            number: link.article.number,
            branchNumber: link.article.branchNumber,
            clauseNumber: link.article.clauseNumber,
            itemNumber: link.article.itemNumber,
            title: link.article.title,
          },
          baseVersion: version
            ? {
                id: version.id,
                versionNum: version.versionNum,
                status: version.status,
                effectiveDate: dateOnly(version.effectiveDate),
                content: version.content,
              }
            : null,
          skipReason,
          /** 기준일에 폐지돼 있으면 그 폐지 시행일 */
          repealedOn: state === 'repealed' ? dateOnly(picked!.repealedOn) : null,
        };
      })
      .sort(
        (a, b) =>
          a.policy.title.localeCompare(b.policy.title, 'ko') ||
          a.article.number - b.article.number ||
          (a.article.branchNumber ?? 0) - (b.article.branchNumber ?? 0) ||
          (a.article.clauseNumber ?? 0) - (b.article.clauseNumber ?? 0) ||
          (a.article.itemNumber ?? 0) - (b.article.itemNumber ?? 0),
      );
  }
}
