import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

export const ROLES_KEY = 'roles';
export const Roles = (...roles: string[]) => SetMetadata(ROLES_KEY, roles);

export const PLATFORM_ROLES_KEY = 'platformRoles';
export const PlatformRoles = (...roles: string[]) => SetMetadata(PLATFORM_ROLES_KEY, roles);

export const MIN_PLAN_KEY = 'minPlan';
export const MinPlan = (plan: 'starter' | 'pro' | 'enterprise') =>
  SetMetadata(MIN_PLAN_KEY, plan);