import Anthropic from '@anthropic-ai/sdk';

/**
 * 규정 질문의 AI 호출 다시 보내기 (T-146).
 *
 * SDK 의 자동 재시도는 끈다(`maxRetries: 0`). SDK 안에서 다시 보내면 "보내기 직전 회사 상태 확인"을 거치지 않아,
 * 첫 시도가 오래 걸리거나(최대 120초) 실패한 사이 관리자가 끈 뒤에도 같은 질문·조문이 다시 나간다.
 * SDK 와 같은 기준(연결 실패·시간 초과·408·409·429·5xx, 서버가 주는 x-should-retry)으로 두 번까지 여기서 다시
 * 보내고, 다시 보내기 직전마다 `beforeRetry`(회사 상태 확인)를 부른다 — 그것이 던지면 다시 보내지 않는다.
 */
export const ASK_MAX_RETRIES = 2;

export function isRetryable(e: unknown): boolean {
  if (e instanceof Anthropic.APIConnectionError) return true; // 시간 초과 포함
  if (!(e instanceof Anthropic.APIError) || e.status === undefined) return false;
  const should = e.headers?.get('x-should-retry');
  if (should === 'true') return true;
  if (should === 'false') return false;
  return e.status === 408 || e.status === 409 || e.status === 429 || e.status >= 500;
}

/** 서버가 기다릴 시간을 1분 안으로 주면 따르고, 아니면 0.5초에서 두 배씩(최대 8초, 조금 흔든다) — SDK 와 같은 기준 */
export function retryDelayMs(e: unknown, retry: number): number {
  const headers = e instanceof Anthropic.APIError ? e.headers : undefined;
  const ms = parseFloat(headers?.get('retry-after-ms') ?? '');
  if (ms > 0 && ms <= 60_000) return ms;
  const sec = parseFloat(headers?.get('retry-after') ?? '');
  if (sec > 0 && sec <= 60) return sec * 1000;
  return Math.min(500 * 2 ** retry, 8000) * (1 - Math.random() * 0.25);
}

export interface RetryOptions {
  /** 다시 보내기 직전마다 — 던지면 다시 보내지 않고 그 오류를 올린다(회사 상태 확인) */
  beforeRetry?: () => Promise<void>;
  /** 다시 보내기로 한 실패마다(몇 번째 다시 보내기인지와 함께) — 확인에서 막혀 끝나도 AI 오류가 기록에 남게 */
  onRetry?: (e: unknown, retry: number) => void;
  wait?: (ms: number) => Promise<void>;
}

export async function withRetry<T>(send: () => Promise<T>, opts: RetryOptions = {}): Promise<T> {
  const wait = opts.wait ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  for (let retry = 0; ; retry++) {
    try {
      return await send();
    } catch (e) {
      if (retry >= ASK_MAX_RETRIES || !isRetryable(e)) throw e;
      opts.onRetry?.(e, retry + 1);
      await wait(retryDelayMs(e, retry));
      if (opts.beforeRetry) await opts.beforeRetry();
    }
  }
}
