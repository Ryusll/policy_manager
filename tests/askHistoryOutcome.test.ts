/**
 * 내 지난 질문 — 기록 한 행을 화면에 내보낼 꼴로 (T-218, SRS SEARCH-10).
 * 기록의 오류 문구(failure)는 내보내지 않고 결과 종류로만 알린다. 까닭 칸 전의 기록은 남은 칸으로 되짚는다.
 */
import { describe, expect, it } from 'vitest';
import { askOutcome, scopeOf, toHistoryDetail, toHistoryItem } from '../apps/api/src/ask/ask-history';

const base = {
  id: '11111111-1111-4111-8111-111111111111',
  question: '경조금은 얼마인가요?',
  createdAt: new Date('2026-11-19T01:02:03Z'),
  answerable: false,
  reason: null as string | null,
  failure: null as string | null,
  aiCalled: true,
  model: 'mock' as string | null,
  contextRowCount: 0,
  answer: null as unknown,
  citations: null as unknown,
  lawCitations: null as unknown,
  consulted: null as unknown,
  scope: [] as unknown,
};

describe('결과 종류 (T-218)', () => {
  it('답했으면 answered', () => {
    expect(askOutcome({ ...base, answerable: true })).toBe('answered');
  });

  it('남긴 까닭이 있으면 그것', () => {
    for (const reason of ['no_regulations', 'no_candidates', 'no_basis', 'refused']) {
      expect(askOutcome({ ...base, reason }), reason).toBe(reason);
    }
  });

  it('모르는 까닭 값은 믿지 않고 다른 칸으로 되짚는다', () => {
    expect(askOutcome({ ...base, reason: 'whatever', contextRowCount: 2 })).toBe('no_basis');
  });

  it('거절 기록은 refused, 그 밖의 오류는 failed', () => {
    expect(askOutcome({ ...base, failure: 'refused:policy' })).toBe('refused');
    expect(askOutcome({ ...base, failure: 'connect ECONNREFUSED 10.0.0.1:443' })).toBe('failed');
    expect(askOutcome({ ...base, aiCalled: false, failure: '회사 관리자가 껐습니다' })).toBe('failed');
  });

  it('까닭 칸 전의 기록: AI 를 안 불렀으면 규정 없음, 예약만 남았으면 처리 중, 본문을 줬으면 근거 없음, 아니면 관련 조문 없음', () => {
    expect(askOutcome({ ...base, aiCalled: false, model: null })).toBe('no_regulations');
    expect(askOutcome({ ...base, model: null })).toBe('unfinished');
    expect(askOutcome({ ...base, contextRowCount: 3 })).toBe('no_basis');
    expect(askOutcome({ ...base, contextRowCount: 0 })).toBe('no_candidates');
  });
});

describe('목록·다시 보기로 바꾸기 (T-218)', () => {
  const citation = { ref: 'R1', articleId: 'a1', policyId: 'p1', policyTitle: '복리후생규정', label: '제2조', content: '경조금 50만원' };
  const consulted = [{ policyId: 'p1', policyTitle: '복리후생규정', number: 2, branchNumber: null, label: '제2조(경조금)' }];

  it('목록에는 id·질문·시각·결과 종류만 — 범위는 다시 보기에만 싣는다 (T-219)', () => {
    expect(toHistoryItem({ ...base, answerable: true, scope: [{ id: 'p1', title: 'x', code: 'y' }] })).toEqual({
      id: base.id,
      question: base.question,
      createdAt: '2026-11-19T01:02:03.000Z',
      outcome: 'answered',
    });
  });

  it('범위는 기록에 남긴 물은 때의 이름·코드 그대로 — 모양이 맞지 않는 것은 뺀다 (T-219)', () => {
    const scope = [{ id: 'p1', title: '여비 규정', code: 'FN-01' }, { id: 'p2' }, null, 'x', { id: 'p3', title: 1, code: 'C' }];
    expect(toHistoryDetail({ ...base, scope }).scope).toEqual([{ id: 'p1', title: '여비 규정', code: 'FN-01' }]);
    for (const empty of [null, undefined, {}, '[]']) expect(scopeOf(empty)).toEqual([]);
  });

  it('답한 기록은 물은 때의 답·근거 원문·법령 근거·살펴본 조문을 그대로', () => {
    const blocks = [{ type: 'paragraph', text: '50만원입니다.' }];
    const d = toHistoryDetail({ ...base, answerable: true, answer: blocks, citations: [citation], lawCitations: [], consulted });
    expect(d.snapshot).toBe(true);
    expect(d.result).toEqual({ answerable: true, blocks, citations: [citation], lawCitations: [], consulted });
  });

  it('근거를 남기기 전의 답은 본문만 — snapshot false, 근거는 빈 목록', () => {
    const d = toHistoryDetail({ ...base, answerable: true, answer: [{ type: 'paragraph', text: '답' }] });
    expect(d.snapshot).toBe(false);
    expect(d.result?.citations).toEqual([]);
    expect(d.result?.blocks).toHaveLength(1);
  });

  it('답하지 못한 기록은 까닭과 살펴본 조문', () => {
    const d = toHistoryDetail({ ...base, reason: 'no_basis', contextRowCount: 1, citations: [], lawCitations: [], consulted });
    expect(d.result).toEqual({ answerable: false, reason: 'no_basis', blocks: [], citations: [], lawCitations: [], consulted });
  });

  it('오류로 끝난 기록은 답이 없고, 내부 오류 문구를 어디에도 싣지 않는다', () => {
    const secret = 'PrismaClientKnownRequestError: relation "x" does not exist at 10.1.2.3';
    const d = toHistoryDetail({ ...base, failure: secret });
    expect(d.outcome).toBe('failed');
    expect(d.result).toBeNull();
    expect(JSON.stringify(d)).not.toContain('Prisma');
    expect(JSON.stringify(toHistoryItem({ ...base, failure: secret }))).not.toContain('10.1.2.3');
  });
});
