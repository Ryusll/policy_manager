import { describe, it, expect } from 'vitest';
import {
  buildThreeWayRows,
  extractUpperRefs,
  type ThreeWayArticle,
} from '../apps/api/src/policies/policy-three-way';

const art = (
  id: string,
  number: number,
  title: string,
  content = '',
  over: Partial<ThreeWayArticle> = {},
): ThreeWayArticle => ({
  id,
  number,
  clauseNumber: null,
  itemNumber: null,
  title,
  content,
  ...over,
});

const pol = (id: string, level: number) => ({ id, code: id, title: id, level });

describe('extractUpperRefs — 상위 규정 인용 추출', () => {
  it('상위를 가리키는 말이 붙은 인용만 잡는다', () => {
    expect(extractUpperRefs('규정 제5조에 따라')).toEqual([5]);
    expect(extractUpperRefs('인사관리규정 제12조의2에서 정한')).toEqual([12]);
    expect(extractUpperRefs('법 제3조 및 영 제7조')).toEqual([3, 7]);
  });

  it('맨 "제5조"는 자기 문서를 가리키므로 짝짓지 않는다', () => {
    // 억지로 엮으면 엉뚱한 조문이 나란히 놓여 표 전체를 못 믿게 된다.
    expect(extractUpperRefs('제5조에서 정한 절차에 따른다')).toEqual([]);
    expect(extractUpperRefs('세칙 제3조를 준용한다')).toEqual([]);
  });

  it('같은 조를 여러 번 인용해도 한 번만 센다', () => {
    expect(extractUpperRefs('규정 제5조, 규정 제5조제2항')).toEqual([5]);
  });

  it('빈 문자열은 빈 배열', () => {
    expect(extractUpperRefs('')).toEqual([]);
  });
});

describe('buildThreeWayRows — 규정·세칙·지침 3단', () => {
  const base = [art('b1', 1, '목적'), art('b2', 2, '적용범위'), art('b3', 3, '채용')];

  it('세칙·지침을 인용한 상위 조문 옆에 붙인다', () => {
    const { rows, matchedCount } = buildThreeWayRows(base, [
      { policy: pol('세칙', 1), articles: [art('s1', 1, '채용 절차', '규정 제3조에 따라 절차를 정한다.')] },
      { policy: pol('지침', 2), articles: [art('g1', 1, '서류 심사', '인사관리규정 제3조의 채용에 관하여')] },
    ]);

    expect(matchedCount).toBe(2);
    const row3 = rows.find((r) => r.number === 3)!;
    expect(row3.related.map((r) => [r.level, r.article.id])).toEqual([
      [1, 's1'],
      [2, 'g1'],
    ]);
    expect(rows.find((r) => r.number === 1)!.related).toEqual([]);
  });

  it('짝을 못 찾은 하위 조문은 버리지 않고 "연결 안 됨"으로 모은다', () => {
    const { rows, unmatched, matchedCount } = buildThreeWayRows(base, [
      { policy: pol('세칙', 1), articles: [art('s1', 1, '총칙', '이 세칙은 …'), art('s2', 2, '기타', '제9조 참조')] },
    ]);

    expect(matchedCount).toBe(0);
    expect(rows.every((r) => r.related.length === 0)).toBe(true);
    expect(unmatched).toHaveLength(1);
    expect(unmatched[0].related.map((r) => r.article.id)).toEqual(['s1', 's2']);
  });

  it('없는 조를 인용하면 연결하지 않는다', () => {
    const { rows, unmatched } = buildThreeWayRows(base, [
      { policy: pol('세칙', 1), articles: [art('s1', 1, '부칙', '규정 제99조에 따라')] },
    ]);
    expect(rows.every((r) => r.related.length === 0)).toBe(true);
    expect(unmatched[0].related).toHaveLength(1);
  });

  it('기준은 조 루트만 세운다 (항·목은 조에 딸려 읽는다)', () => {
    const withClause = [...base, art('b2h', 2, '', '항 본문', { clauseNumber: 1 })];
    const { rows } = buildThreeWayRows(withClause, []);
    expect(rows.map((r) => r.number)).toEqual([1, 2, 3]);
  });

  it('하위의 항·목도 짝짓기 대상이 아니다', () => {
    const { matchedCount, unmatched } = buildThreeWayRows(base, [
      {
        policy: pol('세칙', 1),
        articles: [art('s1h', 1, '', '규정 제3조에 따라', { clauseNumber: 1 })],
      },
    ]);
    expect(matchedCount).toBe(0);
    expect(unmatched).toHaveLength(0);
  });

  it('하위 규정이 없으면 기준 조문만 나온다', () => {
    const { rows, unmatched } = buildThreeWayRows(base, []);
    expect(rows).toHaveLength(3);
    expect(unmatched).toEqual([]);
  });
});
