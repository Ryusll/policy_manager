import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { AS_OF_VERSION_ORDER, asOfVersionWhere } from '../common/as-of';
import { parseDateOnly, toDateOnlyString, todayDateOnly } from '../common/date-only';
import { labelFromNodeKey } from '../laws/law-rows';
import { impactReferenceDate } from './law-impact';

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
   * 기준일에 시행 중인 발행 버전)까지. 개정 후보 생성(T-106)이 이 결과를 입력으로 쓴다.
   *
   * 기준일에 시행 중인 버전이 없는 조문(아직 시행 전 등)은 빼지 않고 `baseVersion: null` 로
   * 돌려준다 — 조용히 빠지면 "영향이 없다"로 읽힌다. 후보를 만들 수 없을 뿐이다.
   */
  async impact(tenantId: string, eventId: string, asOf?: string) {
    const event = await this.prisma.lawChangeEvent.findUnique({
      where: { id: eventId },
      select: EVENT_SELECT,
    });
    if (!event) throw new NotFoundException('변경 이벤트를 찾을 수 없습니다.');

    let asOfDate: Date;
    if (asOf !== undefined) {
      const parsed = parseDateOnly(asOf);
      if (!parsed) throw new BadRequestException('기준일(asOf)은 실제로 있는 날짜여야 합니다.');
      asOfDate = parsed;
    } else {
      asOfDate = impactReferenceDate(event.lawEffectiveDate, todayDateOnly());
    }

    const base = {
      event: presentEvent(event),
      asOf: toDateOnlyString(asOfDate),
    };

    if (!event.lawArticleId) {
      // 조문이 법령에서 통째로 사라지면 LawArticle 이 지워지고 거기 걸린 LawLink 도 함께 지워진다
      // (T-101 FK cascade). "영향 없음"으로 보이면 안 되므로 사유를 실어 보낸다
      return {
        ...base,
        impacted: [],
        suggestedCount: 0,
        unresolvable:
          '이 조문이 법령에서 사라져 연결 정보도 함께 지워졌습니다. 영향받던 사내 조문을 자동으로 찾을 수 없습니다.',
      };
    }

    const links = await this.prisma.lawLink.findMany({
      where: {
        tenantId,
        lawArticleId: event.lawArticleId,
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
        confirmedAt: true,
        article: {
          select: {
            id: true,
            number: true,
            clauseNumber: true,
            itemNumber: true,
            title: true,
            chapter: { select: { policy: { select: { id: true, code: true, title: true, isActive: true } } } },
            versions: {
              where: asOfVersionWhere(asOfDate),
              orderBy: AS_OF_VERSION_ORDER,
              take: 1,
              select: { id: true, versionNum: true, status: true, effectiveDate: true, content: true },
            },
          },
        },
      },
    });

    const suggestedCount = await this.prisma.lawLink.count({
      where: { tenantId, lawArticleId: event.lawArticleId, confirmState: 'suggested' },
    });

    const impacted = links
      .map((link) => {
        const version = link.article.versions[0] ?? null;
        return {
          linkId: link.id,
          relationType: link.relationType,
          scope: link.scope,
          evidenceText: link.evidenceText,
          confirmedAt: link.confirmedAt,
          policy: link.article.chapter.policy,
          article: {
            id: link.article.id,
            number: link.article.number,
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
          skipReason: version ? null : ('not_in_force' as const),
        };
      })
      .sort(
        (a, b) =>
          a.policy.title.localeCompare(b.policy.title, 'ko') ||
          a.article.number - b.article.number ||
          (a.article.clauseNumber ?? 0) - (b.article.clauseNumber ?? 0) ||
          (a.article.itemNumber ?? 0) - (b.article.itemNumber ?? 0),
      );

    return { ...base, impacted, suggestedCount, unresolvable: null };
  }
}
