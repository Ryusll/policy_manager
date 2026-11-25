import { describe, it, expect } from 'vitest';
import { buildRegulationTreeFromLines } from '../apps/api/src/regulation-parse/regulation-tree.builder';
import { buildCommitPlan } from '../apps/api/src/regulation-parse/commit-rows';
import type { RegulationArticleNode } from '../apps/api/src/regulation-parse/regulation-tree.builder';

/**
 * PDF 줄 → 미리보기 트리 → 실제로 저장될 행까지 한 번에 본다.
 *
 * 파서와 커밋을 따로따로만 시험하던 사이에, 파서는 항 문장을 제목 칸에 넣고 커밋은 항 제목을
 * 버려서 항 본문이 통째로 사라지는 버그가 두 달 가까이 숨어 있었다. 두 단계의 약속이
 * 어긋나면 여기서 잡힌다.
 */
const plan = (...pages: string[][]) =>
  buildCommitPlan(
    buildRegulationTreeFromLines(pages.flatMap((lines, i) => lines.map((text) => ({ text, page: i + 1 })))).roots,
  );

/** [조, 항, 목, 제목, 본문] */
const rowsOf = (p: ReturnType<typeof buildCommitPlan>) =>
  p.rows.map((r) => [r.number, r.clauseNumber, r.itemNumber, r.title, r.content]);

describe('PDF 가져오기 — 본문을 잃지 않는다', () => {
  it('항 문장이 첫 줄부터 그대로 남는다 (한 줄짜리·두 줄짜리 항)', () => {
    const p = plan([
      '제2조 (적용범위)',
      '① 이사회에 관한 사항은 법령 또는 정관에 정하여진 것 이외에는 이 규정이 정하는 바에 의한다.',
      '② 이사회의 운영에 관한 세부기준은 이사회 운영세칙으로',
      '따로 정한다.',
    ]);
    expect(rowsOf(p)).toEqual([
      [2, null, null, '적용범위', ''],
      [2, 1, null, '', '이사회에 관한 사항은 법령 또는 정관에 정하여진 것 이외에는 이 규정이 정하는 바에 의한다.'],
      [2, 2, null, '', '이사회의 운영에 관한 세부기준은 이사회 운영세칙으로 따로 정한다.'],
    ]);
  });

  it('조 제목과 본문이 한 줄에 있으면 제목은 괄호 안, 본문은 내용으로 간다', () => {
    const p = plan(['제1조(목적) 이 규칙은 근로조건을 정한다.']);
    expect(rowsOf(p)).toEqual([[1, null, null, '목적', '이 규칙은 근로조건을 정한다.']]);
  });

  it('조 제목 줄에 바로 이어 쓴 첫 항도 항으로 받는다', () => {
    const p = plan(['제3조(휴가) ① 회사는 연차휴가를 준다.', '② 경조휴가는 따로 정한다.']);
    expect(rowsOf(p)).toEqual([
      [3, null, null, '휴가', ''],
      [3, 1, null, '', '회사는 연차휴가를 준다.'],
      [3, 2, null, '', '경조휴가는 따로 정한다.'],
    ]);
  });

  it('호(1. 2.)를 버리지 않고 조·항 아래에 붙인다', () => {
    // 예전에는 호가 조와 같은 깊이로 계산돼 "붙을 조가 없는 호"로 버려졌다.
    const p = plan([
      '제2조(정의) 용어의 뜻은 다음과 같다.',
      '1. "직원"이란 근로계약을 맺은 사람을 말한다.',
      '2. "임금"이란 근로의 대가를 말한다.',
      '제3조(휴가) ① 연차휴가를 준다.',
      '② 경조휴가는 다음 각 호와 같다.',
      '1. 본인 결혼: 5일',
      '가. 신혼여행 포함',
    ]);
    expect(rowsOf(p)).toEqual([
      [2, null, null, '정의', '용어의 뜻은 다음과 같다.'],
      [2, null, 1, '', '"직원"이란 근로계약을 맺은 사람을 말한다.'],
      [2, null, 2, '', '"임금"이란 근로의 대가를 말한다.'],
      [3, null, null, '휴가', ''],
      [3, 1, null, '', '연차휴가를 준다.'],
      [3, 2, null, '', '경조휴가는 다음 각 호와 같다.'],
      // 호 아래 목(4단)은 행을 늘리지 않고 호 본문에 잇는다 (우리 모델은 조·항·목 3단)
      [3, 2, 1, '', '본인 결혼: 5일\n가. 신혼여행 포함'],
    ]);
  });

  it('조 표기 없이 번호로만 쓴 문서도 버리지 않고 조로 올린다', () => {
    const p = plan(['1. 목적', '이 지침은 출장 기준을 정한다.', '2. 적용', '전 직원에게 적용한다.']);
    expect(p.rows.map((r) => r.content)).toEqual([
      '1. 목적 이 지침은 출장 기준을 정한다.',
      '2. 적용 전 직원에게 적용한다.',
    ]);
  });
});

