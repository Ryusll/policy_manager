import { describe, it, expect } from 'vitest';
import {
  AskRow,
  buildContext,
  buildToc,
  checkAnswer,
  groupRows,
  questionKeywords,
  rowLabel,
} from '../apps/api/src/ask/ask-text';
import { kstMonthStart, monthlyLimitFrom } from '../apps/api/src/ask/ask.service';

let seq = 0;
const row = (p: Partial<AskRow>): AskRow => ({
  articleId: `a${++seq}`,
  policyId: 'p1',
  policyTitle: '인사규정',
  policyCode: 'HR-01',
  number: 1,
  branchNumber: null,
  clauseNumber: null,
  itemNumber: null,
  title: '',
  content: '',
  ...p,
});

describe('질문 낱말 뽑기', () => {
  it('조사·어미를 떼고 질문 말투·흔한 말은 버린다', () => {
    expect(questionKeywords('결혼하면 경조금은 얼마인가요?')).toEqual(['결혼', '경조금']);
    expect(questionKeywords('출장 규정 알려줘')).toEqual(['출장']);
    expect(questionKeywords('연차휴가를 이월할 수 있나요')).toEqual(['연차휴가', '이월할']);
  });

  it('한 글자·숫자·중복은 버리고 8개까지만', () => {
    expect(questionKeywords('A 3 경조 경조를')).toEqual(['경조']);
    expect(questionKeywords('가가 나나 다다 라라 마마 바바 사사 아아 자자 차차')).toHaveLength(8);
  });
});

describe('조 단위로 묶기', () => {
  it('같은 규정·조·가지 번호를 한 묶음으로, 조 머리 제목을 묶음 제목으로', () => {
    const groups = groupRows([
      row({ number: 12, clauseNumber: 2, content: '둘째 항' }),
      row({ number: 12, title: '경조금' }),
      row({ number: 12, clauseNumber: 1, content: '첫째 항' }),
      row({ number: 3, branchNumber: 2, title: '정의의 특례' }),
      row({ policyId: 'p0', policyTitle: '복무규정', number: 1, title: '목적' }),
    ]);
    expect(groups.map((g) => `${g.policyTitle}:${g.number}-${g.branchNumber ?? 0}:${g.title}`)).toEqual([
      '복무규정:1-0:목적',
      '인사규정:3-2:정의의 특례',
      '인사규정:12-0:경조금',
    ]);
    // 조 머리 → 항 순서
    expect(groups[2].rows.map((r) => r.clauseNumber)).toEqual([null, 1, 2]);
  });

  it('행 표기는 법령식', () => {
    expect(rowLabel({ number: 12, branchNumber: 2, clauseNumber: 1, itemNumber: 3 })).toBe('제12조의2 제1항 제3호');
  });
});

describe('AI 에 주는 목차·본문', () => {
  const groups = groupRows([
    row({ number: 1, title: '목적', content: '이 규정은 경조금 지급 기준을 정한다.' }),
    row({ number: 2, title: '경조금' }),
    row({ number: 2, clauseNumber: 1, content: '직원 본인이 결혼하면 50만원을 지급한다.' }),
  ]);

  it('목차는 짧은 키와 규정명·조 제목, 넘치면 뒤를 자른다', () => {
    const toc = buildToc(groups, 1000);
    expect(toc.text).toBe('K1 | 인사규정 | 제1조(목적)\nK2 | 인사규정 | 제2조(경조금)');
    expect(toc.entries.map((e) => e.group.number)).toEqual([1, 2]);
    const cut = buildToc(groups, 25);
    expect(cut.truncated).toBe(true);
    expect(cut.entries).toHaveLength(1);
  });

  it('본문은 행마다 참조 번호를 붙이고, 넘치면 조째로 뺀다(첫 조는 늘 넣는다)', () => {
    const ctx = buildContext([groups[1], groups[0]], 10_000);
    expect(ctx.text).toContain('[R1] 제2조 (경조금)');
    expect(ctx.text).toContain('[R2] 제2조 제1항 직원 본인이 결혼하면 50만원을 지급한다.');
    expect(ctx.text).toContain('[R3] 제1조 (목적) 이 규정은');
    expect(ctx.refs.map((r) => r.ref)).toEqual(['R1', 'R2', 'R3']);
    const small = buildContext([groups[1], groups[0]], 50);
    expect(small.used.map((g) => g.number)).toEqual([2]);
    expect(small.refs.map((r) => r.ref)).toEqual(['R1', 'R2']);
  });
});

