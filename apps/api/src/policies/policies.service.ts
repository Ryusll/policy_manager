import {
  Injectable,
  NotFoundException,
  ConflictException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import { AS_OF_VERSION_ORDER, asOfState, asOfVersionWhere } from '../common/as-of';
import { AuditService } from '../audit/audit.service';
import { VariablesService } from '../variables/variables.service';
import { maxPoliciesForPlan } from '../common/plan-limits';
import { buildPolicyForest } from './policy-hierarchy';
import {
  applyChapterHeaderPatch,
  newChapterHeader,
  ChapterHeaderError,
  type ChapterHeaderState,
} from './chapter-header';
import {
  ReorderPlanError,
  buildReorderPlan,
  currentJoOrder,
  type ReorderTarget,
} from './article-reorder';
import { coerceNullableDate, parseDateOnly, toDateOnlyString } from '../common/date-only';
import {
  buildComparisonRows,
  buildCrossPolicyRows,
  type CompareArticleInput,
} from './policy-compare';
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
import { ARTICLE_ORDER } from '../common/article-label';

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

  /**
   * @param opts.includePending 편집 권한자에게만 켠다. 시행본이 없는 조문에 최신 초안을
   *   `pendingVersion`으로 붙여, 넣은 내용이 "시행 전 초안"으로라도 보이게 한다.
   *   열람자에게 시행되지 않은 문구를 보여 주면 안 된다.
   */
  async findOne(tenantId: string, id: string, opts: { includePending?: boolean } = {}) {
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
                // 목차의 "의견 있음" 점 — 처리 안 된 의견이 있을 때만 찍는다
                _count: { select: { comments: { where: { isResolved: false } } } },
              },
              orderBy: ARTICLE_ORDER,
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
    if (!opts.includePending) return policy;

    const ids = policy.chapters.flatMap((c) => c.articles.map((a) => a.id));
    const pending = ids.length
      ? await this.prisma.articleVersion.findMany({
          where: { articleId: { in: ids }, status: { in: ['draft', 'review'] } },
          orderBy: [{ articleId: 'asc' }, { versionNum: 'desc' }],
          select: { id: true, articleId: true, versionNum: true, status: true, content: true, updatedAt: true },
        })
      : [];
    const latest = new Map<string, (typeof pending)[number]>();
    for (const v of pending) if (!latest.has(v.articleId)) latest.set(v.articleId, v);
    return {
      ...policy,
      chapters: policy.chapters.map((c) => ({
        ...c,
        articles: c.articles.map((a) => ({ ...a, pendingVersion: latest.get(a.id) ?? null })),
      })),
    };
  }

  /**
   * 시점(as-of) 조회 — 기준일에 시행 중이던 본문을 재구성한다.
   *
   * 조문별로 "시행일이 기준일 이하인 시행분 중 가장 나중" 버전을 고른다.
   * 기준일에 아직 시행되지 않은 조는 결과에서 제외한다(그날 존재하지 않던 조문).
   * 고른 버전이 그날 폐지돼 있으면 그 조문도 뺀다 — 옛 버전으로 되살리지 않고, 폐지일과 함께 따로 알린다(T-126).
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
                  // 시행 이력이 있는 버전만 후보(초안·검토중 제외) — 규칙은 common/as-of.ts
                  where: asOfVersionWhere(asOfDate),
                  orderBy: AS_OF_VERSION_ORDER,
                  take: 1,
                },
              },
              orderBy: ARTICLE_ORDER,
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
    const repealedArticles: Array<{
      id: string;
      number: number;
      branchNumber: number | null;
      clauseNumber: number | null;
      itemNumber: number | null;
      title: string | null;
      repealedOn: string;
    }> = [];
    const chapters = policy.chapters.map((chapter) => {
      const articles = chapter.articles.filter((article) => {
        const state = asOfState(article.versions[0], asOfDate);
        if (state === 'in_force') return true;
        if (state === 'repealed') {
          repealedArticles.push({
            id: article.id,
            number: article.number,
            branchNumber: article.branchNumber,
            clauseNumber: article.clauseNumber,
            itemNumber: article.itemNumber,
            title: article.title,
            repealedOn: toDateOnlyString(article.versions[0].repealedOn!),
          });
        } else {
          omittedArticles += 1;
        }
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
        /** 그날 폐지돼 있어 뺀 조문(T-126) — "그 시점에 없던 조문"과 따로 알린다 */
        repealedArticles,
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
   * 규정 간 비교 (T-91). 서로 다른 두 규정을 나란히 놓는다.
   *
   * `compareAsOf` 는 같은 규정의 두 시점이라 `articleId` 로 짝을 짓지만, 여기는
   * 공유하는 id 가 없어 위치(조·항·목 번호)로 맞댄다. 그 한계는
   * `buildCrossPolicyRows` 주석과 응답의 `summary.suspect` 에 드러난다.
   *
   * **두 규정 모두 테넌트 소속인지 각각 확인한다.** 기준 규정만 보고 대상 id 를
   * 그대로 쓰면 남의 회사 규정 본문이 비교표에 실려 나간다.
   */
  async compareWithPolicy(tenantId: string, id: string, targetId: string) {
    if (id === targetId) {
      throw new BadRequestException('같은 규정끼리는 비교할 수 없습니다.');
    }
    const [left, right] = await Promise.all([
      this.prisma.policy.findFirst({
        where: { id, tenantId },
        select: { id: true, code: true, title: true },
      }),
      this.prisma.policy.findFirst({
        where: { id: targetId, tenantId },
        select: { id: true, code: true, title: true },
      }),
    ]);
    if (!left || !right) throw new NotFoundException('Policy not found');

    const [leftRows, rightRows] = await Promise.all([
      this.articlesCurrent(left.id),
      this.articlesCurrent(right.id),
    ]);

    const { rows, summary } = buildCrossPolicyRows(leftRows, rightRows);
    return { left, right, summary, rows };
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
      orderBy: ARTICLE_ORDER,
    });
    return articles.map((a) => ({
      id: a.id,
      number: a.number,
      branchNumber: a.branchNumber,
      clauseNumber: a.clauseNumber,
      itemNumber: a.itemNumber,
      title: a.title || '',
      content: a.versions[0]?.content || '',
    }));
  }

  /** 특정 시점에 시행 중이던 조문을 비교용 평탄 목록으로 */
  /**
   * 규정의 "지금 본문" (T-91).
   *
   * `articlesAsOf` 와 다르다. 그쪽은 **시행일 기준 스냅샷**이라 시행일이 없거나
   * 아직 오지 않은 게시본을 빼는데, 전문 보기(`findOne`)는 시행일과 무관하게
   * **최신 게시본**을 보여 준다. 규정 간 비교가 `asOf` 를 쓰면 화면에는 있는
   * 조문이 비교표에서 사라져 "왜 다르냐"는 질문이 생긴다. 화면과 같은 기준을 쓴다.
   */
  private async articlesCurrent(policyId: string): Promise<CompareArticleInput[]> {
    const articles = await this.prisma.article.findMany({
      where: { chapter: { policyId } },
      include: {
        versions: {
          where: { status: 'published' },
          orderBy: { versionNum: 'desc' },
          take: 1,
        },
      },
      orderBy: ARTICLE_ORDER,
    });

    return articles
      .filter((article) => article.versions.length > 0)
      .map((article) => ({
        id: article.id,
        number: article.number,
        branchNumber: article.branchNumber,
        clauseNumber: article.clauseNumber,
        itemNumber: article.itemNumber,
        title: article.title ?? '',
        content: article.versions[0].content ?? '',
        effectiveDate: article.versions[0].effectiveDate
          ? toDateOnlyString(article.versions[0].effectiveDate)
          : null,
      }));
  }

  private async articlesAsOf(policyId: string, asOfDate: Date): Promise<CompareArticleInput[]> {
    const articles = await this.prisma.article.findMany({
      where: { chapter: { policyId } },
      include: {
        versions: {
          where: asOfVersionWhere(asOfDate),
          orderBy: AS_OF_VERSION_ORDER,
          take: 1,
        },
      },
      orderBy: ARTICLE_ORDER,
    });

    return articles
      .filter((article) => asOfState(article.versions[0], asOfDate) === 'in_force')
      .map((article) => {
        const version = article.versions[0];
        return {
          id: article.id,
          number: article.number,
          branchNumber: article.branchNumber,
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

  /** 시점 조회 슬라이더용: 이 규정에서 실제로 본문이 바뀐 날짜들 — 조문이 폐지돼 빠진 날도 넣는다(T-126) */
  async listEffectiveDates(tenantId: string, id: string) {
    const policy = await this.prisma.policy.findFirst({ where: { id, tenantId }, select: { id: true } });
    if (!policy) throw new NotFoundException('Policy not found');

    const [rows, repeals] = await Promise.all([
      this.prisma.articleVersion.findMany({
        where: {
          status: { in: ['published', 'archived'] },
          effectiveDate: { not: null },
          article: { chapter: { policyId: id } },
        },
        select: { effectiveDate: true },
        distinct: ['effectiveDate'],
      }),
      this.prisma.articleVersion.findMany({
        where: { repealedOn: { not: null }, article: { chapter: { policyId: id } } },
        select: { repealedOn: true },
        distinct: ['repealedOn'],
      }),
    ]);
    const days = new Set<string>();
    for (const r of rows) if (r.effectiveDate) days.add(toDateOnlyString(r.effectiveDate));
    for (const r of repeals) if (r.repealedOn) days.add(toDateOnlyString(r.repealedOn));
    return [...days].sort().reverse();
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
    const header = this.chapterHeader(() => newChapterHeader(dto));
    const ch = await this.prisma.chapter.create({
      data: { policyId, number: dto.number, ...header },
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
    // 생성에는 있고 수정에는 없던 검사다(T-84). 없으면 "제목 없는 보이는 장"을
    // 만들 수 있고, 그 장은 화면·인쇄에 제목 없는 빈 머리글로 나온다.
    const header = this.chapterHeader(() =>
      applyChapterHeaderPatch(
        { title: chapter.title, suppressHeader: chapter.suppressHeader },
        dto,
      ),
    );
    return this.prisma.chapter.update({
      where: { id: chapterId },
      data: { ...dto, ...header },
    });
  }

  /** 불변식 위반을 400 으로 바꾼다(규칙 자체는 DB 없이 검사할 수 있게 밖에 둔다) */
  private chapterHeader(run: () => ChapterHeaderState): ChapterHeaderState {
    try {
      return run();
    } catch (e) {
      if (e instanceof ChapterHeaderError) throw new BadRequestException(e.message);
      throw e;
    }
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
        branchNumber: dto.branchNumber ?? null,
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

  /**
   * 조 순서 일괄 재정렬 (T-60).
   *
   * 가져온 규정은 조 순서가 원문과 어긋나거나 장이 잘못 잡히는 일이 잦다. 조를 하나씩
   * 고치던 것을 목차에서 끌어 놓고 한 번에 다시 매긴다. 조 번호는 장을 가로질러
   * 이어지므로(제1장 제1·2조 → 제2장 제3조) 하나만 옮겨도 뒤가 전부 밀린다.
   *
   * 한 트랜잭션으로 처리한다. 중간에 끊기면 조 번호가 겹치거나 비는 상태가 남는데,
   * 그건 목차·안정 링크(T-73)·인쇄가 동시에 무너진 상태다.
   */
  async reorderArticles(
    tenantId: string,
    policyId: string,
    order: ReorderTarget[],
    userId: string,
  ) {
    await this.findOne(tenantId, policyId);
    const chapters = await this.prisma.chapter.findMany({
      where: { policyId },
      select: { id: true },
    });
    const rows = await this.prisma.article.findMany({
      where: { chapter: { policyId } },
      select: { id: true, chapterId: true, sectionId: true, number: true, branchNumber: true },
    });

    let changes;
    try {
      changes = buildReorderPlan(rows, order, chapters.map((c) => c.id));
    } catch (e) {
      if (e instanceof ReorderPlanError) throw new BadRequestException(e.message);
      throw e;
    }

    if (changes.length === 0) return { changed: 0 };

    await this.prisma.$transaction(
      changes.map((c) =>
        this.prisma.article.update({
          where: { id: c.id },
          data: { number: c.number, branchNumber: c.branchNumber, chapterId: c.chapterId, sectionId: c.sectionId },
        }),
      ),
    );

    await this.audit.log({
      tenantId,
      userId,
      action: 'policy.articles.reorder',
      entityType: 'Policy',
      entityId: policyId,
      details: { changed: changes.length, order: order.map((t) => (t.branch ? `${t.jo}의${t.branch}` : t.jo)) },
    });

    return { changed: changes.length };
  }

  /** 재정렬 화면이 시작점으로 쓸 현재 순서 */
  async listJoOrder(tenantId: string, policyId: string) {
    await this.findOne(tenantId, policyId);
    const chapters = await this.prisma.chapter.findMany({
      where: { policyId },
      select: { id: true, number: true, title: true, articles: { select: { number: true, branchNumber: true } } },
      orderBy: { number: 'asc' },
    });
    return { order: currentJoOrder(chapters) };
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
