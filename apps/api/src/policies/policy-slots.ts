import { ConflictException, ForbiddenException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { maxPoliciesForPlan } from '../common/plan-limits';
import { lockTenantRow } from '../common/row-locks';

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
  if (count + codes.length > max) {
    throw new ForbiddenException(`현재 플랜(${plan})에서 등록 가능한 규정은 최대 ${max}건입니다.`);
  }
  const taken = await tx.policy.findFirst({ where: { tenantId, code: { in: codes } }, select: { code: true } });
  // 예전 새 규정 만들기는 영어 문구(`Code … is already in use`)였다 — 화면에 그대로 나오므로 일괄 등록의 문구로 맞춘다
  if (taken) throw new ConflictException(`규정 코드가 이미 있습니다: ${taken.code}`);
  return { plan };
}
