import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';

/**
 * 즐겨찾기 (T-80).
 *
 * 사용자별이면서 테넌트별이다. 조회에 `userId` 만 걸면 다른 회사로 초대된 같은 계정이
 * 이전 회사 규정을 계속 보게 되므로 `tenantId` 도 함께 건다.
 */
@Injectable()
export class FavoritesService {
  constructor(private prisma: PrismaService) {}

  async list(tenantId: string, userId: string) {
    const rows = await this.prisma.favorite.findMany({
      where: { tenantId, userId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        policyId: true,
        articleId: true,
        createdAt: true,
        policy: { select: { id: true, code: true, title: true, isActive: true } },
        article: { select: { id: true, number: true, clauseNumber: true, itemNumber: true, title: true } },
      },
    });
    return rows;
  }

  /**
   * 담기 — 이미 있으면 그대로 돌려준다.
   *
   * `@@unique` 에 기대지 않고 먼저 찾아보는 이유는 규정 즐겨찾기의 `articleId` 가
   * null 이기 때문이다. Postgres 는 NULL 을 서로 다른 값으로 봐서 유니크 제약이
   * 걸리지 않는다 — 같은 규정을 몇 번이고 담을 수 있게 된다.
   */
  async add(tenantId: string, userId: string, policyId: string, articleId?: string | null) {
    const policy = await this.prisma.policy.findFirst({
      where: { id: policyId, tenantId },
      select: { id: true },
    });
    if (!policy) throw new NotFoundException('규정을 찾을 수 없습니다.');

    if (articleId) {
      const article = await this.prisma.article.findFirst({
        where: { id: articleId, chapter: { policyId } },
        select: { id: true },
      });
      if (!article) throw new NotFoundException('조문을 찾을 수 없습니다.');
    }

    const existing = await this.prisma.favorite.findFirst({
      where: { tenantId, userId, policyId, articleId: articleId ?? null },
      select: { id: true },
    });
    if (existing) return existing;

    return this.prisma.favorite.create({
      data: { tenantId, userId, policyId, articleId: articleId ?? null },
      select: { id: true },
    });
  }

  async remove(tenantId: string, userId: string, id: string) {
    const found = await this.prisma.favorite.findFirst({
      where: { id, tenantId, userId },
      select: { id: true },
    });
    if (!found) throw new NotFoundException('즐겨찾기를 찾을 수 없습니다.');
    await this.prisma.favorite.delete({ where: { id } });
  }

  /** 특정 대상이 담겨 있는지 (화면의 별 표시용) */
  async find(tenantId: string, userId: string, policyId: string, articleId?: string | null) {
    return this.prisma.favorite.findFirst({
      where: { tenantId, userId, policyId, articleId: articleId ?? null },
      select: { id: true },
    });
  }
}
