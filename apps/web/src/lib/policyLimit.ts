import type { PolicySlots } from '../api/policies';

/** 서버 `policies/policy-slots.ts` 의 상한 403 코드(T-198) */
export const POLICY_LIMIT_REACHED = 'POLICY_LIMIT_REACHED';

export type PolicyLimit = { plan: PolicySlots['plan']; max: number; used: number };

const PLANS: PolicyLimit['plan'][] = ['starter', 'pro', 'enterprise'];

/** 규정 자리가 다 찼는가 — 새 규정을 만드는 버튼을 막고 안내를 띄운다. 아직 못 받았으면 막지 않는다(저장 때 서버가 다시 센다) */
export function policySlotsFull(slots: PolicySlots | undefined | null): PolicyLimit | null {
  if (!slots || slots.used < slots.max) return null;
  return { plan: slots.plan, max: slots.max, used: slots.used };
}

/** 저장이 플랜 상한에 막힌 오류면 그 값을, 다른 오류면 null — 등록 전 안내와 같은 문구로 보이게 한다 */
export function policyLimitFromError(err: unknown): PolicyLimit | null {
  const data = (err as { response?: { data?: Record<string, unknown> } } | null)?.response?.data;
  if (!data || data.code !== POLICY_LIMIT_REACHED) return null;
  const { plan, max, used } = data;
  if (!PLANS.includes(plan as PolicyLimit['plan']) || typeof max !== 'number' || typeof used !== 'number') return null;
  return { plan: plan as PolicyLimit['plan'], max, used };
}

/**
 * 상한 안내와 저장 실패를 어디에 보일지(T-198). 한 화면에 같은 안내가 두 번 뜨거나, 안내가 버튼 곁에서 화면 위로 옮겨 가 사라지지 않게
 * 두 화면(규정 목록 등록 창·PDF 가져오기)이 같은 규칙을 쓴다.
 * - `before`: 입력 전 안내(자리가 다 참). 저장이 상한에 막혀 버튼 곁에 같은 안내가 이미 있으면 띄우지 않는다
 * - `atButton`: 상한에 막힌 저장 — 버튼 곁에 남는다
 * - `otherError`: 상한이 아닌 저장 실패(409·500 …) — 자리가 찼어도 숨기지 않는다
 */
export function limitFeedback(error: unknown, full: PolicyLimit | null) {
  const fromError = policyLimitFromError(error);
  return {
    before: fromError ? null : full,
    atButton: fromError,
    otherError: error && !fromError ? error : null,
  };
}