describe('PDF 가져오기 — 조 번호가 원문과 같다', () => {
  it('문서 제목은 조문이 아니라 머리말로 빠진다 (예전엔 "제1조 머리말"이 생겨 번호가 밀렸다)', () => {
    const p = plan(['이 사 회 규 정', '제 1 장 총 칙', '제1조 (목적)', '이 규정은 운영 사항을 정한다.']);
    expect(p.preamble).toBe('이사회규정');
    expect(p.chapters.map((c) => c.title)).toEqual(['총칙']);
    expect(rowsOf(p)).toEqual([[1, null, null, '목적', '이 규정은 운영 사항을 정한다.']]);
  });

  it('"제3조의2"는 제3조의 가지로 들어가고, 뒤 조 번호를 밀지 않는다', () => {
    const p = plan([
      '제3조 (권한) 이사회는 의결한다.',
      '제3조의2 (경영철학의 실행)',
      '① 실천 방법을 개발한다.',
      '제4조 (구성) 이사회는 이사로 구성한다.',
    ]);
    expect(p.rows.map((r) => [r.number, r.branchNumber, r.clauseNumber, r.title])).toEqual([
      [3, null, null, '권한'],
      [3, 2, null, '경영철학의 실행'],
      [3, 2, 1, ''],
      [4, null, null, '구성'],
    ]);
  });

  it('삭제돼 비어 있는 조 번호를 당기지 않는다', () => {
    const p = plan(['제1조(목적) 본문1', '제5조(구성) 본문5']);
    expect(p.rows.map((r) => r.number)).toEqual([1, 5]);
  });

  it('줄 첫머리로 넘어온 다른 조 인용을 새 조로 오인하지 않는다', () => {
    const p = plan(['제5조(구성) 이사회는 이사로 구성한다.', '제5조 제1항에 따른 이사는 정관에 따른다.', '제3조에 따라 소집한다.']);
    expect(rowsOf(p)).toEqual([
      [5, null, null, '구성', '이사회는 이사로 구성한다. 제5조 제1항에 따른 이사는 정관에 따른다. 제3조에 따라 소집한다.'],
    ]);
  });
});

