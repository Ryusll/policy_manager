import type { LawVersionSummary } from '../api/laws';

type Translate = (key: string, vars?: Record<string, string | number>) => string;

/** "법률 제21700호" — 어느 판의 개정인가(T-150). 공포번호가 없으면 null */
export function lawVersionLabel(v: Pick<LawVersionSummary, 'lawType' | 'promulgationNo'> | null | undefined, t: Translate): string | null {
  if (!v?.promulgationNo) return null;
  return t('lawVersion.label', { type: v.lawType ?? '', no: v.promulgationNo }).trim();
}

/**
 * 현행 판의 시행일 — 단계 시행 판은 오늘까지 시작된 마지막 단계일, 단계 기록이 없거나 시작된 단계가 없으면 본문 시행일.
 * 단계 시행 판의 본문 시행일은 뒤 단계일 수 있어 그대로 찍으면 지금 시행 중인 판에 미래 날짜가 붙는다(T-150 검토)
 */
export function currentStageDate(v: Pick<LawVersionSummary, 'effectiveDate' | 'stageEffectiveDates'>, today: string): string | null {
  const started = [...v.stageEffectiveDates].sort().filter((d) => d <= today);
  return started.length ? started[started.length - 1] : v.effectiveDate;
}
