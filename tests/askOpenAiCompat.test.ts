import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { BadGatewayException, Logger, ServiceUnavailableException } from '@nestjs/common';
import { OpenAiCompatAskProvider, type OpenAiCompatConfig } from '../apps/api/src/ask/ask-openai-compat';
import { baseModel, parseJsonLoose } from '../apps/api/src/ask/ask-openai-util';
import { ASK_FORMAT_FAILED, AskBadResponseError, AskRefusedError } from '../apps/api/src/ask/ask-provider';
import { createAskProvider, readApiKey } from '../apps/api/src/ask/ask-provider-factory';

/**
 * T-208 무료 AI 제공사 묶음(freellmapi) — 허용 모델만 차례로, 허용 제공사만, 다시 보내기 전 회사 확인(T-146),
 * 형식 미달이면 다음 모델(T-207). 네트워크 없이 가짜 fetch 로 본다.
 */

const SECRET = '질문-비밀-문구-12345';
type Reply = { status?: number; routed?: string | null; body?: unknown; finish?: string; content?: string; throws?: string };

function fakeFetch(replies: Reply[]) {
  const sent: { model: string; format: string; auth: string }[] = [];
  const impl = vi.fn((_url: string, init: RequestInit): Promise<Response> => {
    const body = JSON.parse(init.body as string) as { model: string; response_format: { type: string } };
    sent.push({ model: body.model, format: body.response_format.type, auth: String((init.headers as Record<string, string>).authorization) });
    const r = replies.shift() ?? { status: 500 };
    if (r.throws) return Promise.reject(Object.assign(new Error('x'), { name: r.throws }));
    const status = r.status ?? 200;
    const json =
      r.body ??
      (status === 200
        ? {
            model: body.model,
            choices: [{ finish_reason: r.finish ?? 'stop', message: { content: r.content ?? JSON.stringify({ keys: ['K1'] }) } }],
            usage: { prompt_tokens: 100, completion_tokens: 20, prompt_tokens_details: { cached_tokens: 5 } },
          }
        : { error: { code: 'x' } });
    const headers = new Headers();
    if (r.routed !== null) headers.set('x-routed-via', r.routed ?? `google/${body.model}`);
    return Promise.resolve(new Response(JSON.stringify(json), { status, headers }));
  });
  return { impl, sent };
}

const provider = (impl: unknown, over: Partial<OpenAiCompatConfig> = {}) =>
  new OpenAiCompatAskProvider({
    baseUrl: 'http://freellmapi:3001/v1',
    apiKey: () => 'unified-key',
    models: ['gemini-3.8-flash', 'gemini-3.7-flash', 'qwen3.8-27b'],
    allowedPlatforms: ['google', 'groq'],
    fetchImpl: impl as typeof fetch,
    ...over,
  });

const answerInput = { context: `[R1] 제1조 ${SECRET}`, question: `${SECRET} 질문` };

afterEach(() => vi.restoreAllMocks());