describe('AI 답 검사', () => {
  const allowed = new Set(['R1', 'R2']);

  it('준 번호 밖의 근거는 버리고 본문의 참조 표기는 지운다', () => {
    const out = checkAnswer(
      {
        answerable: true,
        blocks: [
          { type: 'paragraph', text: '본인 결혼은 50만원입니다 [R2].', items: [], headers: [], rows: [] },
          { type: 'table', text: '', items: [], headers: ['구분', '금액'], rows: [['본인 결혼', '50만원', '넘친 칸']] },
          { type: 'list', text: '', items: ['', '신청서 제출 (R1, R2)'], headers: [], rows: [] },
          { type: 'video', text: '모르는 블록' },
        ],
        citations: ['R2', 'R999', '[R1]', 'R2'],
      },
      allowed,
    );
    expect(out.answerable).toBe(true);
    expect(out.citations).toEqual(['R2', 'R1']);
    expect(out.droppedCitations).toBe(1);
    expect(out.blocks).toEqual([
      { type: 'paragraph', text: '본인 결혼은 50만원입니다 .' },
      { type: 'table', headers: ['구분', '금액'], rows: [['본인 결혼', '50만원']] },
      { type: 'list', items: ['신청서 제출'] },
    ]);
  });

  it('근거가 하나도 남지 않으면 답하지 않은 것으로 본다', () => {
    const out = checkAnswer(
      { answerable: true, blocks: [{ type: 'paragraph', text: '아마 30만원일 겁니다.' }], citations: ['R7'] },
      allowed,
    );
    expect(out).toMatchObject({ answerable: false, blocks: [], citations: [], droppedCitations: 1 });
  });

  it('AI 가 답할 수 없다고 하면 블록이 있어도 내보내지 않는다', () => {
    const out = checkAnswer({ answerable: false, blocks: [{ type: 'paragraph', text: '추측' }], citations: ['R1'] }, allowed);
    expect(out.answerable).toBe(false);
    expect(out.blocks).toEqual([]);
  });

  it('형식이 깨진 응답도 예외 없이 "답 없음"', () => {
    expect(checkAnswer(null, allowed).answerable).toBe(false);
    expect(checkAnswer({ answerable: 'yes', blocks: 'x', citations: 3 }, allowed).answerable).toBe(false);
  });
});

describe('월 한도의 달 시작', () => {
  it('한국 시간 1일 0시 — UTC 로는 전달 말일 15시', () => {
    expect(kstMonthStart(new Date('2026-10-09T05:00:00Z')).toISOString()).toBe('2026-09-30T15:00:00.000Z');
    // 한국 10/1 08:00 = UTC 9/30 23:00 → 이미 10월
    expect(kstMonthStart(new Date('2026-09-30T23:00:00Z')).toISOString()).toBe('2026-09-30T15:00:00.000Z');
    // 한국 9/30 23:00 = UTC 9/30 14:00 → 아직 9월
    expect(kstMonthStart(new Date('2026-09-30T14:00:00Z')).toISOString()).toBe('2026-08-31T15:00:00.000Z');
  });
});

describe('월 한도 설정값', () => {
  it('비었거나 숫자가 아니면 기본 300 — compose 가 넘기는 빈 문자열을 0 으로 읽지 않는다', () => {
    expect(monthlyLimitFrom(undefined)).toBe(300);
    expect(monthlyLimitFrom('')).toBe(300);
    expect(monthlyLimitFrom('  ')).toBe(300);
    expect(monthlyLimitFrom('abc')).toBe(300);
    expect(monthlyLimitFrom('-1')).toBe(300);
    expect(monthlyLimitFrom('15')).toBe(15);
    expect(monthlyLimitFrom('0')).toBe(0); // 일부러 0 을 주면 막는다
    expect(monthlyLimitFrom('', 60)).toBe(60); // 직원별 한도는 기본값이 다르다
    expect(monthlyLimitFrom('12', 60)).toBe(12);
  });
});
