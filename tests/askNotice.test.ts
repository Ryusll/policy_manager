import { describe, it, expect } from 'vitest';
import { createHash } from 'crypto';
import { HttpException } from '@nestjs/common';
import {
  AI_QA_NOTICE_VERSION,
  type AiQaState,
  aiQaNotice,
  aiQaState,
  assertAskAllowed,
  guardProvider,
} from '../apps/api/src/ask/ask-notice';
import { ASK_INFERENCE_GEO, type AskProvider, askRequest } from '../apps/api/src/ask/ask-provider';
import { ASK_MAX_GROUPS } from '../apps/api/src/ask/ask-text';
import { AI_QA_LOG_RETENTION_DAYS } from '../apps/api/src/ask/ask-retention';

describe('규정 질문의 실제 켜짐 — 저장값과 동의 판 (T-146)', () => {
  it.each([
    [false, null, 'off'],
    [false, AI_QA_NOTICE_VERSION, 'off'],
    [true, null, 'stale'],
    [true, AI_QA_NOTICE_VERSION - 1, 'stale'],
    [true, AI_QA_NOTICE_VERSION + 1, 'stale'],
    [true, AI_QA_NOTICE_VERSION, 'on'],
  ] as const)('켜짐 %s · 확인한 판 %s → %s', (aiQaEnabled, aiQaNoticeVersion, expected) => {
    expect(aiQaState({ aiQaEnabled, aiQaNoticeVersion })).toBe(expected);
  });

  it('꺼짐과 "고지가 바뀌어 다시 확인 필요"는 서로 다른 code 의 403 — 켜짐만 통과', () => {
    expect(() => assertAskAllowed('on')).not.toThrow();
    const codeOf = (state: 'off' | 'stale') => {
      try {
        assertAskAllowed(state);
      } catch (e) {
        const err = e as HttpException;
        return { status: err.getStatus(), code: (err.getResponse() as { code: string }).code };
      }
      return null;
    };
    expect(codeOf('off')).toEqual({ status: 403, code: 'AI_QA_DISABLED' });
    expect(codeOf('stale')).toEqual({ status: 403, code: 'AI_QA_NOTICE_CHANGED' });
  });
});

describe('외부 전송 고지 — 받는 곳·국가·보내는 항목·보관 기간 (T-146, SEARCH-6)', () => {
  it('고지에 네 가지가 모두 있다', () => {
    const n = aiQaNotice();
    expect(n.version).toBe(AI_QA_NOTICE_VERSION);
    expect(n.recipient).toBe('Anthropic, PBC');
    expect(n.country).toContain('미국');
    const sent = n.sent.join(' / ');
    expect(sent).toContain('질문');
    expect(sent).toContain('조 목차');
    expect(sent).toContain('조문의 본문');
    expect(n.retention.join(' ')).toContain('30일');
    expect(n.retention.join(' ')).toContain('90일');
    expect(n.control).toContain('끌 수 있');
  });

  it('고지는 코드의 실제 값과 묶여 있다 — 조문 상한·보관 일수·동의 문장·한 줄 요약(바꾸면 지문이 바뀌어 판을 올리게 된다)', () => {
    const n = aiQaNotice();
    expect(n.sent.join(' ')).toContain(`최대 ${ASK_MAX_GROUPS}개 조`);
    expect(n.retention.join(' ')).toContain(`${AI_QA_LOG_RETENTION_DAYS}일 보관`);
    expect(n.consentStatement).toContain('동의합니다');
    expect(n.control).toContain('끈 뒤로는');
    // 질문 화면의 한 줄 요약도 고지에서 온다 — 보내는 항목 셋·받는 곳·국가·보관 일수
    for (const part of ['질문', '조 목차', '관련 조문', n.recipient, '미국', `${AI_QA_LOG_RETENTION_DAYS}일 보관`]) {
      expect(n.summary).toContain(part);
    }
  });

  it('백업 사본을 "며칠 안에 지운다"고 단정하지 않는다 — 배포 전 덤프는 지금 자동으로 지워지지 않는다', () => {
    expect(aiQaNotice().retention.join(' ')).not.toMatch(/백업[^)]*\d+일 안에/);
    expect(aiQaNotice().retention.join(' ')).toContain('백업 보관 기간 동안 남습니다');
  });

  it('고지 본문을 고치면 판도 올린다 — 판 1 의 지문', () => {
    // 이 시험이 실패하면: 받는 곳·국가·항목·보관 기간처럼 내용이 바뀐 것이면 AI_QA_NOTICE_VERSION 을 올리고 지문을 새로 적는다
    // (판을 올리면 모든 회사가 관리자가 다시 확인할 때까지 꺼진다). 오탈자만 고친 것이면 지문만 새로 적는다.
    const digest = createHash('sha256').update(JSON.stringify(aiQaNotice())).digest('hex').slice(0, 16);
    expect({ version: AI_QA_NOTICE_VERSION, digest }).toEqual({ version: 1, digest: '22b181f35f8a96bb' });
  });
});

