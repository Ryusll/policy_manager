import { describe, it, expect } from 'vitest';
import {
  diffLawText,
  isRepealedLawText,
  splitSentences,
  stripLawAnnotations,
  tokenize,
} from '../apps/api/src/amendments/amendment-text';

const pick = (before: string, after: string) =>
  diffLawText(before, after).map(({ kind, before: b, after: a }) => ({ kind, before: b, after: a }));

describe('stripLawAnnotations — 개정 연혁 표기는 내용이 아니다 (T-106)', () => {
  it('꺾쇠·대괄호 연혁 표기를 뗀다', () => {
    expect(stripLawAnnotations('자동차는 다음과 같이 구분한다. <개정 2011.5.24>')).toBe('자동차는 다음과 같이 구분한다.');
    expect(stripLawAnnotations('주어야 한다. <개정 2012. 2. 1., 2020. 5. 26.>')).toBe('주어야 한다.');
    expect(stripLawAnnotations('정한다. [본조신설 2012.2.1]')).toBe('정한다.');
    expect(stripLawAnnotations('[전문개정 2008.3.28] 정한다.')).toBe('정한다.');
    expect(stripLawAnnotations('정한다. [종전 제5조는 제6조로 이동 <2012.2.1>]')).toBe('정한다.');
  });

  it('"삭제 <날짜>"는 날짜만 떼고 "삭제"는 남긴다 — 조항이 삭제됐다는 내용이다', () => {
    expect(stripLawAnnotations('삭제 <2012.2.1>')).toBe('삭제');
    expect(isRepealedLawText('삭제 <2012. 2. 1.>')).toBe(true);
    expect(isRepealedLawText('삭제<2012.2.1>')).toBe(true);
    expect(isRepealedLawText('삭제된 서류를 보관한다.')).toBe(false);
  });
});

