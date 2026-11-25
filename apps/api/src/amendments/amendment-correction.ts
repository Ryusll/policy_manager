import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { lockArticleRow } from '../common/row-locks';
import { findRejectionAudit, writeCorrection } from '../audit/audit-correction';
import { contentHash } from './amendment-revision';
import { CorrectRejectionDto } from './amendments.dto';

const LOCK_MESSAGE = '그 사이 다른 사람이 이 후보를 고쳤거나 정정했습니다. 최신 내용을 불러온 뒤 다시 하세요.';

/**
 * 개정 후보 정정(T-178, PAT-21 — 특허 도 12). 반려나 승인을 지우지 않고, 앞선 결정을 가리키는 정정 전환(종류 correction)과 정정
 * 감사를 같은 트랜잭션에 쌓는다. 승인의 정정(시행 예정 철회)은 버전 쪽에서 시작한다(versions/version-withdraw).
 */
@Injectable()
export class AmendmentCorrectionService {
  constructor(private prisma: PrismaService) {}

  /**
   * 반려 정정 — 본문을 바꾸지 않고 반려를 되돌려 작성 상태로(다시 검토를 요청할 수 있다). 관리자만(반려와 같다), 사유 필수.
   * 원 반려 전환·사유·감사는 그대로 두고, 정정 감사가 원 반려 감사를 가리킨다. 알림은 보내지 않는다.
   */
  async correctRejection(tenantId: string, id: string, userId: string, dto: CorrectRejectionDto) {
    const reason = dto.reason?.trim();
    if (!reason) throw new BadRequestException('정정 사유를 입력하세요 — 반려를 왜 되돌리는지가 기록으로 남습니다.');
    // 후보의 tenantId 와 조문의 실제 소속을 둘 다 본다(T-41 교훈) — 다른 회사 후보는 404
    const cand = await this.prisma.amendmentCandidate.findFirst({
      where: { id, tenantId, article: { chapter: { policy: { tenantId } } } },
      select: { id: true, articleId: true, reviewState: true, revision: true, lockVersion: true, candidateContent: true, changeEventId: true },
    });
    if (!cand) throw new NotFoundException('개정 후보를 찾을 수 없습니다.');
    if (cand.reviewState !== 'rejected') throw new BadRequestException('반려된 후보만 반려를 정정할 수 있습니다.');
    if (cand.revision !== dto.expectedRevision || cand.lockVersion !== dto.expectedLockVersion) {
      throw new ConflictException({ message: LOCK_MESSAGE, revision: cand.revision, lockVersion: cand.lockVersion });
    }

    await this.prisma.$transaction(async (tx) => {
      // 반려된 후보를 다시 여는 공통 판정·떼기(조문 잠금 → 발행본이 쥐면 409 → 옛 철회 초안의 원천 연결 떼기) — 손질과 같다
      const detached = await reopenRejectedLocked(tx, {
        tenantId,
        userId,
        candidateId: id,
        articleId: cand.articleId,
        cause: 'amendment.reject_correct',
        what: '반려를 정정해도 다시 승인할 수 없습니다',
      });
      // 조건부 갱신 — 읽은 뒤 손질·다른 정정이 먼저 바꿨으면 0건이다
      const updated = await tx.amendmentCandidate.updateMany({
        where: { id, tenantId, reviewState: 'rejected', revision: cand.revision, lockVersion: cand.lockVersion },
        data: { reviewState: 'draft', lockVersion: { increment: 1 } },
      });
      if (updated.count !== 1) throw new ConflictException(LOCK_MESSAGE);
      // 되돌릴 결정 — 후보를 반려로 들인 마지막 전환
      const decision = await tx.amendmentStateChange.findFirst({
        where: { tenantId, candidateId: id, toState: 'rejected' },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        select: { id: true, fromState: true, revision: true, reason: true, actorId: true, createdAt: true },
      });
      const original = decision ? await findRejectionAudit(tx, tenantId, id, decision) : null;
      const change = await tx.amendmentStateChange.create({
        data: { tenantId, candidateId: id, fromState: 'rejected', toState: 'draft', kind: 'correction', revision: cand.revision, reason, actorId: userId },
        select: { id: true },
      });
      await writeCorrection(tx, original, {
        tenantId,
        userId,
        action: 'amendment.reject_correct',
        entityType: 'amendment_candidate',
        entityId: id,
        reason,
        before: {
          reviewState: 'rejected',
          decisionId: decision?.id ?? null,
          decisionReason: decision?.reason ?? null,
          decidedBy: decision?.actorId ?? null,
          decidedAt: decision?.createdAt.toISOString() ?? null,
        },
        after: { reviewState: 'draft' },
        extra: {
          correctionId: change.id,
          revision: cand.revision,
          contentHash: contentHash(cand.candidateContent),
          changeEventId: cand.changeEventId,
          ...(detached ? { detachedVersionIds: [detached.id] } : {}),
        },
      });
    });
  }
}

/**
 * 마지막 결정(승인·반려) 뒤의 정정 — 반려 정정이나 승인 철회(작성 상태로 돌린 정정 전환). 그 뒤 새 결정이 있으면 없다(null). 후보 화면이
 * "정정됨"을 보인다. T-178 전 철회가 남긴 승인 → 반려 전환(마이그레이션이 종류를 정정으로 채웠다)은 그 자체가 마지막 결정이라 세지 않는다.
 */