describe('허용 모델을 차례로 부른다 (T-208)', () => {
  it('첫 모델이 답하면 그 답 — 모델 id 를 직접 지정하고 auto 는 보내지 않는다, 구조화 출력·통합 키 (T-208)', async () => {
    const { impl, sent } = fakeFetch([{}]);
    const out = await provider(impl).select({ toc: 'K1 | 인사규정 | 제1조(목적)', question: '목적?' });
    expect(out.keys).toEqual(['K1']);
    expect(out.usage).toEqual({ model: 'google/gemini-3.8-flash', inputTokens: 100, outputTokens: 20, cacheReadTokens: 5 });
    expect(sent).toEqual([{ model: 'gemini-3.8-flash', format: 'json_schema', auth: 'Bearer unified-key' }]);
  });

  it('한도(429)·키 없음(503)·연결 실패·시간 초과면 다음 모델로 — 사용량은 합친다 (T-208)', async () => {
    const { impl, sent } = fakeFetch([{ status: 429 }, { throws: 'AbortError' }, { routed: 'groq/qwen/qwen3.8-27b' }]);
    const out = await provider(impl).select({ toc: 'K1', question: 'q' });
    expect(sent.map((s) => s.model)).toEqual(['gemini-3.8-flash', 'gemini-3.7-flash', 'qwen3.8-27b']);
    expect(out.usage.model).toBe('groq/qwen/qwen3.8-27b');
  });

  it('모두 한도면 약한 모델로 내리지 않고 "잠시 후 다시" — 목록 밖 모델은 부르지 않는다 (T-208)', async () => {
    const { impl, sent } = fakeFetch([{ status: 429 }, { status: 429 }, { status: 503, body: { error: { code: 'no_providers_configured' } } }]);
    await expect(provider(impl).select({ toc: 'K1', question: 'q' })).rejects.toThrow('잠시 후 다시');
    expect(sent).toHaveLength(3);
  });

  it('모든 모델에 제공사 키가 없으면 설정 문제로 알린다 — 한도 문구와 다르다 (T-208)', async () => {
    const none = { status: 503, body: { error: { code: 'no_providers_configured' } } };
    const { impl } = fakeFetch([none, { status: 404, body: { error: { code: 'model_not_found' } } }, none]);
    const err = await provider(impl).select({ toc: 'K1', question: 'q' }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ServiceUnavailableException);
    expect((err as Error).message).toContain('제공사 키');
  });

  it('통합 키가 틀리면(401) 다른 모델로 넘기지 않고 바로 알린다 (T-208)', async () => {
    const { impl, sent } = fakeFetch([{ status: 401 }, {}]);
    await expect(provider(impl).select({ toc: 'K1', question: 'q' })).rejects.toThrow('키');
    expect(sent).toHaveLength(1);
  });

  it('통합 키가 아직 없으면 보내지 않는다 (T-208)', async () => {
    const { impl } = fakeFetch([{}]);
    await expect(provider(impl, { apiKey: () => '' }).select({ toc: 'K1', question: 'q' })).rejects.toThrow('준비되지 않았습니다');
    expect(impl).not.toHaveBeenCalled();
  });

  it('구조화 출력을 받지 않는 모델(400)이면 같은 모델에 JSON 모드로 한 번 더 보낸다 (T-208)', async () => {
    const { impl, sent } = fakeFetch([{ status: 400 }, {}]);
    await provider(impl).select({ toc: 'K1', question: 'q' });
    expect(sent.map((s) => `${s.model}:${s.format}`)).toEqual(['gemini-3.8-flash:json_schema', 'gemini-3.8-flash:json_object']);
  });
});

describe('허용 제공사만 — 고지에 없는 곳으로 새지 않게 (T-208, SEARCH-8)', () => {
  it('허용 밖 제공사가 답하면 그 답을 버리고 더 보내지 않는다 (T-208)', async () => {
    const { impl, sent } = fakeFetch([{ routed: 'kilo/gemini-3.8-flash' }, {}]);
    await expect(provider(impl).select({ toc: 'K1', question: 'q' })).rejects.toThrow('점검');
    expect(sent).toHaveLength(1);
  });

  it('답한 곳 표시가 없어도 허용 밖으로 본다 (T-208)', async () => {
    const { impl, sent } = fakeFetch([{ routed: null }, {}]);
    await expect(provider(impl).select({ toc: 'K1', question: 'q' })).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(sent).toHaveLength(1);
  });

  it('허용 제공사라도 목록 밖 모델이 답하면 그 답만 버리고 다음 모델 (T-208)', async () => {
    const { impl, sent } = fakeFetch([{ routed: 'google/gemini-3.5-flash-lite' }, {}]);
    const out = await provider(impl).select({ toc: 'K1', question: 'q' });
    expect(sent).toHaveLength(2);
    expect(out.usage.model).toBe('google/gemini-3.7-flash');
  });

  it('공통 이름으로 부른 모델은 제공사 이름으로 답해도 같은 모델이다 (T-208)', () => {
    expect(baseModel('groq/qwen/qwen3.8-27b'.slice('groq/'.length))).toBe('qwen3.8-27b');
    expect(baseModel('@cf/qwen/qwen3.8-27b')).toBe('qwen3.8-27b');
  });

  it('확인하지 않는 설정(allowedPlatforms null)이면 표시가 없어도 받는다 — 일반 OpenAI 호환 주소용 (T-208)', async () => {
    const { impl } = fakeFetch([{ routed: null }]);
    await expect(provider(impl, { allowedPlatforms: null }).select({ toc: 'K1', question: 'q' })).resolves.toMatchObject({ keys: ['K1'] });
  });
});

