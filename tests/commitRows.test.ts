import { describe, it, expect } from 'vitest';
import { buildCommitPlan, classifyNorm } from '../apps/api/src/regulation-parse/commit-rows';
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
const coords = (roots: RegulationArticleNode[]) =>
  buildCommitPlan(roots).rows.map((r) => [r.number, r.clauseNumber, r.itemNumber]);

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
    expect(classifyNorm('CH1')).toBe('chapter');
    expect(classifyNorm('C1')).toBe('hang');
    expect(classifyNorm('P1')).toBe('chapter');
    expect(classifyNorm('PN1')).toBe('mok');
    // 매퍼가 원문자 번호를 못 읽으면 `C①`로 온다. 그래도 항이다.
    expect(classifyNorm('C①')).toBe('hang');
  });

  it('편·장·절·관 코드는 숫자 판정에 먹히지 않는다', () => {
    expect(classifyNorm('P1')).toBe('chapter');
    expect(classifyNorm('CH2')).toBe('chapter');
    expect(classifyNorm('S3')).toBe('section');
    expect(classifyNorm('SS4')).toBe('section');
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
    expect(coords(roots)).toEqual([
      [1, null, null], // 제1조 목적
      [1, 1, null], //   ① 항
      [1, 1, 1], //       1. 호 → 목
      [1, 2, null], //   ② 항
      [2, null, null], // 제2조 정의  ← 예전엔 제5조
    ]);
  });

  it('조 제목만 남기고 항·목 제목은 비운다', () => {
    // 예전에는 `[L1] 목적`, `[C1] 제1항` 처럼 내부 코드가 제목에 새어 나왔다.
    const { rows } = buildCommitPlan([n('L1', '목적', '본문', [n('C1', '제1항', '항 본문')])]);
    expect(rows.map((r) => r.title)).toEqual(['목적', '']);
  });

  it('호 아래 목(4단)은 행을 늘리지 않고 부모 본문에 이어 붙인다', () => {
    // 우리 모델은 조·항·목 3단이라 남는 한 단은 가짜 조문을 만들지 않고 텍스트로 흡수한다.
    const roots = [
      n('L1', '정의', '다음과 같다.', [
        n('C1', '제1항', '항 본문', [
          n('1', '제1호', '자동차란', [n('H가', '가.', '승용자동차'), n('H나', '나.', '승합자동차')]),
        ]),
      ]),
    ];
    const { rows } = buildCommitPlan(roots);
    expect(coords(roots)).toEqual([
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
    expect(coords([n('L1', '목적', '본문', [n('L1-2', '적용범위', '본문2')])])).toEqual([
      [1, null, null],
      [2, null, null],
    ]);
  });

  it('원문자·괄호번호가 섞인 트리를 항·목으로 나눈다', () => {
    expect(coords([n('L1', '목적', '본문', [n('C1', '①', '항', [n('PN1', '(1)', '괄호 항목')])])])).toEqual([
      [1, null, null],
      [1, 1, null],
      [1, 1, 1],
    ]);
  });

  it('상위 항이 없는 목은 항 번호를 비운다', () => {
    expect(coords([n('L1', '목적', '본문', [n('1', '제1호', '호 본문')])])).toEqual([
      [1, null, null],
      [1, null, 1],
    ]);
  });

  it('빈 트리는 빈 계획', () => {
    expect(buildCommitPlan([])).toEqual({ chapters: [], rows: [] });
  });
});

describe('buildCommitPlan — 장·절 구조 (T-89)', () => {
  it('장 제목이 실제 Chapter가 되고 조가 그 아래 붙는다', () => {
    // 예전에는 장 제목까지 조가 되어(제1조 "총칙") 뒤 조문 번호를 한 칸씩 밀어냈다.
    const plan = buildCommitPlan([
      n('CH1', '총칙', '제1장 총칙', [n('L1', '목적', '본문1'), n('L2', '정의', '본문2')]),
      n('CH2', '보안 운영', '제2장 보안 운영', [n('L3', '계정 관리', '본문3')]),
    ]);

    expect(plan.chapters.map((c) => [c.number, c.title, c.suppressHeader])).toEqual([
      [1, '총칙', false],
      [2, '보안 운영', false],
    ]);
    expect(plan.rows.map((r) => [r.number, r.chapterIndex])).toEqual([
      [1, 0],
      [2, 0],
      [3, 1], // 장이 조 번호를 밀어내지 않는다
    ]);
  });

  it('절은 Section이 되고 조가 절에 매인다', () => {
    const plan = buildCommitPlan([
      n('CH1', '총칙', '', [
        n('L1', '목적', '본문'),
        n('S1', '통칙', '', [n('L2', '적용범위', '본문')]),
      ]),
    ]);

    expect(plan.chapters[0].sections).toEqual([{ number: 1, title: '통칙' }]);
    expect(plan.rows.map((r) => [r.number, r.sectionIndex])).toEqual([
      [1, null], // 절보다 앞에 나온 조는 절에 속하지 않는다
      [2, 0],
    ]);
  });

  it('장 표기가 없으면 예전처럼 숨김 장 하나에 담는다', () => {
    const plan = buildCommitPlan([n('L1', '목적', '본문')]);
    expect(plan.chapters).toEqual([
      { number: 1, title: '본문', suppressHeader: true, sections: [] },
    ]);
  });

  it('조문을 못 받은 장·절은 버리고 번호를 다시 매긴다', () => {
    // 편(編)은 조문을 직접 갖지 않는다. 우리 모델에 편 자리가 없어 여기서 사라지고
    // 장이 최상위가 된다. 가짜 빈 장을 남기는 것보다 낫다.
    const plan = buildCommitPlan([
      n('P1', '재산편', '제1편 재산', [
        n('CH1', '총칙', '', [n('L1', '목적', '본문')]),
        n('CH2', '빈 장', ''), // 조문이 없다
      ]),
    ]);

    expect(plan.chapters.map((c) => [c.number, c.title])).toEqual([[1, '총칙']]);
    expect(plan.rows.map((r) => [r.number, r.chapterIndex])).toEqual([[1, 0]]);
  });

  it('편만 있고 장이 없으면 편이 그대로 장이 된다', () => {
    const plan = buildCommitPlan([n('P1', '총칙편', '제1편 총칙', [n('L1', '목적', '본문')])]);
    expect(plan.chapters.map((c) => c.title)).toEqual(['총칙편']);
    expect(plan.rows).toHaveLength(1);
  });
});