export async function correctionAfter(
  db: Pick<Prisma.TransactionClient, 'amendmentStateChange'>,
  tenantId: string,
  candidateId: string,
  decidedAt: Date | null,
) {
  if (!decidedAt) return null;
  const row = await db.amendmentStateChange.findFirst({
    where: { tenantId, candidateId, kind: 'correction', toState: 'draft', createdAt: { gte: decidedAt } },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    select: { fromState: true, revision: true, reason: true, actorId: true, createdAt: true },
  });
  return row ? { ...row, kind: row.fromState === 'approved' ? ('withdraw' as const) : ('reject' as const) } : null;
}

const ISSUED = new Set(['published', 'archived']);

/**
 * 이 후보를 원천으로 쥔 발행 버전(published·archived)이 있으면 409 — T-178 전 철회 초안을 일반 승인으로 다시 발행한 경우다. 그 후보는
 * 다시 승인할 수 없어(원천 후보 id 는 유일) 승인도, 승인으로 가는 반려 정정도 막는다. 어느 발행이 결과인지는 사람이 규정 화면에서 본다.
 */
export async function assertNoIssuedSource(tx: Pick<Prisma.TransactionClient, 'articleVersion'>, candidateId: string, what: string) {
  const holder = await tx.articleVersion.findUnique({ where: { sourceCandidateId: candidateId }, select: { status: true, versionNum: true } });
  if (holder && ISSUED.has(holder.status)) {
    // reason — 승인 화면이 다른 승인 막힘(blocked)과 같이 가른다
    throw new ConflictException({
      message: `이 후보로 발행한 버전(v${holder.versionNum})이 이미 있어 ${what} — 규정 화면에서 그 버전을 확인하세요.`,
      reason: 'issued_source',
    });
  }
}

export type DetachedSource = { id: string; status: string; versionNum: number; changeEventId: string | null };

/**
 * 반려된 후보를 다시 여는 쪽(반려 정정, 반려 뒤 손질)의 공통 판정 — 트랜잭션 처음에 부른다.
 * 1. 조문 잠금 — 그 조문의 발행(일반 승인·후보 승인·철회)과 줄 세운다(승인과 같은 순서: 조문 → 후보). 판정과 떼기 사이에 발행이 끼지 않게
 * 2. 이 후보로 발행한 버전이 있으면 409 — 다시 열어도 다시 승인할 수 없다(승인과 같은 판정)
 * 3. T-178 전 철회 초안이 이 후보를 원천으로 쥐고 있으면 지금 떼고 그 버전 대상 감사 — 그대로 두면 그 초안을 일반 승인으로 발행하는 순간
 *    후보는 승인 409 에 막힌다
 */
export async function reopenRejectedLocked(
  tx: Prisma.TransactionClient,
  p: { tenantId: string; userId: string; candidateId: string; articleId: string; cause: 'amendment.reject_correct' | 'amendment.edit'; what: string },
): Promise<DetachedSource | null> {
  await lockArticleRow(tx, p.articleId);
  await assertNoIssuedSource(tx, p.candidateId, p.what);
  const detached = await detachStaleSources(tx, p.candidateId);
  if (detached) {
    await recordSourceDetach(tx, { tenantId: p.tenantId, userId: p.userId, candidateId: p.candidateId, newVersionId: null, cause: p.cause, detached });
  }
  return detached;
}

/**
 * 승인 직전(그리고 반려에서 다시 열 때) — 이 후보를 원천으로 쥔 채 발행되지 않은 버전(초안·검토 중)의 원천 연결(후보·변경 이벤트)을 뗀다. T-178 전 철회는 초안에
 * 원천 후보를 남겼고, 원천 후보 id 는 유일이라 그대로 두면 새 버전을 만들 수 없다(500). 뗀 버전을 돌려준다 — 새 버전을 만든 뒤
 * `recordSourceDetach` 로 그 버전 대상 감사를 남긴다. 발행된 버전이 쥐고 있으면 떼지 않고 409(assertNoIssuedSource).
 */
export async function detachStaleSources(tx: Prisma.TransactionClient, candidateId: string): Promise<DetachedSource | null> {
  await assertNoIssuedSource(tx, candidateId, '다시 승인할 수 없습니다');
  const holder = await tx.articleVersion.findUnique({
    where: { sourceCandidateId: candidateId },
    select: { id: true, status: true, versionNum: true, changeEventId: true },
  });
  if (!holder) return null;
  await tx.articleVersion.update({ where: { id: holder.id }, data: { sourceCandidateId: null, changeEventId: null } });
  return holder;
}

/**
 * 뗀 원천 연결의 감사 — 그 버전을 대상으로, 떼게 한 결정(후보 승인·반려 정정·반려 뒤 손질)과 같은 트랜잭션에. 버전의 기록만 봐도 왜
 * 연결이 사라졌는지 안다. 승인이 아니면 새 버전은 없다(null)
 */
export async function recordSourceDetach(
  tx: Pick<Prisma.TransactionClient, 'auditLog'>,
  p: {
    tenantId: string;
    userId: string;
    candidateId: string;
    newVersionId: string | null;
    cause: 'amendment.approve' | 'amendment.reject_correct' | 'amendment.edit';
    detached: DetachedSource;
  },
) {
  await tx.auditLog.create({
    data: {
      tenantId: p.tenantId,
      userId: p.userId,
      action: 'version.source_detach',
      entityType: 'ArticleVersion',
      entityId: p.detached.id,
      details: {
        candidateId: p.candidateId,
        cause: p.cause,
        newVersionId: p.newVersionId,
        status: p.detached.status,
        versionNum: p.detached.versionNum,
        before: { sourceCandidateId: p.candidateId, changeEventId: p.detached.changeEventId },
        after: { sourceCandidateId: null, changeEventId: null },
      },
    },
  });
}
