import { describe, it, expect } from 'vitest';
import {
  formatArticleJo,
  formatClauseHang,
  formatItemMok,
  sortArticlesForToc,
  groupArticlesByJo,
  flattenJoGroup,
} from '../apps/web/src/lib/legalArticleLabel';
import { nextJoNumberForPolicy } from '../apps/web/src/lib/articleStructure';

describe('법령형 표기', () => {
  it('조는 제N조, 항은 원문자, 목은 N.', () => {
    expect(formatArticleJo(3)).toBe('제3조');
    expect(formatClauseHang(1)).toBe('①');
    expect(formatClauseHang(20)).toBe('⑳');
    expect(formatItemMok(2)).toBe('2.');
  });

  it('원문자 범위를 넘으면 괄호 표기로 떨어진다', () => {
    expect(formatClauseHang(21)).toBe('(21)');
  });
});

describe('목차 정렬', () => {
  it('같은 조에서 본문 → 항 → 목 순으로 온다', () => {
    const rows = [
      { number: 1, clauseNumber: 1, itemNumber: 1 },
      { number: 1, clauseNumber: null, itemNumber: null },
      { number: 1, clauseNumber: 1, itemNumber: null },
    ];
    const sorted = [...rows].sort(sortArticlesForToc);
    expect(sorted.map((r) => [r.clauseNumber, r.itemNumber])).toEqual([
      [null, null],
      [1, null],
      [1, 1],
    ]);
  });
});

describe('groupArticlesByJo / flattenJoGroup', () => {
  it('평탄화 결과가 원본 행 수와 같다 (중복·누락 없음)', () => {
    const rows = [
      { id: 'a', number: 1, clauseNumber: null, itemNumber: null },
      { id: 'b', number: 1, clauseNumber: 1, itemNumber: null },
      { id: 'c', number: 1, clauseNumber: 1, itemNumber: 1 },
      { id: 'd', number: 2, clauseNumber: null, itemNumber: null },
    ];
    const groups = groupArticlesByJo(rows);
    const flat = groups.flatMap(flattenJoGroup);
    expect(flat).toHaveLength(rows.length);
    expect(new Set(flat.map((r: any) => r.id)).size).toBe(rows.length);
  });
});

describe('nextJoNumberForPolicy', () => {
  it('조 번호는 장을 넘어 이어진다 (장마다 1로 리셋되지 않음)', () => {
    const chapters = [
      { articles: [{ number: 1 }, { number: 2 }] },
      { articles: [{ number: 3 }, { number: 4 }] },
    ];
    expect(nextJoNumberForPolicy(chapters)).toBe(5);
  });

  it('조문이 없으면 1부터', () => {
    expect(nextJoNumberForPolicy([])).toBe(1);
    expect(nextJoNumberForPolicy(undefined)).toBe(1);
  });
});
