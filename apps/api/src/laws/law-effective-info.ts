import { EFFECTIVE_NOTES_VERSION, readEffectiveNotes, sameEffectiveMeaning, type EffectiveNote } from '../common/effective-notes';

/**
 * 변경 이벤트에 남기는 조별 시행일 표기 스냅샷 (T-144, PAT-06) — DB 를 모르는 순수 함수.
 *
 * 조항 행에는 "지금" 표기만 있어, 이후 판에서 표기가 바뀌거나 조문이 사라지면 그때 어땠는지 알 수 없다. 이벤트에 앞뒤를 둔다.
 */
export type EventEffectiveInfo = {
  /** 이 이벤트를 만든 판(MST) */
  mst: string;
  /** 항·호 행의 이벤트 — 표기는 **상위 조의 것**이다(그 항·호의 확정 시행일이 아니다) */
  inherited: boolean;
  /** 변경 전 판의 표기. null = 그때는 수집하지 않았다(또는 신설 조항) */
  before: EffectiveNote[] | null;
  /** 변경 후 판의 표기. null = 사라진 조항 */
  after: EffectiveNote[] | null;
  /** after 를 읽은 규칙의 판(`EFFECTIVE_NOTES_VERSION`) */
  rules: number;
  /** before 를 읽은 규칙의 판(그때 법령 행의 판). null = 모름. rules 와 다르면 앞뒤 차이가 법 때문인지 규칙 때문인지 몰라 견주지 않는다 */
  beforeRules: number | null;
};

/** `5//` 는 조, `5/1/`·`5/1/2` 는 항·호 */
export const isArticleLevelNodeKey = (nodeKey: string) => nodeKey.endsWith('//');

/** 양쪽 다 보여 줄 표기가 없으면 null — 칸을 채우지 않는다 */
export function eventEffectiveInfo(args: {
  nodeKey: string;
  mst: string;
  before: EffectiveNote[] | null;
  after: EffectiveNote[] | null;
  /** 저장 전 법령 행의 읽기 판 */
  beforeRules: number | null;
}): EventEffectiveInfo | null {
  if (!args.before?.length && !args.after?.length) return null;
  return {
    mst: args.mst,
    inherited: !isArticleLevelNodeKey(args.nodeKey),
    before: args.before,
    after: args.after,
    rules: EFFECTIVE_NOTES_VERSION,
    beforeRules: args.beforeRules,
  };
}

export type PresentedEffectiveNotes = {
  /** 지금 보여 줄 표기 — 변경 후 판의 것, 사라진 조항이면 변경 전 판의 것 */
  notes: EffectiveNote[];
  inherited: boolean;
  /** 이번 개정으로 조항이 사라졌다 — notes 는 사라지기 전 판의 표기다(지금 있는 표기가 아니다) */
  articleGone?: true;
  /**
   * 이번 개정으로 표기가 달라졌으면 변경 전 판의 표기(없어진 경우 notes 는 []). 날짜·범위 문구가 같거나, 그때 수집하지 않았거나,
   * 앞뒤를 다른 읽기 규칙으로 읽었으면 없다 — 규칙이 바뀐 것을 "이번 개정으로 바뀌었다"고 말하지 않는다
   */
  previous?: EffectiveNote[];
};

/** 화면·API 에 내보내는 모양. 보여 줄 것이 없으면 null */
export function presentEventEffective(value: unknown): PresentedEffectiveNotes | null {
  if (!value || typeof value !== 'object') return null;
  const info = value as Partial<EventEffectiveInfo>;
  const before = readEffectiveNotes(info.before);
  const after = readEffectiveNotes(info.after);
  const inherited = info.inherited === true;
  if (!after) return before?.length ? { notes: before, inherited, articleGone: true } : null;
  // 예고됐던 별도 시행일이 이번 개정에서 없어지거나 바뀌면(2027 → 2028) 그것도 알린다
  const sameRules = typeof info.rules === 'number' && info.rules === info.beforeRules;
  const previous = sameRules && before?.length && !sameEffectiveMeaning(before, after) ? before : undefined;
  if (!after.length && !previous) return null;
  return { notes: after, inherited, ...(previous ? { previous } : {}) };
}
