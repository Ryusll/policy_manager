import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import { CreateLawLinkDto, UpdateLawLinkDto } from './law-links.dto';
import { citationNodeKey, extractLawCitations } from './law-citation';

/**
 * 법령 관계 정보 (T-101).
 *
 * ⚠️ **테넌트별 데이터다.** `LawArticle`은 테넌트 공용(ADR-0020)이라 tenantId 가 없으므로,
 * 법령조항 id 로 시작하는 조회(`byLawArticle`)는 **이 서비스에서** 경계를 걸어야 한다 —
 * `LawArticle` 조회는 어디에도 tenantId 조건이 없다는 걸 잊기 쉽다. 모든 메서드가
 * `LawLink` 쪽 `where`에 tenantId 를 반드시 넣는다.
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
      select: { id: true, lawId: true },
    });
    if (!row) throw new NotFoundException('법령조항을 찾을 수 없습니다.');
    return row;
  }

  /** 이 사내 조문에 걸린 법령조항 목록 */
  async byArticle(tenantId: string, articleId: string) {
    await this.requireOwnedArticle(tenantId, articleId);
    return this.prisma.lawLink.findMany({
      where: { tenantId, articleId },
      include: {
        lawArticle: { include: { law: { select: { id: true, lawName: true } } } },
      },
      orderBy: { createdAt: 'desc' },
    });
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
    return this.prisma.lawLink.findMany({
      where: { tenantId, lawArticleId },
      include: {
        article: { select: { id: true, title: true, number: true, clauseNumber: true, itemNumber: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /** 수동 생성 — 사람이 직접 만든 연결이므로 바로 확정 상태로 저장한다 */
  async create(tenantId: string, userId: string, dto: CreateLawLinkDto) {
    await this.requireOwnedArticle(tenantId, dto.articleId);
    await this.requireLawArticle(dto.lawArticleId);

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

    return this.prisma.lawLink.create({
      data: {
        tenantId,
        lawArticleId: dto.lawArticleId,
        articleId: dto.articleId,
        relationType: dto.relationType,
        scope: dto.scope,
        evidenceText: dto.evidenceText,
        confirmState: 'confirmed',
        confirmedBy: userId,
        confirmedAt: new Date(),
      },
    });
  }

  async update(tenantId: string, id: string, userId: string, dto: UpdateLawLinkDto) {
    const existing = await this.prisma.lawLink.findFirst({ where: { id, tenantId } });
    if (!existing) throw new NotFoundException('연결을 찾을 수 없습니다.');

    const becomingConfirmed = dto.confirmState === 'confirmed' && existing.confirmState !== 'confirmed';

    return this.prisma.lawLink.update({
      where: { id },
      data: {
        relationType: dto.relationType,
        scope: dto.scope,
        evidenceText: dto.evidenceText,
        confirmState: dto.confirmState,
        ...(becomingConfirmed ? { confirmedBy: userId, confirmedAt: new Date() } : {}),
      },
    });
  }

  async remove(tenantId: string, id: string) {
    const existing = await this.prisma.lawLink.findFirst({ where: { id, tenantId }, select: { id: true } });
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
      select: {
        relatedLawNote: true,
        versions: {
          orderBy: { versionNum: 'desc' },
          take: 1,
          select: { content: true },
        },
      },
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

    const created: unknown[] = [];
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
          select: { id: true },
        });
        if (!lawArticle || alreadyLinked.has(lawArticle.id)) continue;

        const link = await this.prisma.lawLink.create({
          data: {
            tenantId,
            lawArticleId: lawArticle.id,
            articleId,
            relationType: 'citation',
            evidenceText: citation.matchedText,
            confidence: 0.9,
            confirmState: 'suggested',
          },
        });
        alreadyLinked.add(lawArticle.id);
        created.push(link);
      }
    }

    return { created, scanned: citations.length };
  }
}
