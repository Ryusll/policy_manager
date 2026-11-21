import { describe, it, expect } from 'vitest';
import {
  buildComparisonRows,
  type CompareArticleInput,
} from '../apps/api/src/policies/policy-compare';

const art = (over: Partial<CompareArticleInput> & { id: string }): CompareArticleInput => ({
  number: 1,
  clauseNumber: null,
  itemNumber: null,
  title: '',
  content: '',
  effectiveDate: null,
  ...over,
});

describe('buildComparisonRows', () => {
  it('신설·삭제·개정·동일을 구분한다', () => {
    const before = [
      art({ id: 'a1', number: 1, title: '목적', content: '이 규정은 A를 정한다.' }),
      art({ id: 'a2', number: 2, title: '적용범위', content: '전 임직원에게 적용한다.' }),
      art({ id: 'a3', number: 3, title: '폐지될 조', content: '삭제 예정.' }),
    ];
    const after = [
      art({ id: 'a1', number: 1, title: '목적', content: '이 규정은 A와 B를 정한다.' }),
      art({ id: 'a2', number: 2, title: '적용범위', content: '전 임직원에게 적용한다.' }),
      art({ id: 'a4', number: 4, title: '신설 조', content: '새로 생겼다.' }),
    ];

    const { rows, summary } = buildComparisonRows(before, after);
    const byId = Object.fromEntries(rows.map((r) => [r.articleId, r.kind]));

    expect(byId.a1).toBe('changed');
    expect(byId.a2).toBe('same');
    expect(byId.a3).toBe('removed');
    expect(byId.a4).toBe('added');
    expect(summary).toEqual({ added: 1, removed: 1, changed: 1, same: 1 });
  });

  it('조 → 항 → 목 순으로 정렬한다', () => {
    const rows = buildComparisonRows(
      [],
      [
        art({ id: 'c', number: 2, clauseNumber: 1, itemNumber: 1 }),
        art({ id: 'a', number: 1 }),
        art({ id: 'd', number: 2 }),
        art({ id: 'b', number: 2, clauseNumber: 1 }),
      ],
    ).rows;
    expect(rows.map((r) => r.articleId)).toEqual(['a', 'd', 'b', 'c']);
  });

  it('공백·줄바꿈 차이만으로는 개정으로 보지 않는다', () => {
    const { rows } = buildComparisonRows(
      [art({ id: 'a1', content: '이 규정은  A를 정한다.\n' })],
      [art({ id: 'a1', content: '이 규정은 A를 정한다.' })],
    );
    expect(rows[0].kind).toBe('same');
  });

  it('본문이 같아도 제목이 바뀌면 개정으로 본다', () => {
    const { rows } = buildComparisonRows(
      [art({ id: 'a1', title: '목적', content: '같은 본문' })],
      [art({ id: 'a1', title: '목적 및 적용', content: '같은 본문' })],
    );
    expect(rows[0].kind).toBe('changed');
    expect(rows[0].titleChanged).toBe(true);
  });

  it('개정된 조문에만 낱말 diff를 채운다', () => {
    const { rows } = buildComparisonRows(
      [art({ id: 'a1', content: '이 규정은 A를 정한다.' })],
      [art({ id: 'a1', content: '이 규정은 B를 정한다.' })],
    );
    const parts = rows[0].diff!;
    expect(parts).not.toBeNull();
    expect(parts.some((p) => p.removed && p.value.includes('A'))).toBe(true);
    expect(parts.some((p) => p.added && p.value.includes('B'))).toBe(true);
    // 안 바뀐 부분은 표시 플래그가 없어야 한다
    expect(parts.some((p) => !p.added && !p.removed)).toBe(true);
  });

  it('조 번호가 바뀌어도 같은 조문으로 짝짓는다 (id 기준)', () => {
    // 개정으로 제3조가 제2조로 당겨진 경우. 번호로 맞추면 엉뚱한 조문끼리 비교된다.
    const { rows } = buildComparisonRows(
      [art({ id: 'a1', number: 3, content: '원래 제3조' })],
      [art({ id: 'a1', number: 2, content: '이제 제2조' })],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].kind).toBe('changed');
    expect(rows[0].number).toBe(2); // 표기는 신조문 기준
  });

  it('삭제된 조문은 구조문 기준 위치로 표기한다', () => {
    const { rows } = buildComparisonRows([art({ id: 'x', number: 7, content: '삭제됨' })], []);
    expect(rows[0].kind).toBe('removed');
    expect(rows[0].number).toBe(7);
    expect(rows[0].after).toBeNull();
  });

  it('양쪽이 비면 빈 결과', () => {
    const { rows, summary } = buildComparisonRows([], []);
    expect(rows).toEqual([]);
    expect(summary).toEqual({ added: 0, removed: 0, changed: 0, same: 0 });
  });
});

