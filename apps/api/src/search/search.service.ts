import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';

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
          title: `${row.article.chapter.policy.title} · 제${row.article.number}조`,
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
      return await this.searchWithBigm(tenantId, q, page, limit);
    } catch (e: any) {
      this.log.warn(`pg_bigm search fallback: ${e?.message || e}`);
      return { ...(await this.searchFallback(tenantId, q, page, limit)), searchEngine: 'ilike' };
    }
  }

  /** pg_bigm GIN 인덱스가 있으면 LIKE 검색이 가속됩니다. 확장/인덱스 없으면 예외 후 폴백. */
  private async searchWithBigm(tenantId: string, query: string, page: number, limit: number) {
    const skip = (page - 1) * limit;
    const pattern = `%${query.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_')}%`;

    const countRows = await this.prisma.$queryRaw<{ n: bigint }[]>(Prisma.sql`
      SELECT COUNT(*)::bigint AS n
      FROM article_versions av
      INNER JOIN articles a ON a.id = av.article_id
      INNER JOIN chapters c ON c.id = a.chapter_id
      INNER JOIN policies p ON p.id = c.policy_id
      WHERE p.tenant_id = ${tenantId}::uuid
        AND av.status = 'published'
        AND (
          av.content LIKE ${pattern} ESCAPE '\\'
          OR a.title LIKE ${pattern} ESCAPE '\\'
        )
    `);
    const total = Number(countRows[0]?.n ?? 0);

    const idRows = await this.prisma.$queryRaw<{ id: string }[]>(Prisma.sql`
      SELECT av.id
      FROM article_versions av
      INNER JOIN articles a ON a.id = av.article_id
      INNER JOIN chapters c ON c.id = a.chapter_id
      INNER JOIN policies p ON p.id = c.policy_id
      WHERE p.tenant_id = ${tenantId}::uuid
        AND av.status = 'published'
        AND (
          av.content LIKE ${pattern} ESCAPE '\\'
          OR a.title LIKE ${pattern} ESCAPE '\\'
        )
      ORDER BY av.id
      LIMIT ${limit} OFFSET ${skip}
    `);

    const ids = idRows.map((r) => r.id);
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
      searchEngine: 'pg_bigm_ready',
    };
  }

  private async searchFallback(tenantId: string, query: string, page: number, limit: number) {
    const skip = (page - 1) * limit;

    const [policies, versions, total] = await Promise.all([
      this.prisma.policy.findMany({
        where: {
          tenantId,
          OR: [
            { title: { contains: query, mode: 'insensitive' } },
            { code: { contains: query, mode: 'insensitive' } },
            { description: { contains: query, mode: 'insensitive' } },
          ],
        },
        take: 5,
      }),
      this.prisma.articleVersion.findMany({
        where: {
          status: 'published',
          article: {
            chapter: { policy: { tenantId } },
            OR: [
              { title: { contains: query, mode: 'insensitive' } },
              { versions: { some: { status: 'published', content: { contains: query, mode: 'insensitive' } } } },
            ],
          },
        },
        include: {
          article: {
            include: {
              chapter: { include: { policy: true } },
            },
          },
        },
        skip,
        take: limit,
      }),
      this.prisma.articleVersion.count({
        where: {
          status: 'published',
          article: {
            chapter: { policy: { tenantId } },
            OR: [
              { title: { contains: query, mode: 'insensitive' } },
              { versions: { some: { status: 'published', content: { contains: query, mode: 'insensitive' } } } },
            ],
          },
        },
      }),
    ]);

    return {
      policies,
      versions,
      pagination: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }
}
