import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import { CreateLawLinkDto, UpdateLawLinkDto } from './law-links.dto';
import { citationNodeKey, extractLawCitations } from './law-citation';
import { ourLinks } from './our-links';
import { EVIDENCE_VERSION_SELECT, evidenceInContent, evidenceSource, evidenceSummary, withHeldVersions } from './evidence-version';
import { asOfState, currentVersionIdsSql } from '../common/as-of';
import { todayDateOnly } from '../common/date-only';

/**
 * 법령 관계 정보 (T-101).
 *
 * ⚠️ **테넌트별 데이터다.** `LawArticle`은 테넌트 공용(ADR-0020)이라 tenantId 가 없으므로,
 * 법령조항 id 로 시작하는 조회(`byLawArticle`)는 **이 서비스에서** 경계를 걸어야 한다 —
 * `LawArticle` 조회는 어디에도 tenantId 조건이 없다는 걸 잊기 쉽다. 모든 메서드가
 * `LawLink` 쪽 `where`에 tenantId 를 반드시 넣는다. 조문을 먼저 확인하지 않고 연결을 찾는 조회
 * (법령조항별 목록·수정·삭제)는 연결이 가리키는 조문의 실제 소속까지 본다 — `ourLinks`(T-148).
 *
 * `Article` 도 자체 tenantId 가 없다(chapter→policy 로 도달). 새 연결을 만들 때는
 * `comments.service.ts` 와 같은 패턴으로 소유를 확인한다: 존재 여부와 테넌트 소속을
 * 한 쿼리(`article.findFirst({ where: { id, chapter: { policy: { tenantId } } } })`)로
 * 같이 검증한다 — 따로 물으면 그 사이에 검사가 빠지는 코드가 나중에 추가되기 쉽다.
 */
@Injectable()
export class LawLinksService {
  constructor(private readonly prisma: PrismaService) {}

  private async requireOwnedArticle(tenantId: string, articleId: string) {
    const article = await this.prisma.article.findFirst({
      where: { id: articleId, chapter: { policy: { tenantId } } },
      select: { id: true },
    });
    if (!article) throw new NotFoundException('조문을 찾을 수 없습니다.');
    return article;
  }

  private async requireLawArticle(lawArticleId: string) {
    // LawArticle 은 테넌트 공용이라 존재만 확인한다. 소속 확인은 필요 없다.
    const row = await this.prisma.lawArticle.findUnique({
      where: { id: lawArticleId },
      select: { id: true, lawId: true, deletedAt: true },
    });
    if (!row) throw new NotFoundException('법령조항을 찾을 수 없습니다.');
    return row;
  }

  /**
   * 조문마다 오늘 시행 중인 판 — 규칙은 시점 조회의 "현재"(common/as-of) 하나. 오늘 폐지 상태인 조문은 시행 중인 판이 없다(asOfState).
   * 본문은 근거 문구가 담겼는지 재는 데만 쓰고 응답에 싣지 않는다(T-177)
   */
  private async currentVersionsOf(articleIds: string[]) {
    if (!articleIds.length) return new Map<string, { id: string; versionNum: number; content: string }>();
    const today = todayDateOnly();
    const ids = await this.prisma.$queryRaw<{ id: string }[]>(currentVersionIdsSql(articleIds, today));
    const rows = await this.prisma.articleVersion.findMany({
      where: { id: { in: ids.map((r) => r.id) } },
      select: { id: true, articleId: true, versionNum: true, content: true, repealedOn: true },
    });
    return new Map(
      rows.filter((r) => asOfState(r, today) === 'in_force').map((r) => [r.articleId, { id: r.id, versionNum: r.versionNum, content: r.content }]),
    );
  }

  /**
   * 목록에 근거 문구의 원천 판과 조문의 지금 판을 싣는다(T-177). 원천은 요약만(같은 조문의 판일 때만, 시행일은 날짜만), 지금 판은 번호와
   * "근거 문구가 그 본문에 있나"(hasEvidence)를 — 화면은 판 id 가 다르다고 알리지 않고 근거 문구가 지금 본문에 없을 때 알린다. 개정을
   * 승인할 때마다 헛 알림이 뜨지 않고, 원천 초안이 고쳐져 문구가 빠진 채 시행돼도 잡힌다. 재는 것은 본문에서 찾은 근거(evidenceFromBody —
   * 원천 판이 그 뒤 지워졌어도)뿐이다 — 처음부터 본문 밖 문구(메모 인용·직접 쓴 설명)는 늘 "없음"이라 알림이 헛돈다(null)
   */
  private async withEvidence<L extends { articleId: string; evidenceText: string | null; evidenceFromBody: boolean } & Parameters<typeof evidenceSummary>[0]>(
    links: L[],
  ) {
    const current = await this.currentVersionsOf([...new Set(links.map((l) => l.articleId))]);
    return links.map((l) => {
      const now = current.get(l.articleId);
      return {
        ...l,
        evidenceVersion: evidenceSummary(l),
        articleCurrentVersion: now
          ? { id: now.id, versionNum: now.versionNum, hasEvidence: l.evidenceFromBody ? evidenceInContent(now.content, l.evidenceText) : null }
          : null,
      };
    });
  }

