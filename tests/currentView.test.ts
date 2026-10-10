import { describe, it, expect } from 'vitest';
import { buildCurrentChapters, currentStateOf, type CurrentState } from '../apps/api/src/policies/current-view';

/**
 * T-127 ② 규정 "현재" 화면의 조립 — 오늘 시점 조회와 같은 계층(얼린 계층, T-110 ②)에 편집 화면에 필요한 조문을 더한다.
 */
const today = new Date(Date.UTC(2026, 9, 10));
const day = (s: string) => new Date(`${s}T00:00:00.000Z`);

type V = { status: string; structure?: unknown; repealedOn: Date | null };
let seq = 0;
const art = (
  chapterId: string,
  number: number,
  state: CurrentState,
  o: {
    clause?: number;
    item?: number;
    title?: string;
    frozen?: { chapter?: string; chapterNumber?: number; number: number; clause?: number; title?: string };
    repealedOn?: Date;
    /** 시행 예정 버전이 있나 — 얼린 계층이 있으면 기본은 있음(미래 시행 묶음의 묶음 버전) */
    pending?: boolean;
  } = {},
) => {
  const versions: V[] = [];
  if (state === 'in_force' || state === 'repealed') {
    versions.push({
      status: 'archived',
      repealedOn: o.repealedOn ?? null,
      structure: o.frozen
        ? {
            v: 1,
            chapter: { id: o.frozen.chapter ?? chapterId, number: o.frozen.chapterNumber ?? 1, title: '그때 장', hidden: false },
            section: null,
            number: o.frozen.number,
            branchNumber: null,
            clauseNumber: o.frozen.clause ?? o.clause ?? null,
            itemNumber: null,
            title: o.frozen.title ?? o.title ?? '',
          }
        : null,
    });
  }
  return {
    id: `a${++seq}`,
    chapterId,
    sectionId: null,
    number,
    branchNumber: null,
    clauseNumber: o.clause ?? null,
    itemNumber: null,
    title: o.title ?? '',
    versions,
    currentState: state,
    hasScheduled: o.pending ?? (!!o.frozen || state === 'scheduled'),
  };
};
const ch = (id: string, number: number, articles: ReturnType<typeof art>[]) => ({
  id,
  number,
  title: `장${number}`,
  suppressHeader: false,
  sections: [],
  articles,
});
const labels = (chapters: { id: string; articles: { number: number; clauseNumber: number | null; id: string }[] }[]) =>
  chapters.map((c) => `${c.id}:[${c.articles.map((a) => `${a.number}${a.clauseNumber ? `-${a.clauseNumber}` : ''}`).join(',')}]`);

describe('현재 상태', () => {
  it('오늘 고른 버전과 시행 예정 유무로 정한다', () => {
    expect(currentStateOf({ repealedOn: null }, today, true)).toBe('in_force');
    expect(currentStateOf({ repealedOn: day('2026-10-10') }, today, false)).toBe('repealed');
    expect(currentStateOf({ repealedOn: day('2026-10-11') }, today, false)).toBe('in_force'); // 폐지 예정일 전
    expect(currentStateOf(null, today, true)).toBe('scheduled');
    expect(currentStateOf(undefined, today, false)).toBe('none');
  });
});

