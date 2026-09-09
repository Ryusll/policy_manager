import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import { CreateVersionDto, UpdateVersionDto } from './versions.dto';
import { VariablesService } from '../variables/variables.service';
import { AuditService } from '../audit/audit.service';
import { RevisionNotifyService } from '../notifications/revision-notify.service';
import { coerceNullableDate, todayDateOnly } from '../common/date-only';
import * as Diff from 'diff';

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
      const articleLabel = `제${article.number}조${article.title ? ` (${article.title})` : ''}`;
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
   * 반려 — 검토 중인 버전을 초안으로 되돌린다 (T-10).
   *
   * 사유를 함께 받는다. 사유 없이 되돌리면 편집자는 **왜 반려됐는지 알 수 없는 초안**을
   * 받게 되고, 같은 내용을 다시 올리기 쉽다. 감사 로그는 관리자만 볼 수 있어서
   * 거기 적어 두는 것만으로는 편집자에게 닿지 않는다 — 버전 자체에 남긴다.
   */
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
