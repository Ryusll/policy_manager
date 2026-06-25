export type PlanTier = 'starter' | 'pro' | 'enterprise';

export function normalizePlan(plan: string | undefined | null): PlanTier {
  if (plan === 'pro' || plan === 'enterprise') return plan;
  return 'starter';
}

export function canCustomizeBranding(plan: string | undefined | null): boolean {
  return normalizePlan(plan) !== 'starter';
}

export function canUseApiIntegration(plan: string | undefined | null): boolean {
  return normalizePlan(plan) === 'enterprise';
}

export function canInviteUsers(plan: string | undefined | null): boolean {
  return normalizePlan(plan) !== 'starter';
}

export function canManagePolicyTemplates(plan: string | undefined | null): boolean {
  return normalizePlan(plan) !== 'starter';
}

export function canUseAdvancedTemplateEditor(plan: string | undefined | null): boolean {
  return normalizePlan(plan) === 'enterprise';
}