describe('형식 미달이면 다음 모델 (T-207·T-208)', () => {
  const report = (answerable: boolean) => JSON.stringify({ answerable });

  it('받아들이지 않은 답·JSON 이 아닌 답·길이 제한에서 끊긴 답은 다음 모델로 (T-207)', async () => {
    const { impl, sent } = fakeFetch([{ content: '그냥 글' }, { finish: 'length', content: '{' }, { content: report(true) }]);
    const accept = vi.fn((raw: unknown) => (raw as { answerable?: boolean }).answerable === true);
    const out = await provider(impl).answer(answerInput, undefined, accept);
    expect(sent).toHaveLength(3);
    expect(out.raw).toEqual({ answerable: true });
  });

  it('모든 모델이 형식 미달이면 "한 번 더 물어 달라" 안내 — 사용량은 실려 간다 (T-207)', async () => {
    const { impl } = fakeFetch([{ content: '{}' }, { content: '{}' }, { content: '{}' }]);
    const err = await provider(impl).answer(answerInput, undefined, () => false).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AskBadResponseError);
    expect((err as Error).message).toBe(ASK_FORMAT_FAILED);
    expect((err as AskBadResponseError).usage.inputTokens).toBe(300);
  });

  it('코드 펜스·군말이 붙은 JSON 도 읽는다 (T-207)', () => {
    expect(parseJsonLoose('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(parseJsonLoose('답입니다: {"a":{"b":2}} 끝')).toEqual({ a: { b: 2 } });
    expect(parseJsonLoose('없음')).toBeUndefined();
  });

  it('모든 모델이 거절하면 거절로 끝난다 (T-208)', async () => {
    const { impl } = fakeFetch([{ finish: 'content_filter' }, { finish: 'content_filter' }, { status: 429 }]);
    await expect(provider(impl).answer(answerInput)).rejects.toBeInstanceOf(AskRefusedError);
  });

  it('그 밖의 실패만 남으면 502 (T-208)', async () => {
    const { impl } = fakeFetch([{ status: 500 }, { status: 502 }, { throws: 'TypeError' }]);
    await expect(provider(impl).answer(answerInput)).rejects.toBeInstanceOf(BadGatewayException);
  });
});

describe('다시 보내기 전 회사 확인과 시간 상한 (T-146·T-208)', () => {
  it('두 번째 모델부터 보내기 직전마다 확인한다 — 첫 번째는 가드가 이미 확인했다 (T-146)', async () => {
    const { impl } = fakeFetch([{ status: 429 }, { status: 429 }, {}]);
    const beforeRetry = vi.fn(() => Promise.resolve());
    await provider(impl).select({ toc: 'K1', question: 'q' }, beforeRetry);
    expect(beforeRetry).toHaveBeenCalledTimes(2);
  });

  it('확인에서 막히면(그사이 관리자가 끔) 그 오류를 그대로 올리고 더 보내지 않는다 (T-146)', async () => {
    const { impl, sent } = fakeFetch([{ status: 429 }, {}]);
    const blocked = new Error('AI_QA_DISABLED');
    await expect(provider(impl).select({ toc: 'K1', question: 'q' }, () => Promise.reject(blocked))).rejects.toBe(blocked);
    expect(sent).toHaveLength(1);
  });

  it('단계 시간 상한을 넘으면 남은 모델을 부르지 않는다 (T-208)', async () => {
    let t = 0;
    const { impl, sent } = fakeFetch([{ status: 429 }, {}]);
    const p = provider(impl, { now: () => (t += 60_000), budgetMs: { select: 45_000, answer: 120_000 } });
    await expect(p.select({ toc: 'K1', question: 'q' })).rejects.toThrow();
    expect(sent).toHaveLength(1);
  });

  it('질문·본문·답은 로그에 남기지 않는다 (T-208)', async () => {
    const logged: string[] = [];
    for (const m of ['log', 'warn', 'error'] as const) {
      vi.spyOn(Logger.prototype, m).mockImplementation((msg: unknown) => void logged.push(String(msg)));
    }
    const { impl } = fakeFetch([{ status: 429 }, { content: `{"answerable":true,"lead":"${SECRET}"}` }, { content: '{}' }]);
    await provider(impl).answer(answerInput, undefined, () => false).catch(() => undefined);
    expect(logged.length).toBeGreaterThan(0);
    expect(logged.join('\n')).not.toContain(SECRET);
  });
});

describe('서버 설정으로 제공사 만들기 (T-208)', () => {
  it('freellmapi 면 무료 제공사, mock 이면 모의, 키가 있으면 Anthropic, 아니면 없음 (T-208)', () => {
    expect(createAskProvider({ AI_QA_PROVIDER: 'freellmapi' })?.name).toBe('freellmapi');
    expect(createAskProvider({ AI_QA_PROVIDER: 'mock' })?.name).toBe('mock');
    expect(createAskProvider({ ANTHROPIC_API_KEY: 'sk-test' })?.name).toBe('anthropic');
    expect(createAskProvider({})).toBeNull();
    expect(createAskProvider({ AI_QA_PROVIDER: 'auto' })).toBeNull();
  });

  it('통합 키는 값이 있으면 그것, 없으면 파일에서 — 파일이 없으면 빈 값 (T-208)', () => {
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const dir = mkdtempSync(join(tmpdir(), 'veda-key-'));
    const file = join(dir, 'unified-key');
    writeFileSync(file, 'freellmapi-abc\n');
    expect(readApiKey({ AI_QA_API_KEY: ' direct ', AI_QA_API_KEY_FILE: file })).toBe('direct');
    expect(readApiKey({ AI_QA_API_KEY_FILE: file })).toBe('freellmapi-abc');
    expect(readApiKey({ AI_QA_API_KEY_FILE: join(dir, 'none') })).toBe('');
    expect(readApiKey({})).toBe('');
  });
});

describe('검토 지적 반영 — 다시 보내기·마지막 수단·고르기·차단·설정 거르기 (T-208)', () => {
  it('구조화 출력 400 뒤 같은 모델에 다시 보낼 때도 회사 상태를 먼저 본다 — 막히면 보내지 않는다 (T-146·T-208)', async () => {
    const { impl, sent } = fakeFetch([{ status: 400 }, {}]);
    const blocked = new Error('AI_QA_DISABLED');
    await expect(provider(impl).select({ toc: 'K1', question: 'q' }, () => Promise.reject(blocked))).rejects.toBe(blocked);
    expect(sent).toHaveLength(1);
    const ok = fakeFetch([{ status: 400 }, {}]);
    const check = vi.fn(() => Promise.resolve());
    await provider(ok.impl).select({ toc: 'K1', question: 'q' }, check);
    expect(check).toHaveBeenCalledTimes(1);
  });

  it('근거가 맞지 않은 답은 다음 모델로 다시 받고, 끝내 없으면 그 답을 쓴다(마지막 수단) (SEARCH-7, T-207)', async () => {
    const a = fakeFetch([{ content: '{"n":1}' }, { content: '{"n":2}' }, { content: '{"n":3}' }]);
    const lastResort = (raw: unknown) => ((raw as { n: number }).n === 2 ? true : 'last-resort');
    expect((await provider(a.impl).answer(answerInput, undefined, lastResort)).raw).toEqual({ n: 2 });
    const b = fakeFetch([{ content: '{"n":1}' }, { content: '{"n":2}' }, { status: 429 }]);
    const out = await provider(b.impl).answer(answerInput, undefined, () => 'last-resort');
    expect(out.raw).toEqual({ n: 1 });
    expect(b.sent).toHaveLength(3);
  });

  it('고르기 답이 모든 모델에서 형식 미달이면 빈 목록으로 이어 간다 — Anthropic 과 같게 (T-208)', async () => {
    const { impl } = fakeFetch([{ content: '없음' }, { content: '{"x":1}' }, { finish: 'length' }]);
    const out = await provider(impl).select({ toc: 'K1', question: 'q' });
    expect(out.keys).toEqual([]);
  });

  it('허용 밖 제공사가 한 번 답하면 10분 동안 보내지 않는다 — 그 뒤에는 다시 보낸다 (T-208)', async () => {
    let t = 0;
    const { impl, sent } = fakeFetch([{ routed: 'aihorde/qwen3.8-27b' }, {}]);
    const p = provider(impl, { now: () => t });
    await expect(p.select({ toc: 'K1', question: 'q' })).rejects.toThrow('점검');
    t = 5 * 60_000;
    await expect(p.select({ toc: 'K1', question: 'q' })).rejects.toThrow('점검');
    expect(sent).toHaveLength(1);
    t = 11 * 60_000;
    await expect(p.select({ toc: 'K1', question: 'q' })).resolves.toMatchObject({ keys: ['K1'] });
    expect(sent).toHaveLength(2);
  });

  it('설정으로 고지 밖 제공사를 열거나 auto·fusion 을 쓸 수 없다 (T-208)', () => {
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const p = createAskProvider({
      AI_QA_PROVIDER: 'freellmapi',
      AI_QA_ALLOWED_PLATFORMS: 'google,kilo',
      AI_QA_MODELS: 'auto,fusion,auto:smart,gemini-3.8-flash',
      AI_QA_API_KEY: 'k',
    }) as unknown as { cfg: OpenAiCompatConfig };
    expect(p.cfg.allowedPlatforms).toEqual(['google']);
    expect(p.cfg.models).toEqual(['gemini-3.8-flash']);
  });
});
