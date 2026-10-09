import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { formatJo } from '../common/article-label';
import { currentVersionsSql } from '../common/as-of';
import { todayDateOnly } from '../common/date-only';

type RelatedType = 'precedent' | 'law' | 'rule';
type RelatedSort = 'relevance' | 'latest';
type RelatedScope = 'title' | 'fulltext';

@Injectable()
export class SearchService {
  private readonly log = new Logger(SearchService.name);

  constructor(private prisma: PrismaService) {}

  async relatedPreview(
    tenantId: string,
    type: RelatedType,
    query: string,
    limit = 5,
    sort: RelatedSort = 'relevance',
    scope: RelatedScope = 'fulltext',
  ) {
    const q = query.trim();
    if (!q) return { items: [], source: 'none' };

    const external = await this.fetchExternalPreview(type, q, limit, sort, scope);
    if (external.length > 0) return { items: external.slice(0, limit), source: 'external' };

    if (type === 'rule') {
      const rows = await this.prisma.articleVersion.findMany({
        where: {
          status: 'published',
          // 시행일 전인 개정은 아직 규정이 아니다(T-127)
          OR: [{ effectiveDate: null }, { effectiveDate: { lte: todayDateOnly() } }],
          ...(scope === 'title' ? {} : { content: { contains: q, mode: 'insensitive' } }),
          article: {
            chapter: { policy: { tenantId } },
            ...(scope === 'title'
              ? {
                  OR: [
                    { title: { contains: q, mode: 'insensitive' } },
                    { chapter: { policy: { title: { contains: q, mode: 'insensitive' } } } },
                  ],
                }
              : {}),
          },
        },
        include: {
          article: { include: { chapter: { include: { policy: true } } } },
        },
        orderBy: sort === 'latest' ? { createdAt: 'desc' } : undefined,
        take: limit,
      });
      return {
        source: 'internal',
        items: rows.map((row) => ({
          title: `${row.article.chapter.policy.title} · ${formatJo(row.article.number, row.article.branchNumber)}`,
          snippet: row.content.slice(0, 180),
          url: `/policies/${row.article.chapter.policyId}`,
        })),
      };
    }

    const policies = await this.prisma.policy.findMany({
      where: {
        tenantId,
        OR:
          scope === 'title'
            ? [
                { title: { contains: q, mode: 'insensitive' } },
                { code: { contains: q, mode: 'insensitive' } },
              ]
            : [
                { title: { contains: q, mode: 'insensitive' } },
                { code: { contains: q, mode: 'insensitive' } },
                { description: { contains: q, mode: 'insensitive' } },
              ],
      },
      orderBy: sort === 'latest' ? { updatedAt: 'desc' } : undefined,
      take: limit,
    });

    return {
      source: 'internal',
      items: policies.map((p) => ({
        title: type === 'precedent' ? `${p.title} 관련 판례 후보` : `${p.title} 관련 법령 후보`,
        snippet: p.description || `${p.code} 기준으로 연관 정보를 확인해 보세요.`,
        url: `/policies/${p.id}`,
      })),
    };
  }

  private async fetchExternalPreview(
    type: RelatedType,
    query: string,
    limit: number,
    sort: RelatedSort,
    scope: RelatedScope,
  ) {
    const endpoint = process.env.RELATED_PREVIEW_API_URL;
    if (!endpoint) return [];
    try {
      const url = new URL(endpoint);
      url.searchParams.set('type', type);
      url.searchParams.set('q', query);
      url.searchParams.set('limit', String(limit));
      url.searchParams.set('sort', sort);
      url.searchParams.set('scope', scope);
      const res = await fetch(url.toString(), { headers: { Accept: 'application/json' } });
      if (!res.ok) return [];
      const data = await res.json() as any;
      if (!Array.isArray(data?.items)) return [];
      return data.items
        .map((item: any) => ({
          title: String(item?.title || ''),
          snippet: String(item?.snippet || ''),
          url: String(item?.url || ''),
        }))
        .filter((item: any) => item.title);
    } catch {
      return [];
    }
  }

