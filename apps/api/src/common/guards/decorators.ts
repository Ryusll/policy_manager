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
export const ALLOW_DURING_PASSWORD_CHANGE_KEY = 'allowDuringPasswordChange';
/** 비밀번호 변경이 필요한 상태에서도 열어 둘 경로 — 변경 자체·로그아웃·내 정보 (T-122) */
export const AllowDuringPasswordChange = () => SetMetadata(ALLOW_DURING_PASSWORD_CHANGE_KEY, true);