describe('PDF 가져오기 — 개정 표기·쪽 장식', () => {
  it('줄바꿈으로 갈라진 개정 표기의 날짜를 호 번호로 오인하지 않는다', () => {
    const p = plan([
      '제3조 (권한)',
      '② 이사회는 직무집행을 감독한다. <개정',
      '1999.4.9 >',
      '③ <삭제 2001.8.14>',
    ]);
    expect(rowsOf(p)).toEqual([
      [3, null, null, '권한', ''],
      // 항 번호도 원문을 따른다 (②·③ 이 ①·② 로 당겨지지 않는다)
      [3, 2, null, '', '이사회는 직무집행을 감독한다. <개정 1999.4.9 >'],
      [3, 3, null, '', '<삭제 2001.8.14>'],
    ]);
  });

  it('쪽 번호와 쪽마다 반복되는 머리말을 본문에 끼워 넣지 않는다', () => {
    const p = plan(
      ['이사회규정', '제1조(목적) 이 규정은', '- 1 -'],
      ['이사회규정', '운영 사항을 정한다.', '- 2 -'],
      ['이사회규정', '제2조(정의) 용어를 정의한다.', '- 3 -'],
    );
    expect(rowsOf(p)).toEqual([
      [1, null, null, '목적', '이 규정은 운영 사항을 정한다.'],
      [2, null, null, '정의', '용어를 정의한다.'],
    ]);
    // 첫 쪽에 찍힌 같은 머리말도 규정 설명으로 새지 않는다
    expect(p.preamble).toBe('');
  });

  it('여러 줄 머리말의 자간 벌린 제목도 붙여 쓴다', () => {
    const p = plan(['(주)대한전자', '이 사 회 규 정', '제1조(목적) 본문']);
    expect(p.preamble).toBe('(주)대한전자\n이사회규정');
  });

  it('목차의 점선 줄은 버린다', () => {
    const p = plan(['목 차', '제1조(목적) ............ 1', '제2조(정의) ............ 2', '제1조(목적) 본문1', '제2조(정의) 본문2']);
    expect(rowsOf(p)).toEqual([
      [1, null, null, '목적', '본문1'],
      [2, null, null, '정의', '본문2'],
    ]);
  });

  it('점선 없는 목차도 본문이 다시 제1조로 시작하면 버린다', () => {
    const p = plan(['제1조(목적)', '제2조(정의)', '제3조(적용)', '제1조(목적) 본문1', '제2조(정의) 본문2']);
    expect(p.rows.map((r) => [r.number, r.content])).toEqual([
      [1, '본문1'],
      [2, '본문2'],
    ]);
  });
});

describe('PDF 가져오기 — 부칙·별표', () => {
  it('부칙은 조문이 아니라 부칙으로 가고, 본문 조 번호를 건드리지 않는다', () => {
    const p = plan([
      '제1조(목적) 본문',
      '제2조(정의) 본문2',
      '부 칙 <2017. 2. 22>',
      '제1조(시행일) 이 규정은 공포한 날부터 시행한다.',
      '제2조(경과조치) 종전 규정에 따른다.',
      '[별표 1] 경조금 지급 기준',
      '본인 결혼 400,000원',
    ]);
    expect(p.rows.map((r) => r.number)).toEqual([1, 2]);
    expect(p.appendices).toEqual([
      {
        kind: 'supplementary',
        title: '부칙 <2017. 2. 22>',
        body: '제1조(시행일) 이 규정은 공포한 날부터 시행한다.\n제2조(경과조치) 종전 규정에 따른다.',
      },
      { kind: 'annex', title: '별표 1 경조금 지급 기준', body: '본인 결혼 400,000원' },
    ]);
  });

  it('본문 줄 첫머리의 "[별표 1]과 같다"는 별표 시작이 아니다', () => {
    const p = plan(['제4조(지급) 지급 기준은', '[별표 1]과 같다.']);
    expect(p.appendices).toEqual([]);
    expect(p.rows[0].content).toBe('지급 기준은 [별표 1]과 같다.');
  });
});

describe('커밋 — 예전 모양으로 저장된 미리보기 세션', () => {
  it('항 문장이 제목 칸에 있어도(수정 전 파서·사용자 편집) 본문으로 살린다', () => {
    const node = (articleNumber: string, articleTitle: string, content: string, children: RegulationArticleNode[] = []) =>
      ({ id: articleNumber, articleNumber, articleTitle, content, parentId: null, depth: 0, pageNumber: null, sortOrder: 0, children }) as RegulationArticleNode;
    const p = buildCommitPlan([
      node('L2', '(적용범위)', '', [
        node('C1', '이사회에 관한 사항은 이 규정이 정하는 바에', '의한다.'),
        node('C2', '제2항', '법제처식 항 본문'),
      ]),
    ]);
    expect(p.rows.slice(1).map((r) => r.content)).toEqual([
      '이사회에 관한 사항은 이 규정이 정하는 바에 의한다.',
      '법제처식 항 본문',
    ]);
  });
});
