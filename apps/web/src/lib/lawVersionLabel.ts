import type { LawVersionSummary } from '../api/laws';

type Translate = (key: string, vars?: Record<string, string | number>) => string;

/** "법률 제21700호" — 어느 판의 개정인가(T-150). 공포번호가 없으면 null */
export function lawVersionLabel(v: Pick<LawVersionSummary, 'lawType' | 'promulgationNo'> | null | undefined, t: Translate): string | null {
  if (!v?.promulgationNo) return null;
  return t('lawVersion.label', { type: v.lawType ?? '', no: v.promulgationNo }).trim();
}
