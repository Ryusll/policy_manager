/**
 * 조마다 다른 시행일 표기(T-144, PAT-06) — API 의 `effectiveNotes`. 법제처는 구조화된 조문시행일자를 늘 판 시행일과 같게 주고,
 * 조마다 다른 날은 `[시행일: 2027.1.1]` 글자 표기로만 준다(대부분 조의 일부). 계획용 날짜는 바꾸지 않고 알려 주기만 한다.
 */
export type EffectiveNote = {
  date: string;
  scope: 'partial' | 'unknown';
  scopeText: string;
  source: string;
  raw: string;
};

/**
 * `previous` — 이번 개정으로 표기가 달라졌을 때 변경 전 판의 표기(없어졌으면 notes 는 []).
 * `articleGone` — 이번 개정으로 조항이 사라졌다(notes 는 사라지기 전 판의 표기)
 */
export type EventEffectiveNotes = { notes: EffectiveNote[]; inherited: boolean; previous?: EffectiveNote[]; articleGone?: true };

type T = (key: string, vars?: Record<string, string | number>) => string;

/** 한 줄 설명 — 일부로 확인된 것은 "일부는 …", 범위를 모르면 "범위 확인 필요". 범위 문구가 있으면 괄호로 */
export function describeEffectiveNote(n: EffectiveNote, t: T): string {
  const head = t(n.scope === 'partial' ? 'effectiveNotes.partial' : 'effectiveNotes.unknown', { date: n.date });
  return n.scopeText ? t('effectiveNotes.withScope', { head, scope: n.scopeText }) : head;
}

/** 목록 줄의 짧은 표시용 — 날짜만(변경 전 표기 포함) */
export function effectiveNotesDates(info: EventEffectiveNotes | null | undefined): string {
  return [...new Set([...(info?.notes ?? []), ...(info?.previous ?? [])].map((n) => n.date))].join(', ');
}

/** 법령 조항 행의 "지금" 표기 → 안내 상자 모양. 항·호 행의 표기는 상위 조의 것이다. 없으면 null */
export function lawArticleEffectiveNotes(a: { nodeKey: string; effectiveNotes?: EffectiveNote[] | null }): EventEffectiveNotes | null {
  return a.effectiveNotes?.length ? { notes: a.effectiveNotes, inherited: !a.nodeKey.endsWith('//') } : null;
}
