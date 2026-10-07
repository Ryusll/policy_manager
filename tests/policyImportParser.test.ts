import { describe, it, expect } from 'vitest';
import { parsePolicyTextToStructure } from '../apps/web/src/lib/policyImportParser';

/**
 * 규정 등록 › "기존 규정 가져오기"(텍스트 붙여넣기·TXT·DOCX)의 파서.
 * 한국 규정은 본문에 다른 조를 인용하는 문장이 흔해서, 인용을 조 머리로 착각하면
 * 문장 하나가 조문 두 개로 쪼개진다.
 */
const parse = (...lines: string[]) => parsePolicyTextToStructure(lines.join('\n'), 'mixed');
const articles = (...lines: string[]) =>
  parse(...lines).chapters.flatMap((c) => c.articles.map((a) => [a.number, a.title, a.content.trim(), a.branch ?? null]));

describe('기존 규정 가져오기 — 인용을 조로 착각하지 않는다', () => {
  it('문장 가운데 "제38조 제2항"에서 조문을 자르지 않는다', () => {
    expect(articles('제1조(목적) 이 규정은 정관 제38조 제2항이 정하는 바에 따라 정한다.')).toEqual([
      [1, '목적', '이 규정은 정관 제38조 제2항이 정하는 바에 따라 정한다.', null],
    ]);
  });

  it('"제3조(정의)에 따라"처럼 제목까지 붙여 인용해도 자르지 않는다', () => {
    expect(articles('제4조(적용) 제3조(정의)에 따른 직원에게 적용한다.')).toEqual([
      [4, '적용', '제3조(정의)에 따른 직원에게 적용한다.', null],
    ]);
  });

  it('줄 첫머리로 넘어온 "제5조 제1항에 따라"는 앞 조의 본문이다', () => {
    expect(articles('제6조(구성) 이사회는 이사로 구성한다.', '제5조 제1항에 따른 이사는 정관에 따른다.')).toEqual([
      [6, '구성', '이사회는 이사로 구성한다.\n제5조 제1항에 따른 이사는 정관에 따른다.', null],
    ]);
  });

  it('줄바꿈 없이 붙어 온 진짜 조 경계("… 한다. 제2조(정의) …")는 여전히 나눈다', () => {
    expect(articles('제1조(목적) 이 규정은 목적을 정한다. 제2조(정의) 용어를 정의한다.')).toEqual([
      [1, '목적', '이 규정은 목적을 정한다.', null],
      [2, '정의', '용어를 정의한다.', null],
    ]);
  });
});

describe('기존 규정 가져오기 — 조 제목과 본문', () => {
  it('괄호 안은 제목, 같은 줄의 나머지는 본문이다 (예전엔 본문까지 제목이 됐다)', () => {
    expect(articles('제1조(목적) 이 규칙은 근로조건을 정한다.')).toEqual([[1, '목적', '이 규칙은 근로조건을 정한다.', null]]);
  });

  it('조 제목 줄에 이어 쓴 첫 항은 본문 첫 줄로 남아 항으로 읽힌다', () => {
    expect(articles('제3조(휴가) ① 회사는 연차휴가를 준다.', '② 경조휴가는 따로 정한다.')).toEqual([
      [3, '휴가', '① 회사는 연차휴가를 준다.\n② 경조휴가는 따로 정한다.', null],
    ]);
  });

  it('"제3조의2"는 가지 번호를 따로 들고, 제목에 "의2"가 섞이지 않는다', () => {
    expect(articles('제3조의2 (경영철학의 실행)', '실천 방법을 개발한다.')).toEqual([
      [3, '경영철학의 실행', '실천 방법을 개발한다.', 2],
    ]);
  });
});

describe('기존 규정 가져오기 — 장', () => {
  it('자간을 벌린 "제 1 장 총 칙"은 장이다 (예전엔 "1. 장 총 칙"이라는 조문이 됐다)', () => {
    const { chapters } = parse('제 1 장 총 칙', '제1조(목적) 본문');
    expect(chapters.map((c) => [c.number, c.title])).toEqual([[1, '총칙']]);
    expect(chapters[0].articles.map((a) => [a.number, a.title])).toEqual([[1, '목적']]);
  });
});
