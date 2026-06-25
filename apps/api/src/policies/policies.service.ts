import {
  Injectable,
  NotFoundException,
  ConflictException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { VariablesService } from '../variables/variables.service';
import { maxPoliciesForPlan } from '../common/plan-limits';
import {
  CreatePolicyDto,
  UpdatePolicyDto,
  CreateChapterDto,
  UpdateChapterDto,
  CreateArticleDto,
  UpdateArticleDto,
  CreatePolicyAppendixDto,
  UpdatePolicyAppendixDto,
  CreatePolicyImportLogDto,
} from './policies.dto';

@Injectable()
export class PoliciesService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
    private variablesService: VariablesService,
  ) {}

  async findAll(tenantId: string) {
    return this.prisma.policy.findMany({
      where: { tenantId },
      include: {
        _count: { select: { chapters: true } },
        template: {
          select: { id: true, name: true, isDefault: true, isActive: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(tenantId: string, id: string) {
    const policy = await this.prisma.policy.findFirst({
      where: { id, tenantId },
      include: {
        template: true,
        chapters: {
          include: {
            articles: {
              include: {
                versions: {
                  where: { status: 'published' },
                  orderBy: { versionNum: 'desc' },
                  take: 1,
                },
              },
              orderBy: [
                { number: 'asc' },
                { clauseNumber: { sort: 'asc', nulls: 'first' } },
                { itemNumber: { sort: 'asc', nulls: 'first' } },
              ],
            },
          },
          orderBy: { number: 'asc' },
        },
        appendices: {
          orderBy: [{ kind: 'asc' }, { sortOrder: 'asc' }, { createdAt: 'asc' }],
        },
      },
    });
    if (!policy) throw new NotFoundException('Policy not found');
    return policy;
  }

  async create(tenantId: string, dto: CreatePolicyDto, userId: string) {
    const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId } });
    if (!tenant) throw new NotFoundException('Tenant not found');

    const count = await this.prisma.policy.count({ where: { tenantId } });
    const max = maxPoliciesForPlan(tenant.plan);
    if (count >= max) {
      throw new ForbiddenException(
        `현재 플랜(${tenant.plan})에서 등록 가능한 규정은 최대 ${max}건입니다.`,
      );
    }

    if (dto.templateId) {
      if (tenant.plan === 'starter') {
        throw new ForbiddenException('Policy template assignment requires pro plan or higher');
      }
      const template = await this.prisma.policyTemplate.findFirst({
        where: { id: dto.templateId, tenantId, isActive: true },
      });
      if (!template) throw new NotFoundException('Template not found');
    }

    const existing = await this.prisma.policy.findUnique({
      where: { tenantId_code: { tenantId, code: dto.code } },
    });
    if (existing) {
      throw new ConflictException('Code ' + dto.code + ' is already in use');
    }
    const { department, category, ...baseDto } = dto as any;
    const metadata = {
      ...(department?.trim() ? { department: department.trim() } : {}),
      ...(category?.trim() ? { category: category.trim() } : {}),
    };
    const created = await this.prisma.policy.create({
      data: {
        tenantId,
        ...baseDto,
        metadata: Object.keys(metadata).length ? (metadata as any) : undefined,
      },
    });
    await this.audit.log({
      tenantId,
      userId,
      action: 'policy.create',
      entityType: 'Policy',
      entityId: created.id,
      details: { code: created.code },
    });
    return created;
  }

  async update(tenantId: string, id: string, dto: UpdatePolicyDto, userId: string) {
    const existing = await this.findOne(tenantId, id);
    if (dto.templateId !== undefined) {
      const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { plan: true } });
      if (!tenant) throw new NotFoundException('Tenant not found');
      if (tenant.plan === 'starter') {
        throw new ForbiddenException('Policy template assignment requires pro plan or higher');
      }
    }
    if (dto.templateId) {
      const template = await this.prisma.policyTemplate.findFirst({
        where: { id: dto.templateId, tenantId, isActive: true },
      });
      if (!template) throw new NotFoundException('Template not found');
    }
    if (dto.templateId === null) {
      (dto as any).templateId = null;
    }
    const nextDto = { ...dto } as any;
    const hasDepartment = Object.prototype.hasOwnProperty.call(nextDto, 'department');
    const hasCategory = Object.prototype.hasOwnProperty.call(nextDto, 'category');
    const currentMeta =
      existing.metadata && typeof existing.metadata === 'object'
        ? ({ ...(existing.metadata as Record<string, unknown>) } as Record<string, unknown>)
        : {};
    if (hasDepartment) {
      const v = String(nextDto.department ?? '').trim();
      if (v) currentMeta.department = v;
      else delete currentMeta.department;
      delete nextDto.department;
    }
    if (hasCategory) {
      const v = String(nextDto.category ?? '').trim();
      if (v) currentMeta.category = v;
      else delete currentMeta.category;
      delete nextDto.category;
    }
    if (hasDepartment || hasCategory) {
      nextDto.metadata = Object.keys(currentMeta).length ? (currentMeta as any) : null;
    }
    const hasRevisionNotify = Object.prototype.hasOwnProperty.call(nextDto, 'revisionNotify');
    if (hasRevisionNotify) {
      const raw = nextDto.revisionNotify;
      delete nextDto.revisionNotify;
      if (raw == null) {
        delete currentMeta.revisionNotify;
        delete currentMeta.revisionNotifyEnabled;
      } else {
        currentMeta.revisionNotify = {
          enabled: raw.enabled === true,
          userIds: Array.isArray(raw.userIds) ? raw.userIds : [],
          groupIds: Array.isArray(raw.groupIds) ? raw.groupIds : [],
        };
        delete currentMeta.revisionNotifyEnabled;
      }
      nextDto.metadata = Object.keys(currentMeta).length ? (currentMeta as any) : null;
    }
    if (Object.prototype.hasOwnProperty.call(nextDto, 'revisionDate')) {
      const raw = nextDto.revisionDate;
      nextDto.revisionDate = raw ? new Date(String(raw)) : null;
    }
    if (Object.prototype.hasOwnProperty.call(nextDto, 'effectiveDate')) {
      const raw = nextDto.effectiveDate;
      nextDto.effectiveDate = raw ? new Date(String(raw)) : null;
    }
    const updated = await this.prisma.policy.update({
      where: { id },
      data: nextDto,
    });
    await this.audit.log({
      tenantId,
      userId,
      action: 'policy.update',
      entityType: 'Policy',
      entityId: id,
      details: { fields: Object.keys(nextDto) },
    });
    return updated;
  }

  async remove(tenantId: string, id: string, userId: string) {
    await this.findOne(tenantId, id);
    await this.prisma.policy.delete({ where: { id } });
    await this.audit.log({
      tenantId,
      userId,
      action: 'policy.delete',
      entityType: 'Policy',
      entityId: id,
    });
  }

  async createChapter(tenantId: string, policyId: string, dto: CreateChapterDto, userId: string) {
    await this.findOne(tenantId, policyId);
    const suppress = dto.suppressHeader === true;
    const title = String(dto.title ?? '').trim();
    if (!suppress && !title) {
      throw new BadRequestException('장 제목을 입력하세요.');
    }
    const ch = await this.prisma.chapter.create({
      data: {
        policyId,
        number: dto.number,
        title: title || '본문',
        suppressHeader: suppress,
      },
    });
    await this.audit.log({
      tenantId,
      userId,
      action: 'chapter.create',
      entityType: 'Chapter',
      entityId: ch.id,
      details: { policyId },
    });
    return ch;
  }

  async updateChapter(tenantId: string, policyId: string, chapterId: string, dto: UpdateChapterDto) {
    await this.findOne(tenantId, policyId);
    const chapter = await this.prisma.chapter.findFirst({
      where: { id: chapterId, policyId },
    });
    if (!chapter) throw new NotFoundException('Chapter not found');
    return this.prisma.chapter.update({ where: { id: chapterId }, data: dto });
  }

  async removeChapter(tenantId: string, policyId: string, chapterId: string) {
    await this.findOne(tenantId, policyId);
    const chapter = await this.prisma.chapter.findFirst({
      where: { id: chapterId, policyId },
    });
    if (!chapter) throw new NotFoundException('Chapter not found');
    await this.prisma.chapter.delete({ where: { id: chapterId } });
  }

  async createArticle(
    tenantId: string,
    policyId: string,
    chapterId: string,
    dto: CreateArticleDto,
  ) {
    await this.findOne(tenantId, policyId);
    const chapter = await this.prisma.chapter.findFirst({ where: { id: chapterId, policyId } });
    if (!chapter) throw new NotFoundException('Chapter not found');

    const article = await this.prisma.article.create({
      data: {
        chapterId,
        number: dto.number,
        title: (dto.title ?? '').trim(),
        clauseNumber: dto.clauseNumber,
        itemNumber: dto.itemNumber,
        hasPrecedent: dto.hasPrecedent ?? false,
        hasRelatedLaw: dto.hasRelatedLaw ?? false,
        hasRelatedRule: dto.hasRelatedRule ?? false,
        relatedPrecedentNote: dto.relatedPrecedentNote?.trim() || null,
        relatedLawNote: dto.relatedLawNote?.trim() || null,
        relatedRuleNote: dto.relatedRuleNote?.trim() || null,
      },
    });

    if (dto.content) {
      const ver = await this.prisma.articleVersion.create({
        data: {
          articleId: article.id,
          versionNum: 1,
          content: dto.content,
          status: 'draft',
        },
      });
      await this.variablesService.syncVariableUsagesFromContent(tenantId, ver.id, ver.content);
    }
    return article;
  }

  async updateArticle(tenantId: string, policyId: string, chapterId: string, articleId: string, dto: UpdateArticleDto) {
    await this.findOne(tenantId, policyId);
    const article = await this.prisma.article.findFirst({
      where: { id: articleId, chapterId },
    });
    if (!article) throw new NotFoundException('Article not found');
    const data: Record<string, unknown> = { ...dto };
    for (const key of ['relatedPrecedentNote', 'relatedLawNote', 'relatedRuleNote'] as const) {
      if (data[key] !== undefined) {
        const t = String(data[key] ?? '').trim();
        data[key] = t.length ? t : null;
      }
    }
    return this.prisma.article.update({ where: { id: articleId }, data: data as any });
  }

  async removeArticle(tenantId: string, policyId: string, chapterId: string, articleId: string) {
    await this.findOne(tenantId, policyId);
    const article = await this.prisma.article.findFirst({
      where: { id: articleId, chapterId },
    });
    if (!article) throw new NotFoundException('Article not found');
    await this.prisma.article.delete({ where: { id: articleId } });
  }

  async createAppendix(tenantId: string, policyId: string, dto: CreatePolicyAppendixDto) {
    await this.findOne(tenantId, policyId);
    return this.prisma.policyAppendix.create({
      data: {
        policyId,
        kind: dto.kind,
        title: dto.title.trim(),
        body: dto.body ?? '',
        sortOrder: dto.sortOrder ?? 0,
      },
    });
  }

  async updateAppendix(
    tenantId: string,
    policyId: string,
    appendixId: string,
    dto: UpdatePolicyAppendixDto,
  ) {
    await this.findOne(tenantId, policyId);
    const row = await this.prisma.policyAppendix.findFirst({
      where: { id: appendixId, policyId },
    });
    if (!row) throw new NotFoundException('Appendix not found');
    const data: Record<string, unknown> = {};
    if (dto.kind !== undefined) data.kind = dto.kind;
    if (dto.title !== undefined) data.title = dto.title.trim();
    if (dto.body !== undefined) data.body = dto.body;
    if (dto.sortOrder !== undefined) data.sortOrder = dto.sortOrder;
    return this.prisma.policyAppendix.update({
      where: { id: appendixId },
      data: data as any,
    });
  }

  async removeAppendix(tenantId: string, policyId: string, appendixId: string) {
    await this.findOne(tenantId, policyId);
    const row = await this.prisma.policyAppendix.findFirst({
      where: { id: appendixId, policyId },
    });
    if (!row) throw new NotFoundException('Appendix not found');
    await this.prisma.policyAppendix.delete({ where: { id: appendixId } });
  }

  async listImportLogs(tenantId: string, take = 30) {
    return this.prisma.policyImportLog.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
      take: Math.max(1, Math.min(100, Number(take) || 30)),
    });
  }

  async createImportLog(tenantId: string, userId: string, dto: CreatePolicyImportLogDto) {
    return this.prisma.policyImportLog.create({
      data: {
        tenantId,
        userId,
        policyId: dto.policyId || null,
        sourceName: dto.sourceName || null,
        parseProfile: dto.parseProfile || 'mixed',
        chapterCount: dto.chapterCount ?? 0,
        articleCount: dto.articleCount ?? 0,
        cleanupOptions: (dto.cleanupOptions || null) as any,
        status: dto.status || 'success',
        message: dto.message || null,
      },
    });
  }
}
