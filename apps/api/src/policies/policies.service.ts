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
import { buildPolicyForest } from './policy-hierarchy';
import { coerceNullableDate, parseDateOnly, toDateOnlyString } from '../common/date-only';
import { buildComparisonRows, type CompareArticleInput } from './policy-compare';
import {
  buildThreeWayRows,
  type ThreeWayArticle,
  type ThreeWayPolicy,
} from './policy-three-way';
import {
  CreatePolicyDto,
  UpdatePolicyDto,
  CreateChapterDto,
  CreateSectionDto,
  UpdateSectionDto,
  UpdateChapterDto,
  CreateArticleDto,
  UpdateArticleDto,
  CreatePolicyAppendixDto,
  UpdatePolicyAppendixDto,
  CreatePolicyImportLogDto,
  CreateRevisionReasonDto,
  UpdateRevisionReasonDto,
} from './policies.dto';

@Injectable()
export class PoliciesService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
    private variablesService: VariablesService,
  ) {}

  /**
   * 상위 규정 지정을 검증한다 (T-71).
   *
   * 순환(A→B→A)이 생기면 체계도를 그리는 쪽이 무한루프에 빠진다. DB 제약으로는 막을 수
   * 없어서 여기서 조상 사슬을 거슬러 올라가며 확인한다. 사슬 길이는 규정 수를 넘지 않으므로
   * 안전장치로 상한을 둔다(데이터가 이미 순환이면 루프를 못 빠져나온다).
   */
  private async assertParentAllowed(tenantId: string, policyId: string, parentId: string) {
    if (parentId === policyId) {
      throw new BadRequestException('규정을 자기 자신의 하위로 둘 수 없습니다.');
    }
    const parent = await this.prisma.policy.findFirst({
      where: { id: parentId, tenantId },
      select: { id: true },
    });
    if (!parent) throw new NotFoundException('상위 규정을 찾을 수 없습니다.');

    const total = await this.prisma.policy.count({ where: { tenantId } });
    let cursor: string | null = parentId;
    for (let hops = 0; cursor && hops <= total; hops += 1) {
      if (cursor === policyId) {
        throw new BadRequestException('상위 규정으로 지정하면 체계가 순환합니다.');
      }
      const row = await this.prisma.policy.findFirst({
        where: { id: cursor, tenantId },
        select: { parentId: true },
      });
      cursor = row?.parentId ?? null;
    }
  }

  /**
   * 규정 체계도 (T-71). 상위·하위를 트리로 돌려준다.
   *
   * 한 번의 조회로 전부 받아 메모리에서 엮는다. 테넌트당 규정 수가 많아야 수천이고,
   * 재귀 쿼리를 쓰면 Prisma 밖으로 나가야 해서 얻는 것보다 잃는 게 많다.
   */
  async findHierarchy(tenantId: string) {
    const policies = await this.prisma.policy.findMany({
      where: { tenantId },
      select: {
        id: true,
        code: true,
        title: true,
        isActive: true,
        parentId: true,
        effectiveDate: true,
        _count: { select: { chapters: true } },
      },
      orderBy: [{ code: 'asc' }],
    });

    const roots = buildPolicyForest(policies);
    return { roots, total: policies.length };
  }

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
            sections: { orderBy: { number: 'asc' } },
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
        revisionReasons: {
          orderBy: [{ effectiveDate: 'desc' }, { createdAt: 'desc' }],
        },
      },
    });
    if (!policy) throw new NotFoundException('Policy not found');
    return policy;
  }

  /**
   * 시점(as-of) 조회 — 기준일에 시행 중이던 본문을 재구성한다.
   *
   * 조문별로 "시행일이 기준일 이하인 시행분 중 가장 나중" 버전을 고른다.
   * 기준일에 아직 시행되지 않은 조는 결과에서 제외한다(그날 존재하지 않던 조문).
   * `findOne`과 같은 형태로 돌려주므로 전문 보기·인쇄·PDF가 그대로 재사용된다.
   */
  async findOneAsOf(tenantId: string, id: string, asOf: string) {
    const asOfDate = parseDateOnly(asOf);
    if (!asOfDate) {
      throw new BadRequestException('기준일(date)은 YYYY-MM-DD 형식이어야 합니다.');
    }

    const policy = await this.prisma.policy.findFirst({
      where: { id, tenantId },
      include: {
        template: true,
        chapters: {
          include: {
            sections: { orderBy: { number: 'asc' } },
            articles: {
              include: {
                versions: {
                  // 시행 이력이 있는 버전만 후보(초안·검토중 제외)
                  where: {
                    status: { in: ['published', 'archived'] },
                    effectiveDate: { not: null, lte: asOfDate },
                  },
                  orderBy: [{ effectiveDate: 'desc' }, { versionNum: 'desc' }],
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
        revisionReasons: {
          where: { OR: [{ effectiveDate: null }, { effectiveDate: { lte: asOfDate } }] },
          orderBy: [{ effectiveDate: 'desc' }, { createdAt: 'desc' }],
        },
      },
    });
    if (!policy) throw new NotFoundException('Policy not found');

    let omittedArticles = 0;
    const chapters = policy.chapters.map((chapter) => {
      const articles = chapter.articles.filter((article) => {
        if (article.versions.length > 0) return true;
        omittedArticles += 1;
        return false;
      });
      return { ...chapter, articles };
    });

    return {
      ...policy,
      chapters,
      asOf: {
        date: asOf,
        omittedArticles,
        // 시행일이 하나도 기록되지 않았다면 시점 조회가 무의미하다는 신호
        hasEffectiveDates: await this.hasAnyEffectiveDate(id),
      },
    };
  }

  /**
   * 신구조문대비표 — 두 시점 스냅샷을 조문 단위로 맞댄다.
   * 국가법령정보센터의 신구법비교에 해당하되 대상이 우리 규정이라 외부 데이터가 필요 없다.
   */
  async compareAsOf(tenantId: string, id: string, from: string, to: string) {
    const fromDate = parseDateOnly(from);
    const toDate = parseDateOnly(to);
    if (!fromDate || !toDate) {
      throw new BadRequestException('비교 시점(from·to)은 YYYY-MM-DD 형식이어야 합니다.');
    }
    if (fromDate.getTime() > toDate.getTime()) {
      throw new BadRequestException('from은 to보다 앞선 날짜여야 합니다.');
    }

    const policy = await this.prisma.policy.findFirst({
      where: { id, tenantId },
      select: { id: true, code: true, title: true },
    });
    if (!policy) throw new NotFoundException('Policy not found');

    const [beforeRows, afterRows] = await Promise.all([
      this.articlesAsOf(id, fromDate),
      this.articlesAsOf(id, toDate),
    ]);

    const { rows, summary } = buildComparisonRows(beforeRows, afterRows);
    return { policy, from, to, summary, rows };
  }

  /**
   * 3단비교 (T-56). 기준 규정 아래 두 단계(세칙·지침)를 나란히 놓는다.
   *
   * 짝짓기는 하위 조문 본문의 **상위 규정 인용**으로 한다(`policy-three-way.ts`).
   * 조 번호를 그냥 맞추는 방식은 쓰지 않았다 — 세칙 제1조가 규정 제1조와 관계있다는
   * 보장이 전혀 없어서 표가 그럴듯하게 틀린다.
   */
  async threeWay(tenantId: string, id: string) {
    const base = await this.prisma.policy.findFirst({
      where: { id, tenantId },
      select: { id: true, code: true, title: true },
    });
    if (!base) throw new NotFoundException('Policy not found');

    // 하위 2단계까지만 본다. 3단비교라는 이름 그대로다.
    const children = await this.prisma.policy.findMany({
      where: { tenantId, parentId: id },
      select: { id: true, code: true, title: true },
      orderBy: { code: 'asc' },
    });
    const grandchildren = children.length
      ? await this.prisma.policy.findMany({
          where: { tenantId, parentId: { in: children.map((c) => c.id) } },
          select: { id: true, code: true, title: true },
          orderBy: { code: 'asc' },
        })
      : [];

    const levels: ThreeWayPolicy[] = [
      { ...base, level: 0 },
      ...children.map((c) => ({ ...c, level: 1 })),
      ...grandchildren.map((g) => ({ ...g, level: 2 })),
    ];

    const articlesByPolicy = new Map<string, ThreeWayArticle[]>();
    for (const policy of levels) {
      articlesByPolicy.set(policy.id, await this.publishedArticles(policy.id));
    }

    const { rows, unmatched, matchedCount } = buildThreeWayRows(
      articlesByPolicy.get(base.id) || [],
      levels
        .filter((p) => p.level > 0)
        .map((policy) => ({ policy, articles: articlesByPolicy.get(policy.id) || [] })),
    );

    return {
      base,
      levels,
      rows,
      unmatched,
      summary: {
        baseArticles: rows.length,
        related: matchedCount,
        unmatched: unmatched.reduce((n, row) => n + row.related.length, 0),
      },
    };
  }

  /** 현재 게시된 본문 기준 조문 목록 (3단비교용) */
  private async publishedArticles(policyId: string): Promise<ThreeWayArticle[]> {
    const articles = await this.prisma.article.findMany({
      where: { chapter: { policyId } },
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
    });
    return articles.map((a) => ({
      id: a.id,
      number: a.number,
      clauseNumber: a.clauseNumber,
      itemNumber: a.itemNumber,
      title: a.title || '',
      content: a.versions[0]?.content || '',
    }));
  }

  /** 특정 시점에 시행 중이던 조문을 비교용 평탄 목록으로 */
  private async articlesAsOf(policyId: string, asOfDate: Date): Promise<CompareArticleInput[]> {
    const articles = await this.prisma.article.findMany({
      where: { chapter: { policyId } },
      include: {
        versions: {
          where: {
            status: { in: ['published', 'archived'] },
            effectiveDate: { not: null, lte: asOfDate },
          },
          orderBy: [{ effectiveDate: 'desc' }, { versionNum: 'desc' }],
          take: 1,
        },
      },
      orderBy: [
        { number: 'asc' },
        { clauseNumber: { sort: 'asc', nulls: 'first' } },
        { itemNumber: { sort: 'asc', nulls: 'first' } },
      ],
    });

    return articles
      .filter((article) => article.versions.length > 0)
      .map((article) => {
        const version = article.versions[0];
        return {
          id: article.id,
          number: article.number,
          clauseNumber: article.clauseNumber,
          itemNumber: article.itemNumber,
          title: article.title ?? '',
          content: version.content ?? '',
          effectiveDate: version.effectiveDate ? toDateOnlyString(version.effectiveDate) : null,
        };
      });
  }

  private async hasAnyEffectiveDate(policyId: string): Promise<boolean> {
    const count = await this.prisma.articleVersion.count({
      where: {
        effectiveDate: { not: null },
        article: { chapter: { policyId } },
      },
    });
    return count > 0;
  }

  /** 시점 조회 슬라이더용: 이 규정에서 실제로 본문이 바뀐 날짜들 */
  async listEffectiveDates(tenantId: string, id: string) {
    const policy = await this.prisma.policy.findFirst({ where: { id, tenantId }, select: { id: true } });
    if (!policy) throw new NotFoundException('Policy not found');

    const rows = await this.prisma.articleVersion.findMany({
      where: {
        status: { in: ['published', 'archived'] },
        effectiveDate: { not: null },
        article: { chapter: { policyId: id } },
      },
      select: { effectiveDate: true },
      distinct: ['effectiveDate'],
      orderBy: { effectiveDate: 'desc' },
    });
    return rows
      .map((r) => (r.effectiveDate ? toDateOnlyString(r.effectiveDate) : null))
      .filter((d): d is string => !!d);
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
    if (dto.parentId) {
      await this.assertParentAllowed(tenantId, id, dto.parentId);
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

  /**
   * 조문에 지정된 절이 같은 장에 속하는지 검증한다.
   * `undefined`(미지정)와 `null`(절에서 분리)을 구분해서 돌려준다.
   */
  private async resolveSectionId(
    chapterId: string,
    sectionId: string | null | undefined,
  ): Promise<string | null | undefined> {
    if (sectionId === undefined) return undefined;
    if (sectionId === null || sectionId === '') return null;
    const section = await this.prisma.section.findFirst({
      where: { id: sectionId, chapterId },
      select: { id: true },
    });
    if (!section) throw new BadRequestException('해당 장에 속한 절이 아닙니다.');
    return section.id;
  }

  /** 절(節)은 선택 계층이다. 절을 지워도 소속 조문은 남고 sectionId만 해제된다(ADR-0011) */
  private async findChapterOrThrow(tenantId: string, policyId: string, chapterId: string) {
    await this.findOne(tenantId, policyId);
    const chapter = await this.prisma.chapter.findFirst({ where: { id: chapterId, policyId } });
    if (!chapter) throw new NotFoundException('Chapter not found');
    return chapter;
  }

  async createSection(
    tenantId: string,
    policyId: string,
    chapterId: string,
    dto: CreateSectionDto,
    userId: string,
  ) {
    await this.findChapterOrThrow(tenantId, policyId, chapterId);
    const title = String(dto.title ?? '').trim();
    if (!title) throw new BadRequestException('절 제목을 입력하세요.');
    const section = await this.prisma.section.create({
      data: { chapterId, number: dto.number, title },
    });
    await this.audit.log({
      tenantId,
      userId,
      action: 'section.create',
      entityType: 'Section',
      entityId: section.id,
      details: { policyId, chapterId },
    });
    return section;
  }

  async updateSection(
    tenantId: string,
    policyId: string,
    chapterId: string,
    sectionId: string,
    dto: UpdateSectionDto,
  ) {
    await this.findChapterOrThrow(tenantId, policyId, chapterId);
    const section = await this.prisma.section.findFirst({ where: { id: sectionId, chapterId } });
    if (!section) throw new NotFoundException('Section not found');
    const data: { number?: number; title?: string } = {};
    if (dto.number !== undefined) data.number = dto.number;
    if (dto.title !== undefined) {
      const title = String(dto.title).trim();
      if (!title) throw new BadRequestException('절 제목을 입력하세요.');
      data.title = title;
    }
    return this.prisma.section.update({ where: { id: sectionId }, data });
  }

  async removeSection(tenantId: string, policyId: string, chapterId: string, sectionId: string) {
    await this.findChapterOrThrow(tenantId, policyId, chapterId);
    const section = await this.prisma.section.findFirst({ where: { id: sectionId, chapterId } });
    if (!section) throw new NotFoundException('Section not found');
    // onDelete: SetNull 로 소속 조문의 sectionId만 해제된다(조문은 보존)
    await this.prisma.section.delete({ where: { id: sectionId } });
  }

  async createArticle(
    tenantId: string,
    policyId: string,
    chapterId: string,
    dto: CreateArticleDto,
  ) {
    await this.findChapterOrThrow(tenantId, policyId, chapterId);
    const sectionId = await this.resolveSectionId(chapterId, dto.sectionId);

    const article = await this.prisma.article.create({
      data: {
        chapterId,
        sectionId,
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
    // 장이 이 규정 소속인지까지 확인한다. 규정만 보면 남의 장·조문을 고칠 수 있다(T-41).
    await this.findChapterOrThrow(tenantId, policyId, chapterId);
    const article = await this.prisma.article.findFirst({
      where: { id: articleId, chapterId },
    });
    if (!article) throw new NotFoundException('Article not found');
    const data: Record<string, unknown> = { ...dto };
    // 절 이동: 같은 장의 절인지 검증. null이면 절에서 분리
    if (dto.sectionId !== undefined) {
      data.sectionId = await this.resolveSectionId(chapterId, dto.sectionId);
    }
    for (const key of ['relatedPrecedentNote', 'relatedLawNote', 'relatedRuleNote'] as const) {
      if (data[key] !== undefined) {
        const t = String(data[key] ?? '').trim();
        data[key] = t.length ? t : null;
      }
    }
    return this.prisma.article.update({ where: { id: articleId }, data: data as any });
  }

  async removeArticle(tenantId: string, policyId: string, chapterId: string, articleId: string) {
    await this.findChapterOrThrow(tenantId, policyId, chapterId);
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

  // --- 제정·개정 이유(개정문) ---

  async listRevisionReasons(tenantId: string, policyId: string) {
    await this.assertPolicyInTenant(tenantId, policyId);
    return this.prisma.policyRevisionReason.findMany({
      where: { policyId },
      orderBy: [{ effectiveDate: 'desc' }, { createdAt: 'desc' }],
    });
  }

  async createRevisionReason(
    tenantId: string,
    policyId: string,
    dto: CreateRevisionReasonDto,
    userId: string,
  ) {
    await this.assertPolicyInTenant(tenantId, policyId);
    const created = await this.prisma.policyRevisionReason.create({
      data: {
        policyId,
        kind: dto.kind ?? 'amendment',
        label: dto.label.trim(),
        reason: dto.reason ?? '',
        summary: dto.summary ?? null,
        promulgatedDate: coerceNullableDate(dto.promulgatedDate),
        effectiveDate: coerceNullableDate(dto.effectiveDate),
        createdBy: userId,
      },
    });
    await this.audit.log({
      tenantId,
      userId,
      action: 'policy.revision_reason.create',
      entityType: 'PolicyRevisionReason',
      entityId: created.id,
      details: { policyId, kind: created.kind, label: created.label },
    });
    return created;
  }

  async updateRevisionReason(
    tenantId: string,
    policyId: string,
    reasonId: string,
    dto: UpdateRevisionReasonDto,
    userId: string,
  ) {
    await this.assertPolicyInTenant(tenantId, policyId);
    const row = await this.prisma.policyRevisionReason.findFirst({
      where: { id: reasonId, policyId },
    });
    if (!row) throw new NotFoundException('Revision reason not found');

    const data: Record<string, unknown> = {};
    if (dto.kind !== undefined) data.kind = dto.kind;
    if (dto.label !== undefined) data.label = dto.label.trim();
    if (dto.reason !== undefined) data.reason = dto.reason;
    if (dto.summary !== undefined) data.summary = dto.summary || null;
    if (dto.promulgatedDate !== undefined) data.promulgatedDate = coerceNullableDate(dto.promulgatedDate);
    if (dto.effectiveDate !== undefined) data.effectiveDate = coerceNullableDate(dto.effectiveDate);

    const updated = await this.prisma.policyRevisionReason.update({
      where: { id: reasonId },
      data: data as any,
    });
    await this.audit.log({
      tenantId,
      userId,
      action: 'policy.revision_reason.update',
      entityType: 'PolicyRevisionReason',
      entityId: reasonId,
      details: { policyId, fields: Object.keys(data) },
    });
    return updated;
  }

  async removeRevisionReason(tenantId: string, policyId: string, reasonId: string, userId: string) {
    await this.assertPolicyInTenant(tenantId, policyId);
    const row = await this.prisma.policyRevisionReason.findFirst({
      where: { id: reasonId, policyId },
    });
    if (!row) throw new NotFoundException('Revision reason not found');
    await this.prisma.policyRevisionReason.delete({ where: { id: reasonId } });
    await this.audit.log({
      tenantId,
      userId,
      action: 'policy.revision_reason.delete',
      entityType: 'PolicyRevisionReason',
      entityId: reasonId,
      details: { policyId },
    });
  }

  /** 테넌트 경계 확인만 하는 가벼운 검사 (본문 전체를 끌어오는 findOne 대신) */
  private async assertPolicyInTenant(tenantId: string, policyId: string) {
    const policy = await this.prisma.policy.findFirst({
      where: { id: policyId, tenantId },
      select: { id: true },
    });
    if (!policy) throw new NotFoundException('Policy not found');
    return policy;
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
