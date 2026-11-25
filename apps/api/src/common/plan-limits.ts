import { PlanTier } from '@prisma/client';

/** 오류 문구에 쓰는 요금제 이름 — 내부 값(starter)을 그대로 보이지 않는다(T-198). 요금제 창(web `plan.name.*` ko)과 같은 이름 */
export function planLabel(plan: PlanTier): string {
  return { starter: '스타터', pro: '프로', enterprise: '엔터프라이즈' }[plan] ?? plan;
}

/** 정의서/제품 정책: 플랜별 규정 개수 상한 (starter는 소규모 기관 기준) */
export function maxPoliciesForPlan(plan: PlanTier): number {
  switch (plan) {
    case 'starter':
      return 5;
    case 'pro':
      return 10_000;
    case 'enterprise':
      return 1_000_000;
    default:
      return 5;
  }
}

export function maxUsersForPlan(plan: PlanTier): number {
  switch (plan) {
    case 'starter':
      return 10;
    case 'pro':
      return 50;
    case 'enterprise':
      return 1_000_000;
    default:
      return 10;
  }
}