describe('현재 화면 조립', () => {
  it('얼린 계층이 없으면 지금 자리 그대로 — 시행 예정 신설·초안 조문도 지금 자리에 남는다', () => {
    const a1 = art('c1', 1, 'in_force');
    const a2 = art('c1', 2, 'scheduled'); // 미래 시행일로 넣은 새 조문
    const a3 = art('c1', 3, 'none'); // 초안만
    const { chapters, excluded } = buildCurrentChapters([ch('c1', 1, [a1, a2, a3])]);
    expect(labels(chapters)).toEqual(['c1:[1,2,3]']);
    expect(excluded).toEqual([]);
    expect(chapters[0].articles[0]).toMatchObject({ liveChapterId: 'c1', liveNumber: 1 });
  });

  it('미래 시행 묶음이 옮긴 조문은 오늘의 자리로, 그 자리를 차지한 새 조문은 시행 예정으로 뺀다(T-110 ②)', () => {
    const ids1 = art('c1', 1, 'in_force');
    const ids2 = art('c1', 3, 'in_force', { frozen: { number: 2 } }); // 지금 행은 제3조, 오늘은 제2조
    const ids3 = art('c1', 4, 'in_force', { frozen: { number: 3 } });
    const fresh = art('c1', 2, 'scheduled'); // 끼어든 새 제2조
    const { chapters, excluded } = buildCurrentChapters([ch('c1', 1, [ids1, fresh, ids2, ids3])]);
    expect(chapters[0].articles.map((a) => [a.id, a.number])).toEqual([
      [ids1.id, 1],
      [ids2.id, 2],
      [ids3.id, 3],
    ]);
    expect(excluded.map((a) => a.id)).toEqual([fresh.id]);
    // 편집은 지금 행 기준 — 지금 자리를 남긴다
    expect(chapters[0].articles[1]).toMatchObject({ liveChapterId: 'c1', liveNumber: 3 });
  });

  it('버전 없는 조 머리는 항이 옮겨진 자리로 따라간다', () => {
    const head = art('c1', 3, 'none', { title: '정의' });
    const clause = art('c1', 3, 'in_force', { clause: 1, frozen: { number: 2, clause: 1 } });
    const { chapters } = buildCurrentChapters([ch('c1', 1, [head, clause])]);
    expect(chapters[0].articles.map((a) => [a.id, a.number, a.clauseNumber])).toEqual([
      [head.id, 2, null],
      [clause.id, 2, 1],
    ]);
  });

  it('폐지 조문은 오늘 시행 중인 조문과 같은 자리면 빠지고, 아니면 남는다', () => {
    const live = art('c1', 2, 'in_force');
    const clash = art('c1', 5, 'repealed', { frozen: { number: 2 }, repealedOn: day('2026-10-01') });
    const alone = art('c1', 7, 'repealed', { repealedOn: day('2026-10-01') });
    const { chapters, excluded } = buildCurrentChapters([ch('c1', 1, [live, clash, alone])]);
    expect(chapters[0].articles.map((a) => a.id)).toEqual([live.id, alone.id]);
    expect(excluded).toEqual([]); // 폐지 조문은 시행 예정 목록에 넣지 않는다
  });

  it('조문이 모두 다른 장으로 가서 빈 장은 감추고, 원래 빈 장은 그대로 둔다', () => {
    // 미래 시행 묶음이 새 장 c2 를 만들고 조문을 옮겼다 — 오늘은 c1 에 있어야 한다
    const moved = art('c2', 2, 'in_force', { frozen: { chapter: 'c1', number: 2 } });
    const stay = art('c1', 1, 'in_force');
    const { chapters } = buildCurrentChapters([ch('c1', 1, [stay]), ch('c2', 2, [moved]), ch('c3', 3, [])]);
    expect(labels(chapters)).toEqual(['c1:[1,2]', 'c3:[]']);
    expect(chapters[0].articles[1]).toMatchObject({ id: moved.id, liveChapterId: 'c2' });
  });

  it('그 뒤에 지워진 장은 그때의 번호·제목으로 다시 세운다', () => {
    const gone = art('c1', 4, 'in_force', { frozen: { chapter: 'old', chapterNumber: 2, number: 4 } });
    const { chapters } = buildCurrentChapters([ch('c1', 1, [art('c1', 1, 'in_force'), gone])]);
    expect(labels(chapters)).toEqual(['c1:[1]', 'old:[4]']);
    expect(chapters[1]).toMatchObject({ number: 2, title: '그때 장' });
    expect(chapters[1].articles[0]).toMatchObject({ liveChapterId: 'c1' });
  });

  it('시행 예정 버전 없이 얼린 값만 남은 조문은 지금 행이 오늘 자리 — 화면 자리와 지금 행이 영영 다르지 않게', () => {
    // 얼린 값은 제2조 "수당"인데 그 뒤 시행될 버전이 없다(지금 행은 제5조 "가족수당")
    const fixed = art('c1', 5, 'in_force', { title: '가족수당', frozen: { number: 2, title: '수당' }, pending: false });
    const { chapters, displaced } = buildCurrentChapters([ch('c1', 1, [fixed])]);
    expect(chapters[0].articles[0]).toMatchObject({ number: 5, title: '가족수당', displaced: false });
    expect(displaced).toBe(0);
  });

  it('오늘 자리가 지금 행과 다른 조문·장을 표시하고 센다 — 이 동안 화면은 구조 편집을 막는다', () => {
    const ids1 = art('c1', 1, 'in_force');
    const ids2 = art('c1', 3, 'in_force', { frozen: { number: 2 } });
    const gone = art('c1', 4, 'in_force', { frozen: { chapter: 'old', chapterNumber: 2, number: 4 } });
    const { chapters, displaced } = buildCurrentChapters([ch('c1', 1, [ids1, ids2, gone])]);
    const all = chapters.flatMap((c) => c.articles);
    expect(all.find((a) => a.id === ids1.id)).toMatchObject({ displaced: false });
    expect(all.find((a) => a.id === ids2.id)).toMatchObject({ displaced: true, number: 2, liveNumber: 3 });
    expect(all.find((a) => a.id === gone.id)).toMatchObject({ displaced: true, liveChapterId: 'c1' });
    expect(chapters.find((c) => c.id === 'old')).toMatchObject({ virtual: true });
    expect(chapters.find((c) => c.id === 'c1')?.virtual).toBeUndefined();
    expect(displaced).toBe(3); // 조문 둘 + 지금은 없는 장 하나
    // 아무것도 옮기지 않았으면 0
    expect(buildCurrentChapters([ch('c1', 1, [art('c1', 1, 'in_force'), art('c1', 2, 'scheduled')])]).displaced).toBe(0);
  });

  it('초안·시행 예정 조문의 버전 목록은 자리 계산 뒤 원래대로 돌려준다', () => {
    const draft = art('c1', 1, 'none');
    draft.versions = [];
    const { chapters } = buildCurrentChapters([ch('c1', 1, [draft])]);
    expect(chapters[0].articles[0].versions).toBe(draft.versions);
  });
});
