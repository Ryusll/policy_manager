import { describe, it, expect, beforeAll } from 'vitest';
import { api, createTenant, waitForApi, BASE } from './helpers';

/**
 * OAuth 콜백·토큰 갱신 (T-42).
 *
 * 구글이 없어도 확인할 수 있는 구간을 여기서 본다 — `state` 검증과 갱신 토큰이다.
 * 계정 판단(누구를 로그인시키는가)은 구글 응답이 있어야 해서
 * `tests/googleAccountResolution.test.ts` 로 떼어 놓았다.
 */

const FRONTEND_FAIL = /\/login\?error=oauth&reason=/;

async function callback(query: string): Promise<{ status: number; location: string }> {
  const res = await fetch(`${BASE}/auth/google/callback${query}`, { redirect: 'manual' });
  return { status: res.status, location: res.headers.get('location') || '' };
}

describe('OAuth 콜백 state (T-42)', () => {
  beforeAll(async () => {
    await waitForApi();
  });

  it('설정이 없으면 503, 있으면 서명된 state 와 쿠키를 함께 내린다', async () => {
    const res = await fetch(`${BASE}/auth/google?mode=login&tenantSlug=demo`, {
      redirect: 'manual',
    });
    // GOOGLE_CLIENT_ID 미설정이 기본값이다(SRS AUTH-2)
    if (res.status === 503) return;

    expect(res.status).toBe(302);
    const location = res.headers.get('location') || '';
    const state = new URL(location).searchParams.get('state') || '';
    // 서명이 붙으므로 `본문.서명` 두 토막이다 — 예전의 순수 base64 JSON 이 아니다
    expect(state.split('.')).toHaveLength(2);
    expect(res.headers.get('set-cookie') || '').toMatch(/oauth_state=/);
    expect(res.headers.get('set-cookie') || '').toMatch(/HttpOnly/i);
  });

  /**
   * 예전에는 코드 교환을 먼저 하고 state 를 나중에 봤다. state 가 없으면
   * passport 가 흐름을 다시 시작해 **accounts.google.com 으로 보냈다** —
   * 위조 콜백 하나가 매번 구글로 나가는 요청을 만들었다는 뜻이다.
   */
  it('state 가 없으면 구글로 가지 않고 바로 실패시킨다', async () => {
    const { status, location } = await callback('');
    expect(status).toBe(302);
    expect(location).not.toContain('accounts.google.com');
    expect(location).toMatch(FRONTEND_FAIL);
    expect(location).toContain('reason=state');
  });

  /** 감사 전 형식 — 서명 없는 base64 JSON. 이것이 통과하면 아무것도 막지 못한 것이다. */
  it('예전 형식으로 지어낸 state 는 거부한다', async () => {
    const forged = Buffer.from(
      JSON.stringify({ mode: 'login', tenantSlug: 'demo', tenantName: '' }),
    ).toString('base64url');
    const { location } = await callback(`?code=fake&state=${forged}`);
    expect(location).toContain('reason=state');
    expect(location).not.toContain('accounts.google.com');
  });

  it('서명 자리를 아무 값으로 채워도 거부한다', async () => {
    const body = Buffer.from(
      JSON.stringify({ m: 'login', s: 'demo', n: '', c: 'x', t: Date.now() }),
    ).toString('base64url');
    const { location } = await callback(`?code=fake&state=${body}.AAAAAAAA`);
    expect(location).toContain('reason=state');
  });

  /** 쿠키 없이는 통과할 수 없다 — 남의 콜백 URL 을 열어도 소용없다(로그인 CSRF) */
  it('state 만 있고 쿠키가 없으면 거부한다', async () => {
    const start = await fetch(`${BASE}/auth/google?mode=login&tenantSlug=demo`, {
      redirect: 'manual',
    });
    if (start.status === 503) return; // 구글 미설정 환경
    const state = new URL(start.headers.get('location') || '').searchParams.get('state') || '';
    // 쿠키를 일부러 싣지 않는다
    const { location } = await callback(`?code=fake&state=${encodeURIComponent(state)}`);
    expect(location).toContain('reason=state');
  });
});

describe('토큰 갱신 (T-42)', () => {
  let t: Awaited<ReturnType<typeof createTenant>>;
  let refreshToken: string;

  beforeAll(async () => {
    await waitForApi();
    t = await createTenant('refresh');
    refreshToken = t.refreshToken;
  });

  it('올바른 갱신 토큰이면 새 토큰을 준다', async () => {
    const { status, body } = await api('/auth/refresh', {
      method: 'POST',
      json: { refreshToken },
    });
    expect(status).toBe(200);
    expect(body.accessToken).toBeTruthy();
    expect(body.refreshToken).toBeTruthy();
    expect(body.refreshToken).not.toBe(refreshToken);
    refreshToken = body.refreshToken;
  });

  /** 회전한 뒤 옛 토큰이 계속 살아 있으면 회전의 의미가 없다 */
  it('회전된 옛 토큰은 더 이상 통하지 않는다', async () => {
    const { status } = await api('/auth/refresh', {
      method: 'POST',
      json: { refreshToken: t.refreshToken },
    });
    expect(status).toBe(401);
  });

  /**
   * 예전에는 컨트롤러가 JWT 를 검증 없이 잘라 `sub` 를 꺼냈다.
   * 형식이 어긋난 값이 들어오면 그 자리에서 터져 **500** 이 났다.
   */
  it.each(['abc', 'a.b', 'a.!!!.c', 'not-a-jwt-at-all'])(
    '형식이 어긋난 토큰(%s)은 500 이 아니라 401',
    async (bad) => {
      const { status } = await api('/auth/refresh', {
        method: 'POST',
        json: { refreshToken: bad },
      });
      expect(status).toBe(401);
    },
  );

  it('빈 문자열은 검증 단계에서 400', async () => {
    const { status } = await api('/auth/refresh', { method: 'POST', json: { refreshToken: '' } });
    expect(status).toBe(400);
  });

  /** 접근 토큰은 다른 시크릿으로 서명된다 — 갱신 토큰 자리에 넣을 수 없다 */
  it('접근 토큰을 갱신 토큰으로 쓸 수 없다', async () => {
    const { status } = await api('/auth/refresh', {
      method: 'POST',
      json: { refreshToken: t.token },
    });
    expect(status).toBe(401);
  });

  it('로그아웃하면 갱신도 막힌다', async () => {
    const fresh = await createTenant('refresh2');
    await api('/auth/logout', { method: 'POST', token: fresh.token });
    const { status } = await api('/auth/refresh', {
      method: 'POST',
      json: { refreshToken: fresh.refreshToken },
    });
    expect(status).toBe(401);
  });
});
