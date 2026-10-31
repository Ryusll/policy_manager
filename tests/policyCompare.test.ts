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
