import { Prisma } from '@prisma/client';

/**
 * 감사 로그 정정(T-178, PAT-21 — 특허 도 12 "승인 또는 반려 후 정정은 기존 기록을 삭제하는 대신 정정 사유와 정정 내용을 포함하는
 * 후속 기록"). 원 기록은 고치거나 지우지 않는다. 정정은 원 기록을 가리키는(`corrects_id`) 새 기록이고, details 에 사유(reason)·
 * 정정 전(before)·정정 후(after)를 담는다.
 *
 * - 어떤 기록이 어떤 기록을 정정할 수 있는지는 아래 표 하나로 정한다
 * - 정정 기록은 `writeCorrection` 으로만 쓴다 — 상태를 바꾼 트랜잭션 안에서(되돌려지면 정정 기록도 없다). 가드 시험이 다른 곳의
 *   `correctsId` 쓰기와 감사 수정·삭제를 막는다(tests/auditAppendOnly.test.ts)
 * - 원 기록을 찾지 못하면(원 기록을 남기기 전의 승인, 감사가 버전 하나를 가리키지 않는 발행) 짐작해 잇지 않고 비워 둔다 —
 *   화면은 "원 기록 없음"으로 보인다
 */

/** 정정 action → 그 정정이 바로잡을 수 있는 원 기록의 action */
export const CORRECTION_TARGETS: Readonly<Record<string, readonly string[]>> = {
  /** 반려 정정 — 본문을 바꾸지 않고 반려를 되돌린다. 원 기록은 그 반려, 또는 후보를 반려로 돌렸던 T-178 전의 철회 */
  'amendment.reject_correct': ['amendment.reject', 'version.withdraw'],
  /** 시행 예정 철회 — 승인(개정 후보 승인·일반 승인)을 거둔다 */
  'version.withdraw': ['amendment.approve', 'version.approve'],
};

export type CorrectionTarget = { id: string; tenantId: string; action: string };

/**
 * 정정 action 과 원 기록이 맞는 짝인지 본다. 서버가 고른 원 기록이 어긋나면 코드 결함이라 그대로 터뜨린다(사용자 입력 오류가 아니다).
 * 원 기록이 없으면(null) 짝을 따지지 않는다.
 */
export function assertCorrectionPair(action: string, tenantId: string, target: CorrectionTarget | null): void {
  const allowed = CORRECTION_TARGETS[action];
  if (!allowed) throw new Error(`정정 기록이 아닌 action 입니다: ${action}`);
  if (!target) return;
  if (target.tenantId !== tenantId) throw new Error('다른 회사의 감사 기록은 정정 대상이 될 수 없습니다.');
  if (!allowed.includes(target.action)) throw new Error(`${action} 은(는) ${target.action} 기록을 정정하지 않습니다.`);
}

export type CorrectionEntry = {
  tenantId: string;
  userId: string;
  action: string;
  entityType: string;
  entityId: string;
  /** 정정 사유 — 필수 */
  reason: string;
  /** 정정 전·후 — 바뀐 값만 */
  before: Record<string, unknown>;
  after: Record<string, unknown>;
  /** 그 밖에 남길 것(조문 id 등). reason·before·after 를 덮지 못한다 */
  extra?: Record<string, unknown>;
};

type AuditDb = Pick<Prisma.TransactionClient, 'auditLog'>;

/** 정정 기록을 쓴다 — 상태를 바꾼 그 트랜잭션(tx)으로 */
export async function writeCorrection(tx: AuditDb, target: CorrectionTarget | null, e: CorrectionEntry) {
  assertCorrectionPair(e.action, e.tenantId, target);
  if (!e.reason.trim()) throw new Error('정정 사유가 비어 있습니다.');
  return tx.auditLog.create({
    data: {
      tenantId: e.tenantId,
      userId: e.userId,
      action: e.action,
      entityType: e.entityType,
      entityId: e.entityId,
      correctsId: target?.id ?? null,
      details: { ...e.extra, reason: e.reason, before: e.before, after: e.after } as Prisma.InputJsonValue,
    },
    select: { id: true },
  });
}

