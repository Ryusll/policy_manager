import { describe, it, expect } from 'vitest';
import { citationNodeKey, extractLawCitations } from '../apps/api/src/law-links/law-citation';

describe('extractLawCitations', () => {
  it('「」로 감싼 법령명 + 조를 인식한다', () => {
    const out = extractLawCitations('「근로기준법」 제60조에 따라 연차휴가를 부여한다.');
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ lawName: '근로기준법', articleNo: 60, articleBranch: null });
  });

  it('괄호 없이 "OO법 제N조"도 인식한다', () => {
    const out = extractLawCitations('근로기준법 제60조제1항에서 정한 기준에 따른다.');
    expect(out[0]).toMatchObject({ lawName: '근로기준법', articleNo: 60, clauseNo: 1 });
  });

  it('가지번호(의N)가 조·항·호 각 단위에 붙는다', () => {
    const out = extractLawCitations('「산업안전보건법」제38조의2 제3항 제1호');
    expect(out[0]).toMatchObject({
      lawName: '산업안전보건법',
      articleNo: 38,
      articleBranch: 2,
      clauseNo: 3,
      itemNo: 1,
      itemBranch: null,
    });
  });

  it('호의 가지번호도 인식한다', () => {
    const out = extractLawCitations('「근로기준법」 제60조제1항제2호의2');
    expect(out[0]).toMatchObject({ itemNo: 2, itemBranch: 2 });
  });

  it('한 본문에 인용이 여러 번 있으면 전부 잡는다', () => {
    const out = extractLawCitations(
      '「근로기준법」 제60조 및 「근로기준법」 제61조를 준용한다. 「최저임금법」 제6조도 참고.',
    );
    expect(out.map((c) => `${c.lawName} ${c.articleNo}`)).toEqual([
      '근로기준법 60',
      '근로기준법 61',
      '최저임금법 6',
    ]);
  });

  it('법령명이 없거나 "법"으로 끝나지 않으면 잡지 않는다', () => {
    expect(extractLawCitations('제60조를 준용한다.')).toHaveLength(0);
    expect(extractLawCitations('이 규정 제60조에 따른다.')).toHaveLength(0);
  });

  it('본문이 없으면 빈 배열', () => {
    expect(extractLawCitations(null)).toEqual([]);
    expect(extractLawCitations(undefined)).toEqual([]);
    expect(extractLawCitations('')).toEqual([]);
  });

  it('matchedText 에 매칭된 원문 조각이 그대로 담긴다 (근거 문구용)', () => {
    const out = extractLawCitations('회사는 「근로기준법」 제60조제1항을 따른다.');
    expect(out[0].matchedText).toBe('「근로기준법」 제60조제1항');
  });
});

describe('citationNodeKey', () => {
  it('law-rows.ts 의 nodeKey 형식과 정확히 같다', () => {
    // '3의2/1/1의2' — law-rows.test.ts 의 "가지번호는 단위 뒤에 붙는다" 케이스와 같은 값
    expect(
      citationNodeKey({
        lawName: 'x',
        articleNo: 3,
        articleBranch: 2,
        clauseNo: 1,
        itemNo: 1,
        itemBranch: 2,
        matchedText: '',
      }),
    ).toBe('3의2/1/1의2');
  });

  it('조 인용만 있으면 항·호 자리가 빈다', () => {
    expect(
      citationNodeKey({
        lawName: 'x',
        articleNo: 60,
        articleBranch: null,
        clauseNo: null,
        itemNo: null,
        itemBranch: null,
        matchedText: '',
      }),
    ).toBe('60//');
  });
});