  /**
   * 검색 자동완성 (T-79) — 규정명과 조 제목에서 앞부분이 맞는 것을 준다.
   *
   * 본문은 대상에 넣지 않는다. 본문까지 넣으면 한 글자만 쳐도 수백 건이 걸려
   * 목록이 쓸모없어지고, 그건 이미 통합검색이 하는 일이다.
   * 제목만 보므로 인덱스로 충분히 빠르고 결과가 예측 가능하다.
   */
  async suggest(tenantId: string, query: string, limit = 8) {
    const q = (query || '').trim();
    if (q.length < 1) return { policies: [], articles: [] };

    const [policies, articles] = await Promise.all([
      this.prisma.policy.findMany({
        where: { tenantId, title: { contains: q, mode: 'insensitive' } },
        select: { id: true, code: true, title: true },
        orderBy: { title: 'asc' },
        take: limit,
      }),
      this.prisma.article.findMany({
        where: {
          title: { contains: q, mode: 'insensitive' },
          chapter: { policy: { tenantId } },
        },
        select: {
          id: true,
          number: true,
          branchNumber: true,
          title: true,
          chapter: { select: { policy: { select: { id: true, title: true } } } },
        },
        orderBy: [{ number: 'asc' }, { branchNumber: { sort: 'asc', nulls: 'first' } }],
        take: limit,
      }),
    ]);

    return {
      policies,
      articles: articles.map((a) => ({
        id: a.id,
        number: a.number,
        branchNumber: a.branchNumber,
        title: a.title,
        policyId: a.chapter.policy.id,
        policyTitle: a.chapter.policy.title,
      })),
    };
  }

  async search(tenantId: string, query: string, page = 1, limit = 20) {
    const q = query.trim();
    if (!q) {
      return {
        policies: [],
        versions: [],
        pagination: { total: 0, page, limit, totalPages: 0 },
        searchEngine: 'none',
      };
    }

    try {
      return { ...(await this.searchCurrent(tenantId, q, page, limit, 'LIKE')), searchEngine: 'pg_bigm_ready' };
    } catch (e: any) {
      this.log.warn(`pg_bigm search fallback: ${e?.message || e}`);
      return { ...(await this.searchCurrent(tenantId, q, page, limit, 'ILIKE')), searchEngine: 'ilike' };
    }
  }

  /**
   * 검색 대상은 조문마다 **지금 시행 중인 본문 하나**다(T-127) — 규칙은 `common/as-of.ts` 의
   * `currentVersionsSql`(규정 상세·규정 질문과 같다). 예전에는 `status = 'published'` 를 그대로 찾아,
   * 미래 시행일로 승인한 개정이 시행일 전부터 검색에 걸리고 지금 시행 중인 이전 본문은 걸리지 않았다.
   * 폐지된 조문(폐지일이 오늘 이하)도 빠진다.
   *
   * pg_bigm GIN 인덱스가 있으면 LIKE 가 가속된다. LIKE 경로가 실패하면 ILIKE 로 한 번 더 찾는다(SEARCH-2).
   * (예전 LIKE 경로는 텍스트 열을 `::uuid` 와 비교해 늘 실패했고, 실제로는 폴백만 돌고 있었다.)
   */
  private async searchCurrent(tenantId: string, query: string, page: number, limit: number, op: 'LIKE' | 'ILIKE') {
    const skip = (page - 1) * limit;
    const today = todayDateOnly();
    const pattern = `%${query.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_')}%`;
    const like = Prisma.raw(op);
    const hits = Prisma.sql`
      SELECT cur.version_id
      FROM (${currentVersionsSql(tenantId, today)}) cur
      JOIN articles a ON a.id = cur.article_id
      WHERE (cur.repealed_on IS NULL OR cur.repealed_on > ${today})
        AND (cur.content ${like} ${pattern} ESCAPE '\\' OR a.title ${like} ${pattern} ESCAPE '\\')`;

    const countRows = await this.prisma.$queryRaw<{ n: bigint }[]>(
      Prisma.sql`SELECT COUNT(*)::bigint AS n FROM (${hits}) h`,
    );
    const total = Number(countRows[0]?.n ?? 0);
    const idRows = await this.prisma.$queryRaw<{ version_id: string }[]>(
      Prisma.sql`SELECT h.version_id FROM (${hits}) h ORDER BY h.version_id LIMIT ${limit} OFFSET ${skip}`,
    );

    const ids = idRows.map((r) => r.version_id);
    let versions =
      ids.length === 0
        ? []
        : await this.prisma.articleVersion.findMany({
            where: { id: { in: ids } },
            include: {
              article: {
                include: {
                  chapter: { include: { policy: true } },
                },
              },
            },
          });
    const order = new Map(ids.map((id, i) => [id, i]));
    versions = versions.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));

    const policies = await this.prisma.policy.findMany({
      where: {
        tenantId,
        OR: [
          { title: { contains: query, mode: 'insensitive' } },
          { code: { contains: query, mode: 'insensitive' } },
          { description: { contains: query, mode: 'insensitive' } },
        ],
      },
      take: 5,
    });

    return {
      policies,
      versions,
      pagination: { total, page, limit, totalPages: Math.ceil(total / limit) || 0 },
    };
  }
}
