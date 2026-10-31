import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BadGatewayException, HttpException, Logger } from '@nestjs/common';

// 실제 SDK 대신 요청을 받아 두는 가짜 — 처리 지역과 다시 보내기를 본다(네트워크 없음).
// 오류 클래스(Anthropic.APIError 등)는 진짜를 쓴다 — 실패 처리와 다시 보내기 판단이 instanceof 로 한다
const { create, made } = vi.hoisted(() => ({ create: vi.fn(), made: [] as unknown[] }));
vi.mock('@anthropic-ai/sdk', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@anthropic-ai/sdk')>();
  class FakeAnthropic {
    beta = { messages: { create } };
    constructor(opts: unknown) {
      made.push(opts);
    }
  }
  Object.setPrototypeOf(FakeAnthropic, actual.default);
  return { ...actual, default: FakeAnthropic };
});

import { APIConnectionError, APIError } from '@anthropic-ai/sdk';
import { AnthropicAskProvider, AskBadResponseError } from '../apps/api/src/ask/ask-provider';

const reply = (text: string) => ({
  model: 'claude-opus-5-5',
  stop_reason: 'end_turn',
  usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, inference_geo: 'us' },
  content: [{ type: 'text', text }],
});

describe('Anthropic 호출 — 고르기·답하기 모두 처리 지역 미국 (T-146)', () => {
  beforeEach(() => create.mockReset());

  it('고르기 요청', async () => {
    create.mockResolvedValueOnce(reply('{"keys":[]}'));
    await new AnthropicAskProvider('test-key').select({ toc: 'K1 | 인사규정 | 제1조(목적)', question: '목적은?' });
    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0][0].inference_geo).toBe('us');
  });

  it('답하기 요청', async () => {
    create.mockResolvedValueOnce(reply('{"answerable":false,"blocks":[],"citations":[]}'));
    await new AnthropicAskProvider('test-key').answer({ context: '<규정></규정>', question: '목적은?' });
    expect(create.mock.calls[0][0].inference_geo).toBe('us');
  });

  it('JSON 으로 읽지 못한 응답은 내용 없이 길이만 경고에 남긴다 — 컨테이너 로그는 질문 기록의 90일 파기 밖이다', async () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    try {
      create.mockResolvedValueOnce(reply('직원 병가 사유 메모 — JSON 아님'));
      const sent = new AnthropicAskProvider('test-key').select({ toc: 'K1 | 인사규정 | 제1조(목적)', question: '목적은?' });
      await expect(sent).rejects.toBeInstanceOf(AskBadResponseError);
      const logged = warn.mock.calls.map(([m]) => String(m)).join('\n');
      expect(logged).toContain('JSON 으로 읽지 못함');
      expect(logged).not.toContain('병가 사유');
      expect(logged).not.toContain('직원'); // 앞 몇 글자만 찍는 것도 안 된다
    } finally {
      warn.mockRestore();
    }
  });

  it('응답의 처리 지역이 us 가 아니거나 없으면 경고를 남긴다 — 운영 키 투입 뒤 확인하는 경고(런북 7-9)', async () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    try {
      for (const geo of ['us', 'eu', undefined]) {
        warn.mockClear();
        const r = reply('{"keys":[]}');
        const usage: Record<string, unknown> = { ...r.usage };
        if (geo) usage.inference_geo = geo;
        else delete usage.inference_geo;
        create.mockResolvedValueOnce({ ...r, usage });
        await new AnthropicAskProvider('test-key').select({ toc: 'K1 | 인사규정 | 제1조(목적)', question: '목적은?' });
        expect(warn.mock.calls.some(([m]) => String(m).includes('AI 처리 지역'))).toBe(geo !== 'us');
      }
    } finally {
      warn.mockRestore();
    }
  });
});

describe('Anthropic 호출 — 다시 보내기는 SDK 대신 직접, 다시 보내기 직전마다 확인 (T-146)', () => {
  beforeEach(() => create.mockReset());

  it('SDK 자동 재시도는 끈다 — SDK 안에서 다시 보내면 회사 상태 확인을 거치지 않는다', () => {
    new AnthropicAskProvider('test-key');
    expect(made.at(-1)).toMatchObject({ maxRetries: 0 });
  });

  it('다시 보내기 전 확인에서 막히면(관리자가 끔) 다시 보내지 않고 403 을 그대로 올린다 — AI 실패(502)로 바꾸지 않는다', async () => {
    create.mockRejectedValueOnce(APIError.generate(529, undefined, 'overloaded', new Headers({ 'retry-after-ms': '1' })));
    const off = new HttpException({ statusCode: 403, code: 'AI_QA_DISABLED' }, 403);
    const sent = new AnthropicAskProvider('test-key').answer({ context: '<규정></규정>', question: '목적은?' }, () => Promise.reject(off));
    await expect(sent).rejects.toBe(off);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('확인하다 난 오류(DB 끊김 등)는 AI 실패(502)로 바꾸지 않고 그대로 올린다 — 직전 AI 오류는 경고로 남긴다', async () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    try {
      create.mockRejectedValueOnce(APIError.generate(529, undefined, 'overloaded', new Headers({ 'retry-after-ms': '1' })));
      const dbDown = new Error('db down');
      const sent = new AnthropicAskProvider('test-key').answer({ context: '<규정></규정>', question: '목적은?' }, () => Promise.reject(dbDown));
      await expect(sent).rejects.toBe(dbDown);
      expect(warn.mock.calls.map(([m]) => String(m))).toEqual([
        expect.stringContaining('1/2번째로 다시 보내기 전: 529 overloaded'),
        expect.stringContaining('확인에서 막혀 보내지 않음: db down'),
      ]);
    } finally {
      warn.mockRestore();
    }
  });

  it('SDK 호출 안에서 난 SDK 밖 오류(응답 본문 읽기 실패 등)는 전처럼 AI 실패(502)로 바꾸고, 메시지 대신 이름만 남긴다', async () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    try {
      // V8 의 JSON 파싱 오류 메시지에는 입력 일부가 담긴다
      create.mockRejectedValueOnce(new SyntaxError('Unexpected token, "직원 병가 사유 메모" is not valid JSON'));
      const sent = new AnthropicAskProvider('test-key').select({ toc: 'K1 | 인사규정 | 제1조(목적)', question: '목적은?' }, () => Promise.resolve());
      await expect(sent).rejects.toBeInstanceOf(BadGatewayException);
      expect(create).toHaveBeenCalledTimes(1);
      const logged = warn.mock.calls.map(([m]) => String(m)).join('\n');
      expect(logged).toContain('AI 호출 실패: SyntaxError');
      expect(logged).not.toContain('병가');
    } finally {
      warn.mockRestore();
    }
  });

  it('확인을 통과하면 다시 보낸다', async () => {
    create.mockRejectedValueOnce(new APIConnectionError({ message: 'socket hang up' }));
    create.mockResolvedValueOnce(reply('{"keys":[]}'));
    let checks = 0;
    await new AnthropicAskProvider('test-key').select({ toc: 'K1 | 인사규정 | 제1조(목적)', question: '목적은?' }, () => {
      checks++;
      return Promise.resolve();
    });
    expect(create).toHaveBeenCalledTimes(2);
    expect(checks).toBe(1);
  });
});