  /** 이 사내 조문에 걸린 법령조항 목록 — 근거 문구의 원천 판과 조문의 지금 판을 함께 싣는다(T-177) */
  async byArticle(tenantId: string, articleId: string) {
    await this.requireOwnedArticle(tenantId, articleId);
    const links = await this.prisma.lawLink.findMany({
      where: { tenantId, articleId },
      include: {
        lawArticle: { include: { law: { select: { id: true, lawName: true } } } },
        evidenceVersion: EVIDENCE_VERSION_SELECT,
      },
      orderBy: { createdAt: 'desc' },
    });
    return this.withEvidence(links);
  }

  /**
   * 이 법령조항에 걸린 *우리 회사* 조문 목록.
   *
   * ⚠️ `lawArticleId` 만으로 조회하면 테넌트 경계가 없다 — 반드시 `tenantId` 를
   * where 에 함께 건다. 여기서 빠뜨리면 다른 회사가 이 법에 어떻게 대응해 뒀는지가
   * 새어 나간다(회사 기밀).
   */
  async byLawArticle(tenantId: string, lawArticleId: string) {
    await this.requireLawArticle(lawArticleId);
    const links = await this.prisma.lawLink.findMany({
      where: ourLinks(tenantId, { lawArticleId }),
      include: {
        article: { select: { id: true, title: true, number: true, clauseNumber: true, itemNumber: true } },
        evidenceVersion: EVIDENCE_VERSION_SELECT,
      },
      orderBy: { createdAt: 'desc' },
    });
    return this.withEvidence(links);
  }

  /** 수동 생성 — 사람이 직접 만든 연결이므로 바로 확정 상태로 저장한다 */
  async create(tenantId: string, userId: string, dto: CreateLawLinkDto) {
    await this.requireOwnedArticle(tenantId, dto.articleId);
    const lawArticle = await this.requireLawArticle(dto.lawArticleId);
    // 법령에서 사라진 조항(T-124)은 걸어 둔 연결만 남겨 둔다 — 새로 걸 대상은 아니다
    if (lawArticle.deletedAt) {
      throw new ConflictException('법령에서 삭제된 조항에는 새로 연결할 수 없습니다.');
    }

    const dup = await this.prisma.lawLink.findUnique({
      where: {
        tenantId_lawArticleId_articleId: {
          tenantId,
          lawArticleId: dto.lawArticleId,
          articleId: dto.articleId,
        },
      },
      select: { id: true },
    });
    if (dup) throw new ConflictException('이미 연결된 조합입니다.');

    // 근거 문구를 본문에 담은 판을 원천으로 남긴다(T-177) — 판 id 는 요청에서 받지 않고, 조문과 판들을 잡은 채 서버가 고른다
    return withHeldVersions(this.prisma, dto.articleId, (tx, versions, today) =>
      tx.lawLink.create({
        data: {
          tenantId,
          lawArticleId: dto.lawArticleId,
          articleId: dto.articleId,
          relationType: dto.relationType,
          scope: dto.scope,
          evidenceText: dto.evidenceText,
          ...evidenceSource(versions, dto.evidenceText, today),
          confirmState: 'confirmed',
          confirmedBy: userId,
          confirmedAt: new Date(),
        },
      }),
    );
  }

  async update(tenantId: string, id: string, userId: string, dto: UpdateLawLinkDto) {
    const existing = await this.prisma.lawLink.findFirst({ where: ourLinks(tenantId, { id }) });
    if (!existing) throw new NotFoundException('연결을 찾을 수 없습니다.');

    const becomingConfirmed = dto.confirmState === 'confirmed' && existing.confirmState !== 'confirmed';
    const data = (source: { evidenceVersionId: string | null; evidenceFromBody: boolean } | null) => ({
      relationType: dto.relationType,
      scope: dto.scope,
      evidenceText: dto.evidenceText,
      ...(source ?? {}),
      confirmState: dto.confirmState,
      ...(becomingConfirmed ? { confirmedBy: userId, confirmedAt: new Date() } : {}),
    });
    // 근거 문구를 보내지 않으면(확정·반려·관계 유형) 원천은 그대로 — 판을 잡지 않는다
    if (dto.evidenceText === undefined) return this.prisma.lawLink.update({ where: { id }, data: data(null) });
    // 보내면 원천도 함께 쓴다(T-177) — 바뀌었으면 잡은 판들로 다시 고르고, 같으면 읽어 둔 원천 그대로(그 판이 그 사이 지워졌으면 비운다).
    // 다른 요청이 그 사이 근거 문구를 고쳐도 문구와 원천이 짝으로 남는다(마지막 요청이 둘 다 쓴다)
    const evidenceText = dto.evidenceText;
    return withHeldVersions(this.prisma, existing.articleId, (tx, versions, today) =>
      tx.lawLink.update({
        where: { id },
        data: data(
          evidenceText !== existing.evidenceText
            ? evidenceSource(versions, evidenceText, today)
            : {
                evidenceVersionId: versions.some((v) => v.id === existing.evidenceVersionId) ? existing.evidenceVersionId : null,
                evidenceFromBody: existing.evidenceFromBody,
              },
        ),
      }),
    );
  }

