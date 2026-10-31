import { describe, it, expect } from 'vitest';
import {
  hashRefreshToken,
  parseDurationMs,
  sessionTtlMs,
} from '../apps/api/src/auth/session-policy';

const H = 3_600_000;
const D = 24 * H;

describe('sessionTtlMs — 로그인 세션 수명 (T-137)', () => {
  it('자동 로그인은 30일, 아니면 12시간이 기본이다', () => {
    expect(sessionTtlMs(true, {})).toBe(30 * D);
    expect(sessionTtlMs(false, {})).toBe(12 * H);
  });

  it('환경변수로 바꿀 수 있다', () => {
    expect(sessionTtlMs(true, { AUTH_REMEMBER_TTL: '14d' })).toBe(14 * D);
    expect(sessionTtlMs(false, { AUTH_SESSION_TTL: '90m' })).toBe(90 * 60_000);
  });

  /** 설정 오타로 서버가 뜨지 않거나, 세션이 0초가 돼 아무도 로그인할 수 없으면 안 된다 */
  it('형식이 틀리거나 0 이면 기본값을 쓴다', () => {
    for (const bad of ['', 'abc', '0', '0d', '-5h', '3 weeks', '1.5h']) {
      expect(sessionTtlMs(true, { AUTH_REMEMBER_TTL: bad }), bad).toBe(30 * D);
      expect(sessionTtlMs(false, { AUTH_SESSION_TTL: bad }), bad).toBe(12 * H);
    }
  });

  it('단위가 없으면 초로 읽는다', () => {
    expect(parseDurationMs('45', '1h')).toBe(45_000);
    expect(parseDurationMs(' 2H ', '1h')).toBe(2 * H);
  });
});

describe('hashRefreshToken — 갱신 토큰은 원문을 저장하지 않는다', () => {
  it('sha256 16진수 64자, 같은 토큰은 같은 값, 다른 토큰은 다른 값', () => {
    const a = hashRefreshToken('token-a');
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(hashRefreshToken('token-a')).toBe(a);
    expect(hashRefreshToken('token-b')).not.toBe(a);
    expect(a).not.toContain('token-a');
  });
});
