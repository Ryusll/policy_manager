import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { MIN_PLAN_KEY } from './decorators';

type PlanTier = 'starter' | 'pro' | 'enterprise';

const PLAN_ORDER: Record<PlanTier, number> = {
  starter: 1,
  pro: 2,
  enterprise: 3,
};

function hasPlanAtLeast(current: PlanTier, required: PlanTier): boolean {
  return PLAN_ORDER[current] >= PLAN_ORDER[required];
}

@Injectable()
export class PlanGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredPlan = this.reflector.getAllAndOverride<PlanTier | undefined>(MIN_PLAN_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!requiredPlan) return true;

    const { user } = context.switchToHttp().getRequest();
    const currentPlan = user?.tenant?.plan as PlanTier | undefined;
    if (!currentPlan) throw new ForbiddenException('Plan information is missing');
    if (!hasPlanAtLeast(currentPlan, requiredPlan)) {
      throw new ForbiddenException(`This feature requires ${requiredPlan} plan or higher`);
    }
    return true;
  }
}
