/**
 * 규정 질문 입력 규칙과 넘겨받은 질문 처리 (T-217, SRS SEARCH-9 ③·SEARCH-6).
 * 대시보드 입구가 라우터 state 로 넘긴 질문만 한 번 보낸다. 주소(`?q=`)는 누구나 링크로 퍼뜨릴 수 있으므로
 * 채우기만 한다 — 링크를 누르는 것만으로 고지도 보기 전에 남의 글이 외부 AI 로 나가고 내 한도를 쓰면 안 된다.
 */
import { describe, expect, it } from 'vitest';
import {
  ASK_MAX_CHARS,
  ASK_ONCE_STATE,
  canAskNow,
  canSubmitQuestion,
  decideIncomingQuestion,
  incomingQuestion,
  normalizeQuestion,
} from '../apps/web/src/lib/askQuestion';

describe('질문 길이 규칙 — 서버 AskDto 와 같다 (T-217)', () => {
  it('앞뒤 공백을 뗀 뒤 2~500자만 보낼 수 있다', () => {
    expect(canSubmitQuestion('가')).toBe(false);
    expect(canSubmitQuestion(' 가 ')).toBe(false);
    expect(canSubmitQuestion('   ')).toBe(false);
    expect(canSubmitQuestion('가나')).toBe(true);
    expect(canSubmitQuestion(` ${'가'.repeat(ASK_MAX_CHARS)} `)).toBe(true);
    expect(canSubmitQuestion('가'.repeat(ASK_MAX_CHARS + 1))).toBe(false);
    expect(normalizeQuestion('  경조금 ')).toBe('경조금');
  });

  it('서버에 AI 가 있고 회사가 켰을 때만 물을 수 있다', () => {
    expect(canAskNow(undefined)).toBe(false);
    expect(canAskNow({ configured: true, enabled: false })).toBe(false);
    expect(canAskNow({ configured: false, enabled: true })).toBe(false);
    expect(canAskNow({ configured: true, enabled: true })).toBe(true);
  });
});

describe('어디서 넘겨받은 질문인가 (T-217)', () => {
  it('라우터 state 로 넘긴 질문은 보낼 수 있는 것으로 읽는다(주소의 q 보다 먼저)', () => {
    expect(incomingQuestion({ [ASK_ONCE_STATE]: '경조금' }, '?q=다른글')).toEqual({ text: '경조금', autoSend: true });
  });

  it('주소의 q 는 보내지 않는 것으로 읽는다', () => {
    expect(incomingQuestion(null, '?q=%EC%97%B0%EC%B0%A8')).toEqual({ text: '연차', autoSend: false });
    expect(incomingQuestion({ other: 1 }, '?q=a&x=1')).toEqual({ text: 'a', autoSend: false });
  });

  it('state 가 글이 아니거나 아무것도 없으면 질문이 없다', () => {
    expect(incomingQuestion({ [ASK_ONCE_STATE]: 3 }, '')).toEqual({ text: null, autoSend: false });
    expect(incomingQuestion(undefined, '')).toEqual({ text: null, autoSend: false });
  });
});

describe('넘겨받은 질문은 한 번만 처리한다 (T-217)', () => {
  const base = { autoSend: true, handled: false, statusReady: true, canAsk: true, pending: false };

  it('넘겨받은 질문이 없으면 아무것도 하지 않는다', () => {
    expect(decideIncomingQuestion({ ...base, text: null })).toEqual({ kind: 'none' });
  });

  it('대시보드 입구가 넘긴 질문은 앞뒤 공백을 떼고 보낸다', () => {
    expect(decideIncomingQuestion({ ...base, text: ' 경조금 기준은? ' })).toEqual({ kind: 'send', question: '경조금 기준은?' });
  });

  it('주소로 온 질문은 절대 보내지 않고 입력칸에 채우기만 한다', () => {
    expect(decideIncomingQuestion({ ...base, autoSend: false, text: '연차휴가 며칠' })).toEqual({ kind: 'fill', question: '연차휴가 며칠' });
  });

  it('이미 처리한 이동이면 다시 처리하지 않고 지우기만 한다', () => {
    expect(decideIncomingQuestion({ ...base, text: '경조금', handled: true })).toEqual({ kind: 'clear' });
  });

  it('상태를 아직 모르거나 보내는 중이면 기다린다(지우지 않는다)', () => {
    expect(decideIncomingQuestion({ ...base, text: '경조금', statusReady: false })).toEqual({ kind: 'wait' });
    expect(decideIncomingQuestion({ ...base, text: '경조금', pending: true })).toEqual({ kind: 'wait' });
  });

  it('너무 짧으면 보내지도 채우지도 않고 지운다', () => {
    for (const text of ['', '가', '   ', ' 가 ']) {
      expect(decideIncomingQuestion({ ...base, text }), JSON.stringify(text)).toEqual({ kind: 'clear' });
      expect(decideIncomingQuestion({ ...base, autoSend: false, text }), JSON.stringify(text)).toEqual({ kind: 'clear' });
    }
  });

  it('지금 물을 수 없으면(꺼짐·미설정) 보내지 않고 지운다', () => {
    expect(decideIncomingQuestion({ ...base, text: '경조금', canAsk: false })).toEqual({ kind: 'clear' });
  });

  it('너무 길면 보내지 않고 500자로 잘라 입력칸에만 채운다', () => {
    const action = decideIncomingQuestion({ ...base, text: '가'.repeat(ASK_MAX_CHARS + 1) });
    expect(action.kind).toBe('fill');
    expect(action.kind === 'fill' && action.question.length).toBe(ASK_MAX_CHARS);
  });
});
