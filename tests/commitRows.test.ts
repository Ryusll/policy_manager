import { describe, it, expect } from 'vitest';
import { buildCommitRows, classifyNorm } from '../apps/api/src/regulation-parse/commit-rows';
import type { RegulationArticleNode } from '../apps/api/src/regulation-parse/regulation-tree.builder';

let seq = 0;
const n = (
  articleNumber: string,
  articleTitle: string,
  content: string,
  children: RegulationArticleNode[] = [],
): RegulationArticleNode => ({
  id: `n${(seq += 1)}`,
  articleNumber,
  articleTitle,
  content,
  parentId: null,
  depth: 0,
  pageNumber: null,
  sortOrder: seq,
  children,
});

/** 검증을 읽기 쉽게: 조-항-목 좌표만 뽑는다 */
const coords = (rows: ReturnType<typeof buildCommitRows>) =>
  rows.map((r) => [r.number, r.clauseNumber, r.itemNumber]);

describe('classifyNorm', () => {
  it('norm 어휘를 조·항·목으로 가른다', () => {
    expect(classifyNorm('L1')).toBe('jo');
    expect(classifyNorm('L1-2')).toBe('jo'); // 제1조의2 — depth로는 자식이지만 조다
    expect(classifyNorm('C1')).toBe('hang'); // ①
    expect(classifyNorm('1')).toBe('mok'); // 1. (호)
    expect(classifyNorm('1.2')).toBe('mok');
    expect(classifyNorm('H가')).toBe('mok');
    expect(classifyNorm('Hp가')).toBe('mok');
    expect(classifyNorm('PN1')).toBe('mok'); // (1)
  });

  it('앞글자가 겹치는 코드를 서로 잡아먹지 않는다', () => {
    // CH1(장) vs C1(항), P1(편) vs PN1(괄호번호) — 순서가 틀리면 조용히 뒤바뀐다
    expect(classifyNorm('CH1')).toBe('jo');
    expect(classifyNorm('C1')).toBe('hang');
    expect(classifyNorm('P1')).toBe('jo');
    expect(classifyNorm('PN1')).toBe('mok');
    // 매퍼가 원문자 번호를 못 읽으면 `C①`로 온다. 그래도 항이다.
    expect(classifyNorm('C①')).toBe('hang');
  });

  it('편·장·절·관 코드는 숫자 판정에 먹히지 않는다', () => {
    expect(classifyNorm('P1')).toBe('jo');
    expect(classifyNorm('CH2')).toBe('jo');
    expect(classifyNorm('S3')).toBe('jo');
    expect(classifyNorm('SS4')).toBe('jo');
  });
});

describe('buildCommitRows — 법제처 조>항>호 구조', () => {
  it('항·호가 별도 조로 평탄화되지 않는다', () => {
    // 회귀 방지: 예전에는 ①이 제2조, 1.이 제3조, ②가 제4조가 되고
    // 실제 제2조가 제5조로 밀렸다.
    const roots = [
      n('L1', '목적', '이 법은 …', [
        n('C1', '제1항', '첫째 항', [n('1', '제1호', '첫째 호')]),
        n('C2', '제2항', '둘째 항'),
      ]),
      n('L2', '정의', '용어의 뜻은 …'),
    ];
    const rows = buildCommitRows(roots);

    expect(coords(rows)).toEqual([
      [1, null, null], // 제1조 목적
      [1, 1, null], //   ① 항
      [1, 1, 1], //       1. 호 → 목
      [1, 2, null], //   ② 항
      [2, null, null], // 제2조 정의  ← 예전엔 제5조
    ]);
  });

  it('조 제목만 남기고 항·목 제목은 비운다', () => {
    // 예전에는 `[L1] 목적`, `[C1] 제1항` 처럼 내부 코드가 제목에 새어 나왔다.
    const rows = buildCommitRows([n('L1', '목적', '본문', [n('C1', '제1항', '항 본문')])]);
    expect(rows.map((r) => r.title)).toEqual(['목적', '']);
  });

  it('호 아래 목(4단)은 행을 늘리지 않고 부모 본문에 이어 붙인다', () => {
    // 우리 모델은 조·항·목 3단이라 남는 한 단은 가짜 조문을 만들지 않고 텍스트로 흡수한다.
    const rows = buildCommitRows([
      n('L1', '정의', '다음과 같다.', [
        n('C1', '제1항', '항 본문', [
          n('1', '제1호', '자동차란', [n('H가', '가.', '승용자동차'), n('H나', '나.', '승합자동차')]),
        ]),
      ]),
    ]);
    expect(coords(rows)).toEqual([
      [1, null, null],
      [1, 1, null],
      [1, 1, 1],
    ]);
    expect(rows[2].content).toBe('자동차란\n가. 승용자동차\n나. 승합자동차');
  });
});

describe('buildCommitRows — PDF 경로', () => {
  it('제1조의2는 자식으로 와도 조로 센다', () => {
    // PDF 파서는 L1-2 를 depth 1 로 제1조의 자식으로 넣는다. depth만 보면 항으로 오인한다.
    const rows = buildCommitRows([n('L1', '목적', '본문', [n('L1-2', '적용범위', '본문2')])]);
    expect(coords(rows)).toEqual([
      [1, null, null],
      [2, null, null],
    ]);
  });

  it('원문자·괄호번호가 섞인 트리를 항·목으로 나눈다', () => {
    const rows = buildCommitRows([
      n('L1', '목적', '본문', [n('C1', '①', '항', [n('PN1', '(1)', '괄호 항목')])]),
    ]);
    expect(coords(rows)).toEqual([
      [1, null, null],
      [1, 1, null],
      [1, 1, 1],
    ]);
  });

  it('상위 항이 없는 목은 항 번호를 비운다', () => {
    const rows = buildCommitRows([n('L1', '목적', '본문', [n('1', '제1호', '호 본문')])]);
    expect(coords(rows)).toEqual([
      [1, null, null],
      [1, null, 1],
    ]);
  });

  it('장·절 제목 행은 지금도 조로 들어간다 (T-89 범위)', () => {
    // 실제 장(Chapter)으로 만드는 것은 T-89. 여기서는 동작을 바꾸지 않고 사실만 고정한다.
    const rows = buildCommitRows([n('CH1', '총칙', '제1장 총칙'), n('L1', '목적', '본문')]);
    expect(coords(rows)).toEqual([
      [1, null, null],
      [2, null, null],
    ]);
  });

  it('빈 트리는 빈 목록', () => {
    expect(buildCommitRows([])).toEqual([]);
  });
});
