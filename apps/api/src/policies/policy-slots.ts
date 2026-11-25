import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { PlanTier, Prisma } from '@prisma/client';
import { maxPoliciesForPlan, planLabel } from '../common/plan-limits';
import { lockTenantRow } from '../common/row-locks';

/** 플랜 규정 상한에 걸린 403 — 화면이 이 코드로 등록 전 안내와 같은 문구를 보인다(T-198) */
export const POLICY_LIMIT_REACHED = 'POLICY_LIMIT_REACHED';

/**
 * 상한 403. 예전 문구(`현재 플랜(starter)에서 등록 가능한 규정은 최대 5건입니다.`)는 내부 요금제 값을 그대로 보이고 무엇을 하면 되는지가 없었다 —
 * 고객사는 요금제를 바꿀 수 없으므로(T-125) 아스트룸 문의를 함께 쓴다
 */
function policyLimitError(plan: PlanTier, max: number, used: number, adding: number) {
  const head = `지금 요금제(${planLabel(plan)})에서는 규정을 최대 ${max}건까지 등록할 수 있는데`;
  // 비활성 규정도 센다 — 비활성으로 바꾸면 자리가 난다고 여기기 쉽다
  const why = adding > 1
    ? `이미 ${used}건(비활성 규정 포함)이 있어 ${adding}건을 더 등록할 수 없습니다`
    : `이미 ${used}건이 등록되어 있습니다(비활성 규정 포함)`;
  return new ForbiddenException({
    statusCode: 403,
    error: 'Forbidden',
    message: `${head}, ${why}. 요금제 변경은 아스트룸에 문의하세요.`,
    ...policyLimitFields(plan, max, used),
  });
}

/** 상한에 막힌 응답이 함께 싣는 값 — 일괄 등록의 사전 검사 400(issues)에도 같은 코드로 붙인다 */
export function policyLimitFields(plan: PlanTier, max: number, used: number) {
  return { code: POLICY_LIMIT_REACHED, plan, max, used };
}

/**
 * 규정을 새로 만들 자리를 잡는다(T-135) — 회사 행을 잠근 뒤 규정 수를 세어 플랜 상한을 보고, 같은 잠금 아래에서 코드 중복도 본다.
 *
 * 잠그지 않고 세면 동시에 들어온 두 요청이 같은 마지막 자리를 보고 둘 다 만든다(같은 코드도 둘 다 "없음"으로 보고 한쪽이 500).
 * 규정을 만드는 모든 경로(새 규정·가져오기 확정·텍스트 가져오기·관리자 일괄 등록)가 저장 트랜잭션 맨 앞에서 부른다 — 회사 잠금이 잠금 순서의
 * 맨 앞이다(`common/row-locks`). 잠금은 트랜잭션이 끝날 때 풀리므로 그 안에서 규정을 만들어야 한다.
 */
export async function claimPolicySlots(tx: Prisma.TransactionClient, tenantId: string, codes: string[]) {
  const { plan } = await lockTenantRow(tx, tenantId);
  const max = maxPoliciesForPlan(plan);
  const count = await tx.policy.count({ where: { tenantId } });
  if (count + codes.length > max) throw policyLimitError(plan, max, count, codes.length);
  const taken = await tx.policy.findFirst({ where: { tenantId, code: { in: codes } }, select: { code: true } });
  // 예전 새 규정 만들기는 영어 문구(`Code … is already in use`)였다 — 화면에 그대로 나오므로 일괄 등록의 문구로 맞춘다
  if (taken) throw new ConflictException(`규정 코드가 이미 있습니다: ${taken.code}`);
  return { plan };
}

/**
 * 지금 규정 자리 — 화면이 등록 창·PDF 가져오기를 열 때 상한을 먼저 알리게 한다(T-198). 끝까지 입력한 뒤에야 403 을 보던 것이
 * "규정 등록이 아예 안 된다"로 보였다. 세는 방식은 `claimPolicySlots` 와 같고(회사의 모든 규정), 잠그지 않는 안내용이다 — 막는 것은 저장 때의 검사다
 */
export async function readPolicySlots(db: Pick<Prisma.TransactionClient, 'tenant' | 'policy'>, tenantId: string) {
  const tenant = await db.tenant.findUnique({ where: { id: tenantId }, select: { plan: true } });
  if (!tenant) throw new NotFoundException('Tenant not found');
  const used = await db.policy.count({ where: { tenantId } });
  const max = maxPoliciesForPlan(tenant.plan);
  return { plan: tenant.plan, used, max, remaining: Math.max(0, max - used) };
}
