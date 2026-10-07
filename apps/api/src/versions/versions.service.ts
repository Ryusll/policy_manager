import { Injectable, NotFoundException, BadRequestException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import { CreateVersionDto, UpdateVersionDto } from './versions.dto';
import { VariablesService } from '../variables/variables.service';
import { AuditService } from '../audit/audit.service';
import { RevisionNotifyService } from '../notifications/revision-notify.service';
import { coerceNullableDate, parseDateOnly, todayDateOnly } from '../common/date-only';
import { planEffectiveDateFill } from './effective-date-fill';
import * as Diff from 'diff';
import { ARTICLE_ORDER, formatJo } from '../common/article-label';

@Injectable()
export class VersionsService {
  constructor(
    private prisma: PrismaService,
    private variablesService: VariablesService,
    private audit: AuditService,
    private revisionNotify: RevisionNotifyService,
  ) {}

  async findByArticle(tenantId: string, articleId: string) {
    const article = await this.prisma.article.findFirst({
      where: {
        id: articleId,
        chapter: { policy: { tenantId } },
      },
    });
    if (!article) throw new NotFoundException('Article not found');

    return this.prisma.articleVersion.findMany({
      where: { articleId },
      orderBy: { versionNum: 'desc' },
    });
  }

  async findOne(tenantId: string, versionId: string) {
    const version = await this.prisma.articleVersion.findFirst({
      where: {
        id: versionId,
        article: { chapter: { policy: { tenantId } } },
      },
      include: {
        article: { include: { chapter: { include: { policy: true } } } },
        variableUsages: { include: { variable: true } },
      },
    });
    if (!version) throw new NotFoundException('Version not found');
    return version;
  }

  async create(tenantId: string, articleId: string, dto: CreateVersionDto, userId: string) {
    const article = await this.prisma.article.findFirst({
      where: { id: articleId, chapter: { policy: { tenantId } } },
    });
    if (!article) throw new NotFoundException('Article not found');

    const last = await this.prisma.articleVersion.findFirst({
      where: { articleId },
      orderBy: { versionNum: 'desc' },
    });
    const nextNum = last ? last.versionNum + 1 : 1;

    const created = await this.prisma.articleVersion.create({
      data: {
        articleId,
        versionNum: nextNum,
        content: dto.content,
        changeNote: dto.changeNote,
        status: 'draft',
        createdBy: userId,
      },
    });

    await this.variablesService.syncVariableUsagesFromContent(tenantId, created.id, created.content);
    await this.audit.log({
      tenantId,
      userId,
      action: 'version.create',
      entityType: 'ArticleVersion',
      entityId: created.id,
      details: { articleId, versionNum: created.versionNum },
    });

    return created;
  }

  async update(tenantId: string, versionId: string, dto: UpdateVersionDto, userId: string) {
    const version = await this.findOne(tenantId, versionId);
    if (version.status !== 'draft') {
      throw new BadRequestException('Only draft versions can be edited');
    }
    const updated = await this.prisma.articleVersion.update({
      where: { id: versionId },
      data: dto,
    });
    if (dto.content !== undefined) {
      await this.variablesService.syncVariableUsagesFromContent(tenantId, versionId, updated.content);
    }
    await this.audit.log({
      tenantId,
      userId,
      action: 'version.update',
      entityType: 'ArticleVersion',
      entityId: versionId,
      details: { fields: Object.keys(dto) },
    });
    return updated;
  }

  async submitForReview(tenantId: string, versionId: string, userId: string) {
    const version = await this.findOne(tenantId, versionId);
    if (version.status !== 'draft') {
      throw new BadRequestException('Only draft versions can be submitted for review');
    }
    const row = await this.prisma.articleVersion.update({
      where: { id: versionId },
      // 이전 반려 사유는 지운다. 남겨 두면 다시 올린 뒤에도 반려 상태처럼 보인다.
      data: { status: 'review', reviewNote: null },
    });
    await this.audit.log({
      tenantId,
      userId,
      action: 'version.submit_review',
      entityType: 'ArticleVersion',
      entityId: versionId,
    });
    return row;
  }

  async approve(
    tenantId: string,
    versionId: string,
    userId: string,
    changeNote: string,
    effectiveDate?: string,
  ) {
    const reason = changeNote?.trim();
    if (!reason) {
      throw new BadRequestException('시행 승인 시 개정 사유(changeNote)가 필요합니다.');
    }

    // 시행일은 시점 조회(as-of)의 기준이라 승인 시점에 반드시 확정한다. 미지정이면 승인일.
    // DTO가 ISO 날짜시간도 허용하므로 날짜 부분만 취한다(coerceNullableDate).
    const effective = effectiveDate ? coerceNullableDate(effectiveDate) : todayDateOnly();
    if (!effective) {
      throw new BadRequestException('시행일은 YYYY-MM-DD 형식이어야 합니다.');
    }

    const version = await this.findOne(tenantId, versionId);
    if (version.status !== 'review') {
      throw new BadRequestException('Only versions in review can be approved');
    }

    const result = await this.prisma.$transaction(async (tx) => {
      await tx.articleVersion.updateMany({
        where: { articleId: version.articleId, status: 'published' },
        data: { status: 'archived' },
      });

      return tx.articleVersion.update({
        where: { id: versionId },
        data: {
          status: 'published',
          approvedBy: userId,
          approvedAt: new Date(),
          effectiveDate: effective,
          changeNote: reason,
        },
      });
    });

    await this.audit.log({
      tenantId,
      userId,
      action: 'version.approve',
      entityType: 'ArticleVersion',
      entityId: versionId,
      details: { articleId: version.articleId, changeNote: reason },
    });

    const policy = version.article?.chapter?.policy;
    const article = version.article;
    if (policy && article) {
      const articleLabel = `${formatJo(article.number, article.branchNumber)}${article.title ? ` (${article.title})` : ''}`;
      const notifyResult = await this.revisionNotify.dispatchPolicyRevisionApproved({
        tenantId,
        policyId: policy.id,
        policyTitle: policy.title,
        policyCode: policy.code,
        articleId: article.id,
        articleLabel,
        versionId,
        changeNote: reason,
        approvedByUserId: userId,
        metadata: policy.metadata,
      });
      if (notifyResult.sent > 0) {
        await this.audit.log({
          tenantId,
          userId,
          action: 'revision.notify_sent',
          entityType: 'Policy',
          entityId: policy.id,
          details: {
            articleId: article.id,
            versionId,
            recipientCount: notifyResult.sent,
          },
        });
      }
    }

    return result;
  }

  /**
   * 시행된 적 없는 조문의 초안을 한꺼번에 시행한다.
   *
   * 조·항을 손으로 추가하면 내용이 초안으로만 저장되고 전문 보기에는 시행본만 나온다.
   * 기존 규정을 옮겨 적는 사람은 "넣었는데 안 보인다"고 느끼고, 보이게 하려면 항마다
   * 검토 요청·승인을 되풀이해야 했다. PDF 가져오기는 등록하면서 바로 시행하므로 경로마다
   * 결과도 달랐다.
   *
   * 이미 시행본이 있는 조문의 개정 초안은 건드리지 않는다 — 그건 개정이고, 하나씩 검토하는
   * 원래 절차를 탄다. 승인 권한(관리자)과 사유·시행일·감사 기록은 단건 승인과 같다.
   * 알림은 조문 수만큼 보내지 않고 한 번만 보낸다.
   */
  async publishInitialDrafts(
    tenantId: string,
    policyId: string,
    userId: string,
    changeNote: string,
    effectiveDate?: string,
  ) {
    const reason = changeNote?.trim();
    if (!reason) throw new BadRequestException('시행 사유를 입력하세요.');
    const effective = effectiveDate ? coerceNullableDate(effectiveDate) : todayDateOnly();
    if (!effective) throw new BadRequestException('시행일은 YYYY-MM-DD 형식이어야 합니다.');

    const policy = await this.prisma.policy.findFirst({
      where: { id: policyId, tenantId },
      select: { id: true, title: true, code: true, metadata: true },
    });
    if (!policy) throw new NotFoundException('Policy not found');

    const articles = await this.prisma.article.findMany({
      where: {
        chapter: { policyId },
        versions: { none: { status: 'published' } },
      },
      select: {
        id: true,
        number: true,
        branchNumber: true,
        title: true,
        clauseNumber: true,
        itemNumber: true,
        versions: {
          where: { status: { in: ['draft', 'review'] } },
          orderBy: { versionNum: 'desc' },
          take: 1,
          select: { id: true },
        },
      },
      orderBy: ARTICLE_ORDER,
    });
    const targets = articles.filter((a) => a.versions.length > 0);
    if (!targets.length) return { published: 0 };

    const approvedAt = new Date();
    await this.prisma.$transaction(
      targets.map((a) =>
        this.prisma.articleVersion.update({
          where: { id: a.versions[0].id },
          data: { status: 'published', approvedBy: userId, approvedAt, effectiveDate: effective, changeNote: reason },
        }),
      ),
    );

    await this.audit.log({
      tenantId,
      userId,
      action: 'version.bulk_publish',
      entityType: 'Policy',
      entityId: policyId,
      details: { count: targets.length, changeNote: reason, articleIds: targets.slice(0, 200).map((a) => a.id) },
    });

    const first = targets[0];
    const firstLabel = `${formatJo(first.number, first.branchNumber)}${first.title ? ` (${first.title})` : ''}`;
    const notifyResult = await this.revisionNotify.dispatchPolicyRevisionApproved({
      tenantId,
      policyId,
      policyTitle: policy.title,
      policyCode: policy.code,
      articleId: first.id,
      articleLabel: targets.length > 1 ? `${firstLabel} 외 ${targets.length - 1}건` : firstLabel,
      versionId: first.versions[0].id,
      changeNote: reason,
      approvedByUserId: userId,
      metadata: policy.metadata,
    });
    if (notifyResult.sent > 0) {
      await this.audit.log({
        tenantId,
        userId,
        action: 'revision.notify_sent',
        entityType: 'Policy',
        entityId: policyId,
        details: { bulk: true, count: targets.length, recipientCount: notifyResult.sent },
      });
    }

    return { published: targets.length };
  }

  /**
   * 반려 — 검토 중인 버전을 초안으로 되돌린다 (T-10).
   *
   * 사유를 함께 받는다. 사유 없이 되돌리면 편집자는 **왜 반려됐는지 알 수 없는 초안**을
   * 받게 되고, 같은 내용을 다시 올리기 쉽다. 감사 로그는 관리자만 볼 수 있어서
   * 거기 적어 두는 것만으로는 편집자에게 닿지 않는다 — 버전 자체에 남긴다.
   */
  /**
   * 시행일 없이 발행된 버전에 관리자가 확인한 시행일을 넣는다 (PAT-02).
   *
   * 예전 가져오기 경로가 남긴 데이터 보정용이다. 날짜는 지어내지 않는다 — 승인일·생성일은
   * 실제 시행일이 아니라서, 그걸로 채우면 과거 시점 조회가 틀린 본문을 보여 준다.
   * 같은 조문의 다른 시행본과 순서가 어긋나면 하나도 바꾸지 않고 거부한다(effective-date-fill.ts).
   */
  async fillMissingEffectiveDates(
    tenantId: string,
    policyId: string,
    userId: string,
    effectiveDate: string,
    reason: string,
  ) {
    const note = reason?.trim();
    if (!note) throw new BadRequestException('보정 근거를 입력하세요.');
    const date = parseDateOnly(effectiveDate);
    if (!date) throw new BadRequestException('시행일은 YYYY-MM-DD 형식이어야 합니다.');

    const policy = await this.prisma.policy.findFirst({
      where: { id: policyId, tenantId },
      select: { id: true, effectiveDate: true },
    });
    if (!policy) throw new NotFoundException('Policy not found');

    const versions = await this.prisma.articleVersion.findMany({
      where: { article: { chapter: { policyId } }, status: { in: ['published', 'archived'] } },
      select: {
        id: true,
        articleId: true,
        versionNum: true,
        effectiveDate: true,
        article: { select: { number: true, branchNumber: true, clauseNumber: true, itemNumber: true } },
      },
    });
    const plan = planEffectiveDateFill(versions, date);
    if (plan.conflicts.length) {
      const labelOf = new Map(
        versions.map((v) => {
          const a = v.article;
          const tail = `${a.clauseNumber ? ` 제${a.clauseNumber}항` : ''}${a.itemNumber ? ` 제${a.itemNumber}목` : ''}`;
          return [v.articleId, `${formatJo(a.number, a.branchNumber)}${tail}`];
        }),
      );
      const why = (c: (typeof plan.conflicts)[number]) =>
        c.reason === 'multiple-missing'
          ? '시행일 없는 시행본이 둘 이상'
          : c.reason === 'after-later-version'
            ? `다음 버전 시행일(${c.boundary})보다 늦음`
            : `앞 버전 시행일(${c.boundary})보다 이름`;
      throw new ConflictException({
        message: `시행일을 일괄로 넣을 수 없는 조문이 ${plan.conflicts.length}건 있습니다. 아무것도 바꾸지 않았습니다.`,
        conflicts: plan.conflicts.map((c) => ({ ...c, label: labelOf.get(c.articleId) ?? c.articleId, detail: why(c) })),
      });
    }
    if (!plan.updateIds.length) {
      throw new BadRequestException('시행일이 비어 있는 시행본이 없습니다.');
    }

    await this.prisma.$transaction([
      this.prisma.articleVersion.updateMany({
        where: { id: { in: plan.updateIds }, effectiveDate: null },
        data: { effectiveDate: date },
      }),
      ...(policy.effectiveDate
        ? []
        : [this.prisma.policy.update({ where: { id: policyId }, data: { effectiveDate: date } })]),
    ]);

    await this.audit.log({
      tenantId,
      userId,
      action: 'version.effective_date_fill',
      entityType: 'Policy',
      entityId: policyId,
      details: {
        count: plan.updateIds.length,
        effectiveDate,
        reason: note,
        versionIds: plan.updateIds.slice(0, 200),
      },
    });
    return { updated: plan.updateIds.length };
  }

  async reject(tenantId: string, versionId: string, userId: string, reason?: string) {
    const version = await this.findOne(tenantId, versionId);
    if (version.status !== 'review') {
      throw new BadRequestException('Only versions in review can be rejected');
    }
    const note = String(reason ?? '').trim();
    if (!note) throw new BadRequestException('반려 사유를 입력하세요.');

    const row = await this.prisma.articleVersion.update({
      where: { id: versionId },
      data: { status: 'draft', reviewNote: note.slice(0, 2000) },
    });
    await this.audit.log({
      tenantId,
      userId,
      action: 'version.reject',
      entityType: 'ArticleVersion',
      entityId: versionId,
      details: { reason: note.slice(0, 2000) },
    });
    return row;
  }

  /**
   * 폐지 — 게시된 버전을 archived 로 내린다 (T-10).
   *
   * 이 조문의 마지막 게시본이면 조문이 **전문 보기·인쇄에서 본문 없이 남는다**.
   * 정당한 폐지도 있으므로 막지는 않고, 그렇게 됐는지를 응답으로 알려 화면이 말하게 한다.
   */
  async archive(tenantId: string, versionId: string, userId: string) {
    const version = await this.findOne(tenantId, versionId);
    if (version.status !== 'published') {
      throw new BadRequestException('Only published versions can be archived');
    }
    const row = await this.prisma.articleVersion.update({
      where: { id: versionId },
      data: { status: 'archived' },
    });
    const remainingPublished = await this.prisma.articleVersion.count({
      where: { articleId: version.articleId, status: 'published' },
    });
    await this.audit.log({
      tenantId,
      userId,
      action: 'version.archive',
      entityType: 'ArticleVersion',
      entityId: versionId,
      details: { articleId: version.articleId, remainingPublished },
    });
    return { ...row, remainingPublished };
  }

  async diff(tenantId: string, versionId1: string, versionId2: string) {
    const v1 = await this.findOne(tenantId, versionId1);
    const v2 = await this.findOne(tenantId, versionId2);
    const changes = Diff.diffWords(v1.content, v2.content);
    return { changes, v1, v2 };
  }
}
