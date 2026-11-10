import { describe, it, expect } from 'vitest';
import { createHash } from 'crypto';
import { HttpException } from '@nestjs/common';
import {
  AI_QA_NOTICE_HISTORY,
  AI_QA_NOTICE_VERSIONS,
  currentNoticeVersion,
  type AiQaState,
  aiQaNotice,
  aiQaState,
  assertAskAllowed,
  guardProvider,
} from '../apps/api/src/ask/ask-notice';
import { ASK_INFERENCE_GEO, type AskProvider, askRequest } from '../apps/api/src/ask/ask-provider';
import { askProviderKind } from '../apps/api/src/ask/ask-provider-kind';
import { ASK_MAX_GROUPS } from '../apps/api/src/ask/ask-text';
import { AI_QA_LOG_RETENTION_DAYS } from '../apps/api/src/ask/ask-retention';

// 고지 판은 제공사마다 다르다(T-208) — 상태 판정 표는 Anthropic 판으로 본다
const AI_QA_NOTICE_VERSION = AI_QA_NOTICE_VERSIONS.anthropic;

describe('규정 질문의 실제 켜짐 — 저장값과 동의 판 (T-146)', () => {
  it.each([
    [false, null, 'off'],
    [false, AI_QA_NOTICE_VERSION, 'off'],
    [true, null, 'stale'],
    [true, AI_QA_NOTICE_VERSION - 1, 'stale'],
    [true, AI_QA_NOTICE_VERSION + 1, 'stale'],
    [true, AI_QA_NOTICE_VERSION, 'on'],
  ] as const)('켜짐 %s · 확인한 판 %s → %s', (aiQaEnabled, aiQaNoticeVersion, expected) => {
    expect(aiQaState({ aiQaEnabled, aiQaNoticeVersion }, AI_QA_NOTICE_VERSION)).toBe(expected);
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
    const n = aiQaNotice('anthropic');
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
    const n = aiQaNotice('anthropic');
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
    for (const kind of ['anthropic', 'freellmapi'] as const) {
      expect(aiQaNotice(kind).retention.join(' ')).not.toMatch(/백업[^)]*\d+일 안에/);
      expect(aiQaNotice(kind).retention.join(' ')).toContain('백업 보관 기간 동안 남습니다');
    }
  });

  it('고지 본문을 고치면 판도 올린다 — 제공사별 판의 지문 (T-146·T-208·T-209)', () => {
    // 이 시험이 실패하면: 받는 곳·국가·항목·보관 기간·학습처럼 내용이 바뀐 것이면 AI_QA_NOTICE_VERSIONS 의 그 제공사 판을 올리고
    // 지문을 새로 적는다(판을 올리면 그 제공사로 켠 모든 회사가 관리자가 다시 확인할 때까지 꺼진다). 오탈자만 고친 것이면 지문만 새로 적는다.
    // 판 1(Anthropic, T-146) → 판 3: 보내는 항목에 연결된 법령 조문을 더했다(T-209). 판 2: 무료 제공사 묶음(T-208).
    const digest = (kind: 'anthropic' | 'freellmapi') =>
      createHash('sha256').update(JSON.stringify(aiQaNotice(kind))).digest('hex').slice(0, 16);
    expect({ version: AI_QA_NOTICE_VERSIONS.anthropic, digest: digest('anthropic') }).toEqual({ version: 3, digest: '82c9c8244c7af71b' });
    expect({ version: AI_QA_NOTICE_VERSIONS.freellmapi, digest: digest('freellmapi') }).toEqual({ version: 2, digest: '290cc7f135c49074' });
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

describe('제공사별 고지 — 무료 제공사 묶음은 판 2 (T-208, SEARCH-6·8)', () => {
  it('서버 설정으로 제공사를 고른다 — 모르는 값은 "설정 안 됨" (T-208)', () => {
    expect(askProviderKind({ AI_QA_PROVIDER: 'freellmapi' })).toBe('freellmapi');
    expect(askProviderKind({ AI_QA_PROVIDER: ' FreeLLMAPI ' })).toBe('freellmapi');
    expect(askProviderKind({ AI_QA_PROVIDER: 'mock' })).toBe('mock');
    expect(askProviderKind({ ANTHROPIC_API_KEY: 'k' })).toBe('anthropic');
    expect(askProviderKind({ AI_QA_PROVIDER: 'anthropic', ANTHROPIC_API_KEY: 'k' })).toBe('anthropic');
    expect(askProviderKind({ AI_QA_PROVIDER: 'anthropic' })).toBeNull();
    expect(askProviderKind({})).toBeNull();
    expect(askProviderKind({ AI_QA_PROVIDER: 'openrouter', ANTHROPIC_API_KEY: 'k' })).toBeNull();
  });

  it('지금 판은 서버가 쓰는 제공사를 따른다 — 모의 AI 는 Anthropic 고지 (T-208)', () => {
    expect(currentNoticeVersion('freellmapi')).toBe(AI_QA_NOTICE_VERSIONS.freellmapi);
    expect(currentNoticeVersion('anthropic')).toBe(AI_QA_NOTICE_VERSIONS.anthropic);
    expect(currentNoticeVersion('mock')).toBe(AI_QA_NOTICE_VERSIONS.anthropic);
    expect(currentNoticeVersion(null)).toBe(AI_QA_NOTICE_VERSIONS.anthropic);
    expect(AI_QA_NOTICE_VERSIONS.freellmapi).not.toBe(AI_QA_NOTICE_VERSIONS.anthropic);
  });

  it('판 번호는 제공사끼리 한 번도 겹치지 않는다 — 지금 판은 제 기록 안에 있다 (T-208)', () => {
    const all = Object.entries(AI_QA_NOTICE_HISTORY).flatMap(([kind, vs]) => vs.map((v) => `${v}:${kind}`));
    const versions = all.map((x) => Number(x.split(':')[0]));
    expect(new Set(versions).size, all.join(' ')).toBe(versions.length);
    for (const [kind, v] of Object.entries(AI_QA_NOTICE_VERSIONS)) {
      expect(AI_QA_NOTICE_HISTORY[kind as keyof typeof AI_QA_NOTICE_HISTORY]).toContain(v);
    }
  });

  it('제공사를 바꾸면 이전 제공사 고지에 동의한 회사는 다시 확인할 때까지 꺼진다 (T-208)', () => {
    const consentedAnthropic = { aiQaEnabled: true, aiQaNoticeVersion: AI_QA_NOTICE_VERSIONS.anthropic };
    expect(aiQaState(consentedAnthropic, currentNoticeVersion('anthropic'))).toBe('on');
    expect(aiQaState(consentedAnthropic, currentNoticeVersion('freellmapi'))).toBe('stale');
    const consentedOldV1 = { aiQaEnabled: true, aiQaNoticeVersion: 1 };
    expect(aiQaState(consentedOldV1, currentNoticeVersion('anthropic'))).toBe('stale');
  });

  it('무료 제공사 고지는 받는 곳·학습·사람 검토·민감정보 주의를 그대로 적는다 — "학습 미사용"이라고 말하지 않는다 (T-208)', () => {
    const n = aiQaNotice('freellmapi');
    expect(n.version).toBe(2);
    expect(n.recipient).toContain('Google LLC');
    expect(n.recipient).toContain('Groq');
    expect(n.country).toContain('지정할 수 없습니다');
    expect(n.training).toContain('학습에 쓸 수 있습니다');
    expect(n.training).not.toContain('쓰지 않습니다');
    expect(n.retention.join(' ')).toContain('사람이 검토할 수 있습니다');
    expect(n.retention.join(' ')).toContain('최대 30일');
    expect(n.caution).toContain('기밀');
    expect(n.summary).toContain('학습에 쓸 수 있습니다');
    expect(n.summary).toContain(`${AI_QA_LOG_RETENTION_DAYS}일 보관`);
  });

  it('두 고지 모두 보내는 항목에 연결된 법령 조문을 적는다 (T-209)', () => {
    for (const kind of ['anthropic', 'freellmapi'] as const) {
      const sent = aiQaNotice(kind).sent.join(' / ');
      expect(sent).toContain('법령 연결의 법령 조문');
      expect(sent).toContain(`최대 ${ASK_MAX_GROUPS}개 조`);
    }
  });
});
