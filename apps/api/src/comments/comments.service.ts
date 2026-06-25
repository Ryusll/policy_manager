import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import { CreateArticleCommentDto, UpdateArticleCommentDto } from './comments.dto';

@Injectable()
export class CommentsService {
  constructor(private prisma: PrismaService) {}

  async listByArticle(tenantId: string, articleId: string) {
    const article = await this.prisma.article.findFirst({
      where: { id: articleId, chapter: { policy: { tenantId } } },
      select: { id: true },
    });
    if (!article) throw new NotFoundException('Article not found');

    return this.prisma.articleComment.findMany({
      where: { tenantId, articleId },
      include: {
        user: { select: { id: true, name: true, email: true, role: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async create(tenantId: string, articleId: string, userId: string, dto: CreateArticleCommentDto) {
    const article = await this.prisma.article.findFirst({
      where: { id: articleId, chapter: { policy: { tenantId } } },
      select: { id: true },
    });
    if (!article) throw new NotFoundException('Article not found');

    return this.prisma.articleComment.create({
      data: {
        tenantId,
        articleId,
        userId,
        content: dto.content.trim(),
      },
      include: {
        user: { select: { id: true, name: true, email: true, role: true } },
      },
    });
  }

  async update(tenantId: string, id: string, dto: UpdateArticleCommentDto) {
    const existing = await this.prisma.articleComment.findFirst({
      where: { id, tenantId },
      select: { id: true },
    });
    if (!existing) throw new NotFoundException('Comment not found');

    return this.prisma.articleComment.update({
      where: { id },
      data: { isResolved: dto.isResolved },
    });
  }
}

