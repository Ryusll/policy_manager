import { PlanTier } from '@prisma/client';

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