describe('조 머리 행의 제목은 겉 괄호를 벗겨 견준다 (T-229)', () => {
  it('조 머리 행의 (목적)·목적은 같은 제목이라 변동 없음, 항 부제는 그대로 견준다', () => {
    const { rows } = buildComparisonRows(
      [art({ id: 'jo', number: 1, title: '(목적)', content: 'A' }), art({ id: 'hang', number: 1, clauseNumber: 1, title: '(부제)', content: 'B' })],
      [art({ id: 'jo', number: 1, title: '목적', content: 'A' }), art({ id: 'hang', number: 1, clauseNumber: 1, title: '부제', content: 'B' })],
    );
    const byId = Object.fromEntries(rows.map((r) => [r.articleId, r]));
    expect([byId.jo.kind, byId.jo.titleChanged]).toEqual(['same', false]);
    // 항의 부제는 칸 제목 줄에 저장값 그대로 보이므로 괄호도 바뀐 것이다
    expect([byId.hang.kind, byId.hang.titleChanged]).toEqual(['changed', true]);
  });
});

describe('구조문 날짜의 위치 movedFrom (T-229)', () => {
  it('번호가 바뀐 행은 구조문 날짜의 위치를 함께 준다 — 조·가지·항·목 어느 칸이 바뀌어도', () => {
    const { rows } = buildComparisonRows(
      [
        art({ id: 'jo', number: 5, title: '목적', content: '' }),
        art({ id: 'hang', number: 5, clauseNumber: 2, content: '둘째 항' }),
        art({ id: 'branch', number: 3, branchNumber: 2, content: '가지 조' }),
      ],
      [
        art({ id: 'jo', number: 6, title: '목적', content: '' }),
        art({ id: 'hang', number: 6, clauseNumber: 3, content: '둘째 항' }),
        art({ id: 'branch', number: 4, content: '가지 조' }),
      ],
    );
    const byId = Object.fromEntries(rows.map((r) => [r.articleId, r]));
    expect(byId.jo.movedFrom).toEqual({ number: 5, branchNumber: null, clauseNumber: null, itemNumber: null });
    expect(byId.hang.movedFrom).toEqual({ number: 5, branchNumber: null, clauseNumber: 2, itemNumber: null });
    expect(byId.branch.movedFrom).toEqual({ number: 3, branchNumber: 2, clauseNumber: null, itemNumber: null });
    // 표기 위치는 그대로 신조문 기준이고, 본문이 같으면 여전히 변동 없음이다(번호만 바뀐 것은 개정으로 세지 않는다)
    expect(byId.hang).toMatchObject({ number: 6, clauseNumber: 3, kind: 'same' });
  });

  it('자리가 그대로인 행·신설·삭제 행에는 movedFrom 이 없다', () => {
    const { rows } = buildComparisonRows(
      [
        art({ id: 'keep', number: 1, clauseNumber: 1, content: '옛 글' }),
        art({ id: 'gone', number: 2, content: '삭제됨' }),
        art({ id: 'nullBranch', number: 3, branchNumber: null, content: '같다' }),
      ],
      [
        art({ id: 'keep', number: 1, clauseNumber: 1, content: '새 글' }),
        art({ id: 'new', number: 2, content: '신설' }),
        art({ id: 'nullBranch', number: 3, branchNumber: 0, content: '같다' }),
      ],
    );
    for (const row of rows) expect(row).not.toHaveProperty('movedFrom');
  });
});