describe('외부로 보내기 직전마다 다시 본다 — 끈 뒤로는 보내지 않는다 (T-146)', () => {
  const fake = () => {
    const calls: string[] = [];
    const usage = { model: 'mock', inputTokens: 0, outputTokens: 0, cacheReadTokens: 0 };
    const provider: AskProvider = {
      name: 'mock',
      select: () => {
        calls.push('select');
        return Promise.resolve({ keys: [], usage });
      },
      answer: () => {
        calls.push('answer');
        return Promise.resolve({ raw: {}, usage });
      },
    };
    return { provider, calls };
  };
  const codeOf = async (p: Promise<unknown>) => {
    try {
      await p;
      return null;
    } catch (e) {
      return ((e as HttpException).getResponse() as { code: string }).code;
    }
  };
  const select = { toc: '1 | 제1조(목적)', question: '목적' };
  const answer = { context: '[R1] 본문', question: '목적' };

  it('고르기 전에 꺼졌으면 고르기도 부르지 않는다 — AI 를 부른 것으로 치지 않는다(한도에서 돌려준다)', async () => {
    const { provider, calls } = fake();
    const g = guardProvider(provider, () => Promise.resolve<AiQaState>('off'));
    expect(await codeOf(g.provider.select(select))).toBe('AI_QA_DISABLED');
    expect(calls).toEqual([]);
    expect(g.called()).toBe(false);
  });

  it('고른 뒤 답하기 전에 꺼졌으면 조문 본문을 보내지 않는다 — 고르기는 불렀으니 AI 를 부른 것으로 친다', async () => {
    const { provider, calls } = fake();
    const states: AiQaState[] = ['on', 'off'];
    const g = guardProvider(provider, () => Promise.resolve(states.shift() ?? 'off'));
    await g.provider.select(select);
    expect(await codeOf(g.provider.answer(answer))).toBe('AI_QA_DISABLED');
    expect(calls).toEqual(['select']);
    expect(g.called()).toBe(true);
  });

  it('그사이 고지 판이 바뀐 것도 같은 자리에서 막는다', async () => {
    const { provider, calls } = fake();
    const g = guardProvider(provider, () => Promise.resolve<AiQaState>('stale'));
    expect(await codeOf(g.provider.select(select))).toBe('AI_QA_NOTICE_CHANGED');
    expect(await codeOf(g.provider.answer(answer))).toBe('AI_QA_NOTICE_CHANGED');
    expect(calls).toEqual([]);
  });

  it('실패한 호출을 다시 보낼 때도 확인한다 — 첫 시도 뒤 꺼졌으면 다시 보내지 않는다(고르기·답하기 모두)', async () => {
    const sent: string[] = [];
    const usage = { model: 'anthropic', inputTokens: 0, outputTokens: 0, cacheReadTokens: 0 };
    const retryOnce = async (what: string, beforeRetry?: () => Promise<void>) => {
      sent.push(`${what} 1st`);
      if (beforeRetry) await beforeRetry(); // 첫 시도가 실패해 다시 보내려는 자리(ask-retry.ts)
      sent.push(`${what} 2nd`);
    };
    const retrying: AskProvider = {
      name: 'anthropic',
      select: async (_input, beforeRetry) => {
        await retryOnce('select', beforeRetry);
        return { keys: [], usage };
      },
      answer: async (_input, beforeRetry) => {
        await retryOnce('answer', beforeRetry);
        return { raw: {}, usage };
      },
    };
    const calls: [string, (g: ReturnType<typeof guardProvider>) => Promise<unknown>][] = [
      ['select', (g) => g.provider.select(select)],
      ['answer', (g) => g.provider.answer(answer)],
    ];
    for (const [what, call] of calls) {
      sent.length = 0;
      const states: AiQaState[] = ['on', 'off'];
      const g = guardProvider(retrying, () => Promise.resolve(states.shift() ?? 'off'));
      expect(await codeOf(call(g))).toBe('AI_QA_DISABLED');
      expect(sent).toEqual([`${what} 1st`]);
    }
  });

  it('켜져 있으면 그대로 넘기되, 부를 때마다 상태를 새로 읽는다', async () => {
    const { provider, calls } = fake();
    let reads = 0;
    const g = guardProvider(provider, () => {
      reads++;
      return Promise.resolve<AiQaState>('on');
    });
    expect(g.called()).toBe(false);
    await g.provider.select(select);
    await g.provider.answer(answer);
    expect(calls).toEqual(['select', 'answer']);
    expect(reads).toBe(2);
    expect(g.called()).toBe(true);
    expect(g.provider.name).toBe('mock');
  });
});

describe('Anthropic 요청 — 처리 지역을 미국으로 고정 (T-146, ADR-0025)', () => {
  it('고르기·답하기가 함께 쓰는 요청 본문에 inference_geo: us', () => {
    const req = askRequest('claude-opus-5-5', { max_tokens: 100, effort: 'low', system: [], user: '질문', schema: {} });
    expect(ASK_INFERENCE_GEO).toBe('us');
    expect(req.inference_geo).toBe('us');
    // 거절 시 다른 모델로 다시 돌리는 설정은 그대로
    expect(req).toMatchObject({ fallbacks: 'default', betas: ['server-side-fallback-2026-07-01'] });
  });
});