  async remove(tenantId: string, id: string) {
    const existing = await this.prisma.lawLink.findFirst({ where: ourLinks(tenantId, { id }), select: { id: true } });
    if (!existing) throw new NotFoundException('연결을 찾을 수 없습니다.');
    await this.prisma.lawLink.delete({ where: { id } });
    return { ok: true };
  }

  /**
   * 본문에서 법령 인용을 찾아 `suggested` 상태로 연결을 만든다.
   *
   * 완전 자동 확정이 아니다 — 추출기가 오탐할 수 있으므로(law-citation.ts 주석 참고)
   * 항상 사람이 검토해야 하는 상태로 남긴다([[ADR-0021]]). 이미 같은 조합의 연결이
   * 있으면(확정이든 반려든) 새로 만들지 않는다 — 사람이 이미 본 조합을 다시 큐에
   * 올리지 않기 위해서다.
   */
  async suggest(tenantId: string, articleId: string) {
    await this.requireOwnedArticle(tenantId, articleId);

    const article = await this.prisma.article.findUnique({
      where: { id: articleId },
      // 훑는 본문은 판 번호가 가장 큰 판(versions[0]) — 원천은 쓸 때 조문과 판들을 잡은 채 고른다(T-177)
      select: { relatedLawNote: true, versions: { orderBy: { versionNum: 'desc' }, take: 1, select: { content: true } } },
    });
    if (!article) throw new NotFoundException('조문을 찾을 수 없습니다.');

    const text = [article.relatedLawNote, article.versions[0]?.content].filter(Boolean).join('\n');
    const citations = extractLawCitations(text);
    if (!citations.length) return { created: [], scanned: 0 };

    const existingLinks = await this.prisma.lawLink.findMany({
      where: { tenantId, articleId },
      select: { lawArticleId: true },
    });
    const alreadyLinked = new Set(existingLinks.map((l) => l.lawArticleId));

    const toCreate: { lawArticleId: string; evidenceText: string }[] = [];
    for (const citation of citations) {
      const nodeKey = citationNodeKey(citation);
      // 등록된 법 중 이름이 일치하는 것 — 여러 판이 있으면(개정 전후로 같은 이름이
      // 중복 등록될 일은 없다, sourceId+externalId 로 유일하다) 전부 시도한다.
      const laws = await this.prisma.law.findMany({
        where: { lawName: citation.lawName },
        select: { id: true },
      });
      for (const law of laws) {
        const lawArticle = await this.prisma.lawArticle.findUnique({
          where: { lawId_nodeKey: { lawId: law.id, nodeKey } },
          select: { id: true, deletedAt: true },
        });
        // 법령에서 사라진 조항(T-124)은 추천하지 않는다
        if (!lawArticle || lawArticle.deletedAt || alreadyLinked.has(lawArticle.id)) continue;
        alreadyLinked.add(lawArticle.id);
        toCreate.push({ lawArticleId: lawArticle.id, evidenceText: citation.matchedText });
      }
    }
    if (!toCreate.length) return { created: [], scanned: citations.length };
    // 넣는 순서를 법령조항 id 순으로 — 같은 조문에 추천이 겹칠 때 인용 순서가 달라도 같은 순서로 유일 색인을 잡아 서로 기다리다 멈추지 않는다
    toCreate.sort((a, b) => (a.lawArticleId < b.lawArticleId ? -1 : a.lawArticleId > b.lawArticleId ? 1 : 0));

    // 한 트랜잭션에 한꺼번에(T-177) — 조문과 판들을 잡은 채 인용마다 같은 규칙으로 원천을 고른다(메모에서만 나온 인용은 본문에 없어 비고,
    // 같은 인용을 담은 판이 여럿이면 시행 판 먼저). 중간에 막혀도 반쪽만 저장되지 않는다. 그 사이 같은 조합이 생겼으면 건너뛴다
    const created = await withHeldVersions(this.prisma, articleId, (tx, versions, today) =>
      tx.lawLink.createManyAndReturn({
        data: toCreate.map((c) => ({
          tenantId,
          lawArticleId: c.lawArticleId,
          articleId,
          relationType: 'citation' as const,
          evidenceText: c.evidenceText,
          ...evidenceSource(versions, c.evidenceText, today),
          confidence: 0.9,
          confirmState: 'suggested' as const,
        })),
        skipDuplicates: true,
      }),
    );

    return { created, scanned: citations.length };
  }
}
