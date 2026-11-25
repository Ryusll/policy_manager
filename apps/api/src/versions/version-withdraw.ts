import { BadRequestException, ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { toDateOnlyString, todayDateOnly } from '../common/date-only';
import { findApprovalAudit, writeCorrection } from '../audit/audit-correction';

/**
 * 시행 예정 철회(T-132 ②) — 승인했지만 시행일 전인 버전을 초안으로 되돌린다(고쳐서 다시 올릴 수 있다). 조문을 잠근 트랜잭션 안에서 부른다.
 * - 조문의 마지막 발행(시행일이 가장 늦은 판)만 — 뒤 판은 앞 판을 바탕으로 썼다
 * - 재파싱 묶음 버전은 하나만 철회하지 않는다 — 승인 때 조문 행을 새 자리로 옮겨, 버전만 거두면 계층이 어긋난다
 * - 승인 때 앞 시행본에서 옮겨 온 변수 연결은 거둔다(다시 승인하면 그때 다시 옮긴다)
 * - 남은 published 가 없으면 지금 가장 늦은 발행을 다시 published 로(폐지된 판이면 그대로)
 *
 * 철회는 승인의 정정이다(T-178, PAT-21 — 특허 도 12). 지우는 승인 정보(승인자·시각·발행일·시행일·개정 사유·조기 시행 이유)와
 * 연결(원천 후보·변경 이벤트)을 철회 감사의 before 에 옮겨 적고, 원 승인 감사를 가리킨다(원 감사는 그대로). 개정 후보로 승인한
 * 버전이면 후보를 반려가 아니라 작성 상태로 돌리고(정정 전환), 초안의 원천 연결을 떼어 같은 후보를 다시 승인할 수 있게 한다.
 */
export async function withdrawScheduledLocked(
  tx: Prisma.TransactionClient,
  p: { tenantId: string; articleId: string; versionId: string; userId: string; note: string },
) {
  const { tenantId, articleId, versionId, userId, note } = p;
  const today = todayDateOnly();
  const issued = await tx.articleVersion.findMany({
    where: { articleId, status: { in: ['published', 'archived'] } },
    select: { id: true, versionNum: true, effectiveDate: true, repealedOn: true, reparseItemId: true },
  });
  const target = issued.find((v) => v.id === versionId);
  if (!target) throw new ConflictException('그 사이 이 버전이 바뀌었습니다 — 화면을 새로 고쳐 확인하세요.');
  if (!target.effectiveDate || target.effectiveDate.getTime() <= today.getTime()) {
    throw new BadRequestException('이미 시행된 버전은 철회할 수 없습니다 — 고치려면 새 버전을 올리세요.');
  }
  const E = toDateOnlyString(target.effectiveDate);
  if (target.reparseItemId) {
    throw new ConflictException(
      '재파싱 묶음으로 승인한 버전은 하나만 철회할 수 없습니다(승인 때 조문 자리를 함께 옮겼습니다) — 원문을 다시 비교해 새 묶음으로 바로잡으세요.',
    );
  }
  const later = issued.find(
    (v) =>
      v.id !== target.id &&
      v.effectiveDate &&
      (v.effectiveDate.getTime() > target.effectiveDate!.getTime() ||
        (v.effectiveDate.getTime() === target.effectiveDate!.getTime() && v.versionNum > target.versionNum)),
  );
  if (later) {
    throw new ConflictException(
      `더 늦게 시행될 버전(v${later.versionNum}, ${toDateOnlyString(later.effectiveDate!)} 시행)이 있습니다 — 그 버전부터 철회하세요.`,
    );
  }

  // 지우기 전 승인 정보 — 철회 감사의 before 로 남긴다
  const was = await tx.articleVersion.findUniqueOrThrow({
    where: { id: versionId },
    select: {
      status: true,
      approvedBy: true,
      approvedAt: true,
      publishedAt: true,
      publishedAtFromApproval: true,
      changeNote: true,
      reviewNote: true,
      sourceCandidateId: true,
      changeEventId: true,
    },
  });
  const original = await findApprovalAudit(tx, tenantId, { id: versionId, sourceCandidateId: was.sourceCandidateId });
  // 조기 시행 이유는 버전 열이 아니라 원 승인(개정 후보 승인) 감사에 있다
  const earlyReason = original?.action === 'amendment.approve' ? ((original.details as { earlyReason?: string | null } | null)?.earlyReason ?? null) : null;

  const reviewNote = `시행 예정 철회(${E} 시행이었음): ${note}`;
  const row = await tx.articleVersion.update({
    where: { id: versionId },
    data: {
      status: 'draft',
      approvedBy: null,
      approvedAt: null,
      publishedAt: null,
      publishedAtFromApproval: false,
      effectiveDate: null,
      reviewNote,
      sourceCandidateId: null,
      changeEventId: null,
    },
  });
  const released = await tx.variableBinding.updateMany({
    where: { versionId, origin: 'inherited', state: { not: 'released' } },
    data: { state: 'released' },
  });
  let restoredVersionId: string | null = null;
  if ((await tx.articleVersion.count({ where: { articleId, status: 'published' } })) === 0) {
    const head = await tx.articleVersion.findFirst({
      where: { articleId, status: 'archived' },
      orderBy: [{ effectiveDate: { sort: 'desc', nulls: 'last' } }, { versionNum: 'desc' }],
      select: { id: true, repealedOn: true },
    });
    if (head && !head.repealedOn) {
      await tx.articleVersion.update({ where: { id: head.id }, data: { status: 'published' } });
      restoredVersionId = head.id;
    }
  }

  // 개정 후보로 승인한 버전 — 후보를 작성 상태로(반려가 아니라 승인의 정정). 다시 검토를 요청해 승인할 수 있다
  let candidateId: string | null = null;
  if (was.sourceCandidateId) {
    const cand = await tx.amendmentCandidate.findFirst({
      where: { id: was.sourceCandidateId, tenantId, reviewState: 'approved' },
      select: { id: true, revision: true },
    });
    if (cand) {
      const moved = await tx.amendmentCandidate.updateMany({
        where: { id: cand.id, reviewState: 'approved' },
        data: { reviewState: 'draft', lockVersion: { increment: 1 } },
      });
      if (moved.count !== 1) throw new ConflictException('그 사이 개정 후보가 바뀌었습니다 — 화면을 새로 고쳐 확인하세요.');
      await tx.amendmentStateChange.create({
        data: {
          tenantId,
          candidateId: cand.id,
          fromState: 'approved',
          toState: 'draft',
          kind: 'correction',
          revision: cand.revision,
          reason: `승인 철회 — ${note}`,
          actorId: userId,
        },
      });
      candidateId = cand.id;
    }
  }

  await writeCorrection(tx, original, {
    tenantId,
    userId,
    action: 'version.withdraw',
    entityType: 'ArticleVersion',
    entityId: versionId,
    reason: note,
    before: {
      status: was.status,
      approvedBy: was.approvedBy,
      approvedAt: was.approvedAt?.toISOString() ?? null,
      publishedAt: was.publishedAt?.toISOString() ?? null,
      publishedAtFromApproval: was.publishedAtFromApproval,
      effectiveDate: E,
      changeNote: was.changeNote,
      earlyReason,
      reviewNote: was.reviewNote,
      sourceCandidateId: was.sourceCandidateId,
      changeEventId: was.changeEventId,
      ...(candidateId ? { candidateState: 'approved' } : {}),
    },
    after: {
      status: 'draft',
      approvedBy: null,
      approvedAt: null,
      publishedAt: null,
      publishedAtFromApproval: false,
      effectiveDate: null,
      reviewNote,
      sourceCandidateId: null,
      changeEventId: null,
      ...(candidateId ? { candidateState: 'draft' } : {}),
    },
    extra: { articleId, effectiveDate: E, restoredVersionId, candidateId, releasedBindings: released.count },
  });
  return { ...row, restoredVersionId, candidateId, withdrawnEffectiveDate: E };
}
