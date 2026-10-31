import { describe, it, expect } from 'vitest';
import { APIConnectionError, APIConnectionTimeoutError, APIError, APIUserAbortError } from '@anthropic-ai/sdk';
import { HttpException } from '@nestjs/common';
import { ASK_MAX_RETRIES, isRetryable, retryDelayMs, withRetry } from '../apps/api/src/ask/ask-retry';

const apiError = (status: number, headers: Record<string, string> = {}) =>
  APIError.generate(status, undefined, `HTTP ${status}`, new Headers(headers));
const noWait = () => Promise.resolve();

describe('AI 호출 다시 보내기 — SDK 대신 직접, 다시 보내기 직전마다 회사 상태 확인 (T-146)', () => {
  it('다시 보낼 실패면 두 번까지 다시 보내고, 다시 보내기 직전마다 확인한다', async () => {
    const log: string[] = [];
    const failures: Error[] = [new APIConnectionTimeoutError(), apiError(529)];
    const result = await withRetry(
      () => {
        log.push('send');
        const e = failures.shift();
        return e ? Promise.reject(e) : Promise.resolve('ok');
      },
      {
        beforeRetry: () => {
          log.push('check');
          return Promise.resolve();
        },
        onRetry: (e, n) => log.push(`retry ${n} ${e instanceof APIError ? e.status ?? 'conn' : '?'}`),
        wait: noWait,
      },
    );
    expect(result).toBe('ok');
    expect(log).toEqual(['send', 'retry 1 conn', 'check', 'send', 'retry 2 529', 'check', 'send']);
  });

  it('확인에서 막히면(그사이 관리자가 끔) 다시 보내지 않고 그 403 을 그대로 올린다', async () => {
    let sends = 0;
    const logged: unknown[] = [];
    const overloaded = apiError(529);
    const off = new HttpException({ statusCode: 403, code: 'AI_QA_DISABLED' }, 403);
    const sent = withRetry(
      () => {
        sends++;
        return Promise.reject(overloaded);
      },
      { beforeRetry: () => Promise.reject(off), onRetry: (e) => logged.push(e), wait: noWait },
    );
    await expect(sent).rejects.toBe(off);
    expect(sends).toBe(1);
    expect(logged).toEqual([overloaded]); // 막혀 끝나도 직전 AI 오류는 기록 쪽으로 넘어갔다
  });

  it(`${ASK_MAX_RETRIES}번 넘게는 다시 보내지 않고 마지막 실패를 올린다`, async () => {
    let sends = 0;
    const last = apiError(503);
    const sent = withRetry(
      () => {
        sends++;
        return Promise.reject(sends > ASK_MAX_RETRIES ? last : apiError(529));
      },
      { wait: noWait },
    );
    await expect(sent).rejects.toBe(last);
    expect(sends).toBe(ASK_MAX_RETRIES + 1);
  });

  it('다시 보낼 수 없는 실패는 확인도 하지 않고 바로 올린다', async () => {
    const errors: Error[] = [apiError(400), apiError(401), apiError(403), apiError(404), apiError(422), new APIUserAbortError(), new Error('x')];
    for (const e of errors) {
      let sends = 0;
      let checks = 0;
      const sent = withRetry(
        () => {
          sends++;
          return Promise.reject(e);
        },
        {
          beforeRetry: () => {
            checks++;
            return Promise.resolve();
          },
          wait: noWait,
        },
      );
      await expect(sent).rejects.toBe(e);
      expect([sends, checks]).toEqual([1, 0]);
    }
  });

  it('SDK 와 같은 기준 — 연결 실패·시간 초과·408·409·429·5xx, 서버가 주는 x-should-retry 를 따른다', () => {
    expect(isRetryable(new APIConnectionError({ message: 'socket hang up' }))).toBe(true);
    expect(isRetryable(new APIConnectionTimeoutError())).toBe(true);
    for (const s of [408, 409, 429, 500, 529]) expect(isRetryable(apiError(s))).toBe(true);
    for (const s of [400, 401, 403, 404, 413, 422]) expect(isRetryable(apiError(s))).toBe(false);
    expect(isRetryable(apiError(400, { 'x-should-retry': 'true' }))).toBe(true);
    expect(isRetryable(apiError(529, { 'x-should-retry': 'false' }))).toBe(false);
  });

  it('기다릴 시간 — 서버가 1분 안으로 주면 따르고, 아니면 0.5초에서 두 배씩(최대 8초)', () => {
    expect(retryDelayMs(apiError(429, { 'retry-after-ms': '1500' }), 0)).toBe(1500);
    expect(retryDelayMs(apiError(429, { 'retry-after': '3' }), 0)).toBe(3000);
    const first = retryDelayMs(apiError(529), 0);
    expect(first).toBeGreaterThanOrEqual(375);
    expect(first).toBeLessThanOrEqual(500);
    const tooLong = retryDelayMs(apiError(529, { 'retry-after': '600' }), 1); // 1분 넘게 기다리라면 기본값
    expect(tooLong).toBeGreaterThanOrEqual(750);
    expect(tooLong).toBeLessThanOrEqual(1000);
    expect(retryDelayMs(apiError(529), 10)).toBeLessThanOrEqual(8000);
  });
});