describe('diffLawText — 법령 전후 비교 (특허 도 10 단계 1021)', () => {
  it('연혁 표기만 바뀐 개정은 변경이 없다', () => {
    expect(
      diffLawText('15일의 유급휴가를 주어야 한다. <개정 2012.2.1>', '15일의 유급휴가를 주어야 한다. <개정 2012.2.1, 2027.1.1>'),
    ).toEqual([]);
  });

  it('공백만 다른 곳은 변경이 아니다', () => {
    expect(diffLawText('유급휴가를  주어야 한다.', '유급휴가를 주어야 한다.')).toEqual([]);
  });

  it('기준값 — 숫자에 단위를 붙여 값 표현으로 만든다', () => {
    expect(pick('근로자에게 15일의 유급휴가를 주어야 한다.', '근로자에게 20일의 유급휴가를 주어야 한다.')).toEqual([
      { kind: 'value', before: '15일', after: '20일' },
    ]);
    expect(pick('1년간 80퍼센트 이상 출근한', '1년간 90퍼센트 이상 출근한')).toEqual([
      { kind: 'value', before: '80퍼센트', after: '90퍼센트' },
    ]);
    expect(pick('3개월 이내에', '6개월 이내에')).toEqual([{ kind: 'value', before: '3개월', after: '6개월' }]);
  });

  it('기준값 — 단위가 함께 바뀐 경우("5천만원"→"1억원", "3개월"→"90일")', () => {
    expect(pick('5천만원 이하의 과태료', '1억원 이하의 과태료')).toEqual([
      { kind: 'value', before: '5천만원', after: '1억원' },
    ]);
    expect(pick('3개월 이내', '90일 이내')).toEqual([{ kind: 'value', before: '3개월', after: '90일' }]);
  });

  it('분수 — "100분의 50"은 한 값이다. "분의"를 시간 단위 "분"으로 읽지 않는다', () => {
    expect(pick('통상임금의 100분의 50 이상을 가산', '통상임금의 100분의 60 이상을 가산')).toEqual([
      { kind: 'value', before: '100분의 50', after: '100분의 60' },
    ]);
    expect(pick('통상임금의 100분의 50 이상', '통상임금의 3분의 1 이상')).toEqual([
      { kind: 'value', before: '100분의 50', after: '3분의 1' },
    ]);
  });

  it('단위 없는 맨숫자는 무엇의 값인지 몰라 값으로 보지 않는다', () => {
    expect(pick('점수 50 이상인 자', '점수 60 이상인 자')[0].kind).toBe('sentence');
  });

  it('조문 번호 안의 숫자("제2항"→"제3항")는 기준값이 아니라 조문 참조 변경이다', () => {
    expect(pick('제2항에 따라 신고한다.', '제3항에 따라 신고한다.')).toEqual([
      { kind: 'reference', before: '2', after: '3' },
    ]);
  });

  it('용어 — 공통 조사를 떼어 낱말만 얻는다', () => {
    expect(pick('사업주는 근로자에게 알려야 한다.', '사업주는 노동자에게 알려야 한다.')).toEqual([
      { kind: 'term', before: '근로자', after: '노동자' },
    ]);
  });

  it('용어 — 받침 때문에 짝이 바뀐 조사도 뗀다, 떼고 한 글자만 남으면 조사가 아니다', () => {
    expect(pick('사업주는 신고한다.', '사용인은 신고한다.')).toEqual([{ kind: 'term', before: '사업주', after: '사용인' }]);
    expect(pick('사업주로 본다.', '사용인으로 본다.')).toEqual([{ kind: 'term', before: '사업주', after: '사용인' }]);
    expect(pick('작가가 쓴다.', '화가가 쓴다.')).toEqual([{ kind: 'term', before: '작가', after: '화가' }]);
  });

  it('용어 — 조사가 아닌 공통 꼬리는 떼지 않는다("근로자대표"를 "근로자"로 넓히지 않는다)', () => {
    expect(pick('근로자대표와 협의한다.', '노동자대표와 협의한다.')).toEqual([
      { kind: 'term', before: '근로자대표', after: '노동자대표' },
    ]);
  });

  it('문구 추가·삭제와 문장 구조 변경', () => {
    const added = pick('휴가를 주어야 한다.', '휴가를 주어야 한다. 다만, 근로자가 원하면 그러하지 아니하다.');
    expect(added).toHaveLength(1);
    expect(added[0].kind).toBe('insert');
    expect(added[0].after).toBe('다만, 근로자가 원하면 그러하지 아니하다.');

    const removed = pick('휴가를 주어야 한다. 다만, 근로자가 원하면 그러하지 아니하다.', '휴가를 주어야 한다.');
    expect(removed[0].kind).toBe('delete');

    const rewritten = pick('사용자는 휴가를 주어야 한다.', '사용자는 근로자의 청구가 있으면 휴가를 부여하여야 하며 이를 기록한다.');
    expect(rewritten.some((c) => c.kind === 'sentence' || c.kind === 'insert')).toBe(true);
  });

  it('변경마다 앞뒤 문맥을 남긴다', () => {
    const [c] = diffLawText('근로자에게 15일의 유급휴가를', '근로자에게 20일의 유급휴가를');
    expect(c.contextBefore).toBe('근로자에게 ');
    expect(c.contextAfter.startsWith('일의')).toBe(true);
  });
});

describe('tokenize·splitSentences', () => {
  it('토큰 위치가 원문 위치와 맞는다', () => {
    const text = '제60조 15일의 유급휴가';
    for (const t of tokenize(text)) expect(text.slice(t.start, t.end)).toBe(t.text);
    expect(tokenize('15일의').map((t) => t.kind)).toEqual(['num', 'word']);
  });

  it('문장은 마침표 뒤 공백·줄바꿈에서 자른다', () => {
    expect(splitSentences('가는 나다. 다는 라다.\n마는 바다')).toEqual(['가는 나다.', '다는 라다.', '마는 바다']);
  });
});
