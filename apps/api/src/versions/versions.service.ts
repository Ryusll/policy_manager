import { Prisma } from '@prisma/client';
import { Injectable, NotFoundException, BadRequestException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import { CreateVersionDto, UpdateVersionDto } from './versions.dto';
import { VariablesService } from '../variables/variables.service';
import { AuditService } from '../audit/audit.service';
import { RevisionNotifyService } from '../notifications/revision-notify.service';
import { coerceNullableDate, parseDateOnly, toDateOnlyString, todayDateOnly } from '../common/date-only';
import { AS_OF_VERSION_ORDER, asOfVersionWhere } from '../common/as-of';
import { planEffectiveDateFill } from './effective-date-fill';
import * as Diff from 'diff';
import { ARTICLE_ORDER, formatJo } from '../common/article-label';
import { VERSION_LAW_CHANGE, withLawChange } from './version-law-change';
import { LONG_LOCK_WAIT_MS, lockArticleRow, lockArticleRows, lockPolicyRow, lockPolicyWithArticles } from '../common/row-locks';

/** 재파싱 묶음의 버전은 묶음으로만 검토 요청·승인·반려한다(T-110 ②) — 하나씩 처리하면 같은 시행일·계층 확인을 건너뛴다 */
function assertNotBundle(version: { reparseItemId?: string | null }) {
  if (version.reparseItemId) {
    throw new ConflictException('재파싱 묶음의 버전입니다 — 재파싱 검토 화면에서 묶음으로 검토 요청·승인·반려하세요.');
  }
}

/** 조문 행 잠금 — 승인·폐지·재파싱 묶음과 같은 잠금으로 줄 세운다(순서·세기는 `common/row-locks`, T-131) */
const lockArticle = lockArticleRow;
/** 여러 조문 — 늘 id 순으로(재파싱 묶음과 같은 순서라 서로 기다리다 멈추지 않는다) */
const lockArticles = lockArticleRows;

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

    const versions = await this.prisma.articleVersion.findMany({
      where: { articleId },
      orderBy: { versionNum: 'desc' },
      // 버전 카드의 "변수 연결 N"(T-109) — 다시 이어야 하는 것도 센다
      include: {
        _count: { select: { variableBindings: { where: { state: { in: ['active', 'needs_review'] } } } } },
        // 재파싱 묶음의 버전이면 그 검토로 이끈다(T-110 ②)
        reparseItem: { select: { reviewId: true } },
        // 날짜 3종의 법령 시행일(T-111) — 개정 후보 승인으로 발행한 버전만
        changeEvent: VERSION_LAW_CHANGE,
      },
    });
    return versions.map(withLawChange);
  }

  async findOne(tenantId: string, versionId: string) {
    const version = await this.prisma.articleVersion.findFirst({
      where: {
        id: versionId,
        article: { chapter: { policy: { tenantId } } },
      },
      include: {
        article: { include: { chapter: { include: { policy: true } } } },
        variableBindings: {
          where: { state: { in: ['active', 'needs_review'] } },
          include: { variable: { select: { id: true, key: true, label: true } } },
        },
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

    const created = await this.prisma.$transaction(async (tx) => {
      await lockArticle(tx, articleId);
      const last = await tx.articleVersion.findFirst({
        where: { articleId },
        orderBy: { versionNum: 'desc' },
      });
      return tx.articleVersion.create({
        data: {
          articleId,
          versionNum: last ? last.versionNum + 1 : 1,
          content: dto.content,
          changeNote: dto.changeNote,
          status: 'draft',
          createdBy: userId,
        },
      });
    });

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
    const updated = await this.prisma.$transaction(async (tx) => {
      await lockArticle(tx, version.articleId);
      const fresh = await tx.articleVersion.findUniqueOrThrow({ where: { id: versionId }, select: { status: true, content: true } });
      if (fresh.status !== 'draft') throw new BadRequestException('Only draft versions can be edited');
      const row = await tx.articleVersion.update({ where: { id: versionId }, data: dto });
      // 검토 요청 때 표식을 바꿔 넣은 자리(T-109) — 본문을 고치면 위치를 옮기고, 못 옮기면 "다시 이어야 함". 옛 본문은 잠근 뒤 읽은 것(T-131)
      if (dto.content !== undefined) await this.variablesService.reanchorVersion(tx, versionId, fresh.content, row.content);
      return row;
    });
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
    assertNotBundle(version);
    // 본문의 변수 표식({{KEY}})은 입력용이다 — 검토 전에 오늘(한국 날짜) 값으로 바꿔 본문에 저장하고 그 자리를 변수
    // 연결로 남긴다(T-109, 사용자 지시로 코덱스 자문). 검토자는 실제로 발행될 문구를 본다. 값을 고를 수 없으면 400
    const { row, applied } = await this.prisma.$transaction(async (tx) => {
      await lockArticle(tx, version.articleId);
      const fresh = await tx.articleVersion.findUniqueOrThrow({ where: { id: versionId }, select: { status: true, reparseItemId: true, content: true } });
      if (fresh.status !== 'draft') throw new BadRequestException('Only draft versions can be submitted for review');
      assertNotBundle(fresh);
      // 본문은 잠근 뒤 읽은 것으로(T-131) — 그 사이 고친 초안이면 고친 본문의 표식을 바꾼다
      const { content, applied } = await this.variablesService.resolveMarkers(tx, tenantId, fresh.content, todayDateOnly());
      const row = await tx.articleVersion.update({
        where: { id: versionId },
        // 이전 반려 사유는 지운다. 남겨 두면 다시 올린 뒤에도 반려 상태처럼 보인다.
        data: { status: 'review', reviewNote: null, ...(applied.length ? { content } : {}) },
      });
      if (applied.length) {
        await this.variablesService.reanchorVersion(tx, versionId, fresh.content, content);
        await this.variablesService.createMarkerBindings(tx, tenantId, { id: versionId, articleId: version.articleId, content }, applied, userId);
      }
      return { row, applied };
    });
    await this.audit.log({
      tenantId,
      userId,
      action: 'version.submit_review',
      entityType: 'ArticleVersion',
      entityId: versionId,
      ...(applied.length
        ? { details: { variables: applied.map((a) => ({ key: a.key, value: a.value, valueId: a.valueId })) } }
        : {}),
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
    assertNotBundle(version);

    const result = await this.prisma.$transaction(async (tx) => {
      // 개정 후보 승인(T-108)과 같은 조문 잠금 — 같은 조문의 발행이 겹쳐 앞선 개정을 덮어쓰지 않게 줄 세운다
      await lockArticle(tx, version.articleId);
      const fresh = await tx.articleVersion.findUniqueOrThrow({ where: { id: versionId }, select: { status: true, reparseItemId: true } });
      if (fresh.status !== 'review') throw new BadRequestException('Only versions in review can be approved');
      assertNotBundle(fresh);
      await assertAfterRepeal(tx, version.articleId, effective);
      // 변수(T-109): 표식이 남은 본문은 발행하지 않고, 검토 요청 때 넣은 값이 그 시행일에도 맞는지 다시 본다
      await this.variablesService.assertNoMarkers(tx, tenantId, [{ label: '이 버전', content: version.content }]);
      await this.variablesService.assertMarkerValuesAt(tx, versionId, effective);
      const previous = await previousIssued(tx, version.articleId, versionId);
      await tx.articleVersion.updateMany({
        where: { articleId: version.articleId, status: 'published' },
        data: { status: 'archived' },
      });

      const now = new Date();
      const row = await tx.articleVersion.update({
        where: { id: versionId },
        data: {
          status: 'published',
          approvedBy: userId,
          approvedAt: now,
          publishedAt: now,
          effectiveDate: effective,
          changeNote: reason,
        },
      });
      // 앞 시행본의 변수 연결을 새 버전으로 옮긴다(T-109)
      await this.variablesService.inheritBindings(tx, tenantId, previous, row, userId);
      return row;
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
   * 시행본이 없는 조문(새로 넣은 조문, 폐지 뒤 다시 쓴 조문)의 초안을 한꺼번에 시행한다.
   *
   * 조·항을 손으로 추가하면 내용이 초안으로만 저장되고 전문 보기에는 시행본만 나온다.
   * 기존 규정을 옮겨 적는 사람은 "넣었는데 안 보인다"고 느끼고, 보이게 하려면 항마다
   * 검토 요청·승인을 되풀이해야 했다. PDF 가져오기는 등록하면서 바로 시행하므로 경로마다
   * 결과도 달랐다.
   *
   * 이미 시행본이 있는 조문의 개정 초안은 건드리지 않는다 — 그건 개정이고, 하나씩 검토하는
   * 원래 절차를 탄다. 승인 권한(관리자)과 사유·감사 기록은 단건 승인과 같다.
   * 시행일은 단건 승인과 달리 필수다 — 여기로 오는 건 대개 옮겨 적은 기존 규정이라 "오늘"로
   * 채우면 과거 시점 조회가 틀어진다(PAT-02, 가져오기와 같은 규칙).
   * 알림은 조문 수만큼 보내지 않고 한 번만 보낸다.
   */
  async publishInitialDrafts(
    tenantId: string,
    policyId: string,
    userId: string,
    changeNote: string,
    effectiveDate: string,
  ) {
    const reason = changeNote?.trim();
    if (!reason) throw new BadRequestException('시행 사유를 입력하세요.');
    const effective = coerceNullableDate(effectiveDate);
    if (!effective) throw new BadRequestException('시행일(YYYY-MM-DD)을 입력하세요.');

    const policy = await this.prisma.policy.findFirst({
      where: { id: policyId, tenantId },
      select: { id: true, title: true, code: true, metadata: true, effectiveDate: true },
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
          // 재파싱 묶음의 초안은 묶음으로만 승인한다(T-110 ②)
          where: { status: { in: ['draft', 'review'] }, reparseItemId: null },
          orderBy: { versionNum: 'desc' },
          take: 1,
          select: { id: true, content: true },
        },
      },
      orderBy: ARTICLE_ORDER,
    });
    const targets = articles.filter((a) => a.versions.length > 0);
    if (!targets.length) return { published: 0 };
    const labelOf = (a: (typeof targets)[number]) =>
      `${formatJo(a.number, a.branchNumber)}${a.clauseNumber ? ` 제${a.clauseNumber}항` : ''}${a.itemNumber ? ` 제${a.itemNumber}목` : ''}`;

    // 변수 표식이 남은 초안은 한꺼번에 시행하지 않는다 — 검토 요청 때 그날 값으로 바뀐다(T-109)
    await this.variablesService.assertNoMarkers(
      this.prisma,
      tenantId,
      targets.map((a) => ({ label: labelOf(a), content: a.versions[0].content })),
    );

    // 폐지한 조문을 다시 쓴 초안이면 시행일이 폐지일 이후여야 한다(T-126, 단건 승인과 같다). 하나라도 어긋나면
    // 아무것도 시행하지 않는다 — 일부만 시행되면 어디까지 됐는지 다시 맞춰야 한다
    const repeals = await this.prisma.articleVersion.findMany({
      where: { articleId: { in: targets.map((a) => a.id) }, repealedOn: { gt: effective } },
      orderBy: { repealedOn: 'desc' },
      select: { articleId: true, repealedOn: true },
    });
    if (repeals.length) {
      const latest = new Map<string, Date>(); // 폐지일 내림차순이라 조문마다 처음 것이 마지막 폐지
      for (const r of repeals) if (!latest.has(r.articleId)) latest.set(r.articleId, r.repealedOn!);
      const list = [...latest].map(([articleId, day]) => `${labelOf(targets.find((t) => t.id === articleId)!)}(${toDateOnlyString(day)} 폐지)`);
      throw new BadRequestException(
        `폐지한 조문은 폐지일보다 이른 시행일로 다시 시행할 수 없습니다 — ${list.slice(0, 5).join(', ')}${list.length > 5 ? ` 외 ${list.length - 5}건` : ''}. ` +
          '시행일을 그날이나 그 뒤로 정하세요. 아무것도 시행하지 않았습니다.',
      );
    }

    const approvedAt = new Date();
    // 큰 규정(수백 조문)도 한 트랜잭션에 들어가야 한다 — 조문마다 왕복하지 않게 한 번에 읽고 한 번에 바꾼다.
    // 변수 연결을 옮길 것은 폐지 뒤 다시 쓴 조문 중 폐지한 버전에 연결이 있는 것뿐이다(T-109)
    await this.prisma.$transaction(
      async (tx) => {
        // 규정 → 조문 순서(T-131) — 첫 시행이면 끝에 규정 시행일을 채우므로 규정부터 잡는다. 조문을 먼저 잡으면 규정을 잡고
        // 조문을 기다리는 계층 쓰기·재파싱과 서로 기다리다 멈춘다
        await lockPolicyRow(tx, policyId, LONG_LOCK_WAIT_MS);
        await lockArticles(tx, targets.map((a) => a.id), LONG_LOCK_WAIT_MS);
        const draftIds = targets.map((a) => a.versions[0].id);
        // 잠근 뒤 다시 본다 — 그 사이 시행본이 생겼거나, 초안의 상태·본문이 바뀌었거나(변수 표식 검사는 잠그기 전 본문으로 했다),
        // 시행일 뒤로 폐지됐으면 아무것도 시행하지 않는다
        const contentOf = new Map(targets.map((a) => [a.versions[0].id, a.versions[0].content]));
        const drafts = await tx.articleVersion.findMany({
          where: { id: { in: draftIds }, status: { in: ['draft', 'review'] }, reparseItemId: null },
          select: { id: true, content: true },
        });
        const nowPublished = await tx.articleVersion.count({ where: { articleId: { in: targets.map((a) => a.id) }, status: 'published' } });
        const lateRepeal = await tx.articleVersion.count({ where: { articleId: { in: targets.map((a) => a.id) }, repealedOn: { gt: effective } } });
        if (drafts.length !== draftIds.length || drafts.some((d) => d.content !== contentOf.get(d.id)) || nowPublished || lateRepeal) {
          throw new ConflictException('그 사이 조문이 바뀌었습니다 — 화면을 새로 고친 뒤 다시 시행하세요.');
        }
        // 규정의 첫 시행이면 규정 단위 시행일도 같은 날로 채운다(가져오기와 같다). 이미 시행 중인 조문이 있는 규정에 새로 넣은
        // 조문이면 그 날짜는 규정 시행일이 아니므로 건드리지 않는다. 잠근 뒤, 시행하기 전에 판정한다
        const firstPublication =
          !(await tx.policy.findUniqueOrThrow({ where: { id: policyId }, select: { effectiveDate: true } })).effectiveDate &&
          (await tx.articleVersion.count({ where: { status: 'published', article: { chapter: { policyId } } } })) === 0;
        await tx.articleVersion.updateMany({
          where: { id: { in: draftIds } },
          data: { status: 'published', approvedBy: userId, approvedAt, publishedAt: approvedAt, effectiveDate: effective, changeNote: reason },
        });
        // 시행본이 없는 조문들이라 앞 시행본은 가장 최근에 내려간(폐지한) 버전이다
        const previous = await tx.articleVersion.findMany({
          where: {
            articleId: { in: targets.map((a) => a.id) },
            status: 'archived',
            variableBindings: { some: { state: { in: ['active', 'needs_review'] } } },
          },
          orderBy: [{ articleId: 'asc' }, { versionNum: 'desc' }],
          distinct: ['articleId'],
          select: { id: true, articleId: true, content: true },
        });
        for (const prev of previous) {
          const latest = await previousIssued(tx, prev.articleId, draftIds[targets.findIndex((a) => a.id === prev.articleId)]);
          // 연결이 있는 버전보다 더 최근에 내려간 버전이 있으면 그 버전이 앞 시행본이다(연결이 없으니 옮길 것도 없다)
          if (latest?.id !== prev.id) continue;
          const a = targets.find((t) => t.id === prev.articleId)!;
          await this.variablesService.inheritBindings(tx, tenantId, prev, { id: a.versions[0].id, articleId: a.id, content: a.versions[0].content }, userId);
        }
        if (firstPublication) await tx.policy.update({ where: { id: policyId }, data: { effectiveDate: effective } });
      },
      { maxWait: 10_000, timeout: 60_000 },
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

    // 조문을 잠근 뒤 읽고 고친다 — 승인·재파싱 묶음과 줄 세운다(묶음 지문에 시행일이 들어 있다)
    return this.prisma.$transaction(async (tx) => {
      // 규정 → 그 규정의 모든 조문(id 순) — 규정 시행일이 비어 있으면 끝에 채우므로 규정부터 잡고, 그 값도 잠근 뒤 다시 읽는다(T-131)
      await lockPolicyWithArticles(tx, policyId, LONG_LOCK_WAIT_MS);
      const policyNow = await tx.policy.findUniqueOrThrow({ where: { id: policyId }, select: { effectiveDate: true } });
      const versions = await tx.articleVersion.findMany({
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

      await tx.articleVersion.updateMany({
        where: { id: { in: plan.updateIds }, effectiveDate: null },
        data: { effectiveDate: date },
      });
      if (!policyNow.effectiveDate) await tx.policy.update({ where: { id: policyId }, data: { effectiveDate: date } });
      await tx.auditLog.create({
        data: {
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
        },
      });
      return { updated: plan.updateIds.length };
    }, { maxWait: 10_000, timeout: 60_000 });
  }

  async reject(tenantId: string, versionId: string, userId: string, reason?: string) {
    const version = await this.findOne(tenantId, versionId);
    if (version.status !== 'review') {
      throw new BadRequestException('Only versions in review can be rejected');
    }
    const note = String(reason ?? '').trim();
    if (!note) throw new BadRequestException('반려 사유를 입력하세요.');

    assertNotBundle(version);
    const row = await this.prisma.$transaction(async (tx) => {
      await lockArticle(tx, version.articleId);
      const fresh = await tx.articleVersion.findUniqueOrThrow({ where: { id: versionId }, select: { status: true, reparseItemId: true } });
      if (fresh.status !== 'review') throw new BadRequestException('Only versions in review can be rejected');
      assertNotBundle(fresh);
      return tx.articleVersion.update({
        where: { id: versionId },
        data: { status: 'draft', reviewNote: note.slice(0, 2000) },
      });
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
   * 폐지 — 게시된 버전을 내리고 **오늘(한국 날짜)부터** 조문을 시행에서 뺀다 (T-10, 폐지 시행일 T-126).
   *
   * 폐지 시행일(`repealedOn`)을 남겨야 시점 조회가 "새 버전에 밀려 내려간 버전"과 "폐지"를 가른다 — 없으면
   * 폐지 뒤 날짜에도 조문이 옛 본문으로 시행 중으로 나온다. 날짜는 고르지 않는다(사용자 지시로 코덱스 자문):
   * 미래 폐지는 "현재" 화면이 시행 예정을 가르게 된 뒤(T-127)에, 소급 폐지는 하지 않는다.
   *
   * 조문 행을 잠그고(승인과 같은 잠금) 다시 확인한다 — 시행일이 기록돼 있고 오늘 시행 중인 그 버전만 폐지한다.
   * 시행일이 없거나, 아직 시행 전이거나, 오늘 뒤에 시행될 버전이 따로 있으면 폐지가 그날 이후를 다 덮지 못해 거부한다.
   * 이 조문의 마지막 게시본이면 조문이 **전문 보기·인쇄에서 본문 없이 남는다**. 정당한 폐지라 막지는 않고,
   * 그렇게 됐는지를 응답으로 알려 화면이 말하게 한다.
   */
  async archive(tenantId: string, versionId: string, userId: string) {
    const version = await this.findOne(tenantId, versionId);
    if (version.status !== 'published') {
      throw new BadRequestException('Only published versions can be archived');
    }
    return this.prisma.$transaction(async (tx) => {
      await lockArticle(tx, version.articleId);
      return this.archiveLocked(tx, tenantId, { id: versionId, articleId: version.articleId }, userId);
    });
  }

  /**
   * 폐지 본체 — 그 조문을 잠근 트랜잭션 안에서 부른다. 재파싱 승인 뒤 "원문에 없는 조문 폐지"가 검토 항목 결과와 한 트랜잭션에
   * 묶으려고 따로 둔다(T-131 — 폐지만 커밋되고 항목 결과가 빠지는 일이 없게)
   */
  async archiveLocked(tx: Prisma.TransactionClient, tenantId: string, version: { id: string; articleId: string }, userId: string) {
    const versionId = version.id;
    const today = todayDateOnly();
    const history = await tx.articleVersion.findMany({
      where: { articleId: version.articleId, status: { in: ['published', 'archived'] } },
      select: { id: true, status: true, effectiveDate: true, versionNum: true },
    });
    const target = history.find((v) => v.id === versionId);
    if (target?.status !== 'published') {
      throw new ConflictException('그 사이 이 버전이 내려갔습니다 — 화면을 새로 고쳐 확인하세요.');
    }
    if (!target.effectiveDate) {
      throw new BadRequestException('시행일이 기록되지 않은 시행본은 폐지할 수 없습니다 — 규정 화면에서 시행일을 먼저 보정하세요.');
    }
    if (target.effectiveDate.getTime() > today.getTime()) {
      throw new BadRequestException(
        `아직 시행 전인 버전입니다(${toDateOnlyString(target.effectiveDate)} 시행) — 시행일부터 폐지할 수 있습니다.`,
      );
    }
    const later = history.find((v) => v.effectiveDate && v.effectiveDate.getTime() > today.getTime());
    if (later) {
      throw new BadRequestException(
        `오늘 뒤에 시행되는 버전(v${later.versionNum}, ${toDateOnlyString(later.effectiveDate!)} 시행)이 있어 폐지할 수 없습니다.`,
      );
    }
    const current = await tx.articleVersion.findFirst({
      where: { articleId: version.articleId, ...asOfVersionWhere(today) },
      orderBy: AS_OF_VERSION_ORDER,
      select: { id: true, versionNum: true },
    });
    if (current?.id !== versionId) {
      throw new BadRequestException(
        `오늘 시행 중인 본문은 이 버전이 아니라 v${current?.versionNum}입니다 — 시행일 기록을 먼저 확인하세요.`,
      );
    }

    const row = await tx.articleVersion.update({
      where: { id: versionId },
      data: { status: 'archived', repealedOn: today },
    });
    const remainingPublished = await tx.articleVersion.count({
      where: { articleId: version.articleId, status: 'published' },
    });
    await tx.auditLog.create({
      data: {
        tenantId,
        userId,
        action: 'version.archive',
        entityType: 'ArticleVersion',
        entityId: versionId,
        details: { articleId: version.articleId, repealedOn: toDateOnlyString(today), remainingPublished },
      },
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

/**
 * 폐지한 조문을 다시 시행할 때 시행일이 마지막 폐지일 이후인가(T-126). 같은 날은 된다 — 같은 날 시행분은 나중
 * 버전이 이기므로 그날부터 새 본문이 시행된다. 더 이르면 폐지가 지워지고 폐지 전 날짜의 시점 조회까지 새 본문으로
 * 바뀐다. 조문 잠금 안에서 부른다.
 */
export async function assertAfterRepeal(tx: Prisma.TransactionClient, articleId: string, effective: Date) {
  const repeal = await tx.articleVersion.findFirst({
    where: { articleId, repealedOn: { not: null } },
    orderBy: { repealedOn: 'desc' },
    select: { repealedOn: true },
  });
  if (repeal?.repealedOn && effective.getTime() < repeal.repealedOn.getTime()) {
    throw new BadRequestException(
      `이 조문은 ${toDateOnlyString(repeal.repealedOn)}에 폐지됐습니다 — 다시 시행하려면 시행일을 그날이나 그 뒤로 정하세요.`,
    );
  }
}

/**
 * 새로 발행하는 버전의 앞 시행본 — 변수 연결을 옮겨 올 버전(T-109). 지금 시행본이 있으면 그것, 없으면(폐지 뒤 다시
 * 시행) 가장 최근에 시행했던 버전.
 */
export async function previousIssued(tx: Prisma.TransactionClient, articleId: string, excludeId: string) {
  const published = await tx.articleVersion.findFirst({
    where: { articleId, status: 'published', id: { not: excludeId } },
    orderBy: { versionNum: 'desc' },
    select: { id: true, content: true },
  });
  if (published) return published;
  return tx.articleVersion.findFirst({
    where: { articleId, status: 'archived', id: { not: excludeId } },
    orderBy: { versionNum: 'desc' },
    select: { id: true, content: true },
  });
}
