import { createHash } from 'crypto';

/**
 * 로그인 세션의 수명 (T-137).
 *
 * - **자동 로그인**(remember): 30일. 브라우저를 껐다 켜도 유지된다.
 * - 그렇지 않으면 12시간. 화면은 브라우저를 닫을 때 로그인 정보를 지운다(서버는 12시간 뒤 끝낸다).
 *
 * 둘 다 "마지막으로 쓴 뒤로" 센다 — 갱신할 때마다 다시 늘어난다. 매일 쓰는 사람은 자동 로그인이면
 * 계속 로그인돼 있고, 한 달 동안 안 쓰면 다시 로그인한다.
 *
 * 값은 `AUTH_REMEMBER_TTL`·`AUTH_SESSION_TTL`(예: `30d`·`12h`·`90m`)로 바꿀 수 있다. 형식이
 * 틀리면 기본값을 쓴다 — 설정 오타로 서버가 뜨지 않거나 세션이 0초가 되면 안 된다.
 */
export const DEFAULT_REMEMBER_TTL = '30d';
export const DEFAULT_SESSION_TTL = '12h';

const UNIT_MS: Record<string, number> = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 };

export function parseDurationMs(raw: string | undefined, fallback: string): number {
  const parse = (v: string): number | null => {
    const m = /^\s*(\d+)\s*([smhd])?\s*$/i.exec(v);
    if (!m) return null;
    const n = Number(m[1]) * UNIT_MS[(m[2] ?? 's').toLowerCase()];
    return n > 0 ? n : null;
  };
  return (raw !== undefined && parse(raw)) || (parse(fallback) as number);
}

export function sessionTtlMs(remember: boolean, env: NodeJS.ProcessEnv = process.env): number {
  return remember
    ? parseDurationMs(env.AUTH_REMEMBER_TTL, DEFAULT_REMEMBER_TTL)
    : parseDurationMs(env.AUTH_SESSION_TTL, DEFAULT_SESSION_TTL);
}

/** 갱신 토큰은 원문을 저장하지 않는다 — DB 가 새어도 그 값으로 로그인을 이어 갈 수 없게 */
export function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}