const TARGET_SELECT = { id: true, tenantId: true, action: true, details: true } as const;

/**
 * 시행 예정 철회가 정정할 원 승인 기록 — 그 버전의 **마지막 철회 뒤에** 남은 승인 가운데 마지막 것. 개정 후보로 발행했으면 후보 승인
 * (`amendment.approve` 의 details.version.id), 일반 승인이면 `version.approve`(대상이 그 버전). 둘 다 보고 늦은 쪽을 고른다 —
 * T-178 전 철회는 원천 후보를 떼지 않아, 그 초안을 일반 승인으로 다시 발행한 버전도 후보 id 를 쥐고 있다.
 * 마지막 철회 앞의 승인은 그 철회가 이미 거둔 것이다 — T-178 전 철회는 원 기록을 가리키지 않아(corrects_id 없음) "정정됨"만으로는
 * 거를 수 없다. 그래서 철회 → 한꺼번에 시행(`version.bulk_publish` — 조문 id 만 남긴다)·가져오기로 다시 발행 → 철회면 찾지 않는다(null).
 */
export async function findApprovalAudit(
  db: Pick<Prisma.TransactionClient, 'auditLog'>,
  tenantId: string,
  version: { id: string; sourceCandidateId: string | null },
) {
  const lastWithdraw = await db.auditLog.findFirst({
    where: { tenantId, action: 'version.withdraw', entityType: 'ArticleVersion', entityId: version.id },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    select: { createdAt: true },
  });
  // 대상 종류까지 걸어 대상 색인(tenant_id, entity_type, entity_id, created_at)을 탄다 — 두 action 모두 처음부터 이 종류로 썼다
  const byVersion: Prisma.AuditLogWhereInput[] = [{ action: 'version.approve', entityType: 'ArticleVersion', entityId: version.id }];
  if (version.sourceCandidateId) {
    byVersion.push({
      action: 'amendment.approve',
      entityType: 'amendment_candidate',
      entityId: version.sourceCandidateId,
      details: { path: ['version', 'id'], equals: version.id },
    });
  }
  return db.auditLog.findFirst({
    // 철회가 거둔 승인은 모두 그 버전의 마지막 철회보다 앞이다 — "정정됨" 여부를 따로 묻지 않는다(회사 조건 없는 부분 질의가 감사 표를 훑는다)
    where: { tenantId, OR: byVersion, ...(lastWithdraw ? { createdAt: { gt: lastWithdraw.createdAt } } : {}) },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    select: TARGET_SELECT,
  });
}

/**
 * 반려 정정이 정정할 원 기록 — 후보를 반려로 들인 그 전환의 감사. 검토 → 반려면 그 반려(`amendment.reject`, details.decisionId).
 * 승인 → 반려(T-178 전 철회가 남긴 모양)면 그 철회(`version.withdraw`, details.candidateId) — 전환을 쓴 트랜잭션에서 뒤이어 썼으니
 * 그 전환 시각 이후의 첫 철회 기록이다.
 */
export async function findRejectionAudit(
  db: Pick<Prisma.TransactionClient, 'auditLog'>,
  tenantId: string,
  candidateId: string,
  decision: { id: string; fromState: string; createdAt: Date },
) {
  if (decision.fromState === 'approved') {
    return db.auditLog.findFirst({
      where: {
        tenantId,
        action: 'version.withdraw',
        entityType: 'ArticleVersion',
        details: { path: ['candidateId'], equals: candidateId },
        createdAt: { gte: decision.createdAt },
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: TARGET_SELECT,
    });
  }
  return db.auditLog.findFirst({
    where: { tenantId, action: 'amendment.reject', entityType: 'amendment_candidate', entityId: candidateId, details: { path: ['decisionId'], equals: decision.id } },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    select: TARGET_SELECT,
  });
}
