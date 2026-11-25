import { describe, it, expect, beforeAll } from 'vitest';
import { execSync } from 'child_process';
import { api, createTenant, waitForApi, BASE } from './helpers';

/**
 * 토큰 갱신 (T-42), 구글 로그인 삭제 (T-136).
 *
 * 구글 로그인은 아스트룸이 고객사를 개설하고 마스터가 직원 계정을 발급하는 B2B 계정 체계(T-122)와
 * 맞지 않아 없앴다. 경로가 남아 있으면 설정 몇 줄로 다시 열리므로 없어졌는지(404) 본다.
 * 비밀번호 없이 구글로만 만든 예전 계정은 관리자가 비밀번호를 재설정해야 들어온다.
 */

function sql(query: string): string {
  return execSync(
    `docker compose exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -t -A -v ON_ERROR_STOP=1 -f -'`,
    { encoding: 'utf8', input: query },
  ).trim();
}

describe('구글 로그인 삭제 (T-136)', () => {
  let t: Awaited<ReturnType<typeof createTenant>>;

  beforeAll(async () => {
    await waitForApi();
    t = await createTenant('no-google');
  });

  it('구글 로그인 시작·콜백 경로가 없다 (404)', async () => {
    for (const path of [
      '/auth/google?mode=login&tenantSlug=demo',
      '/auth/google?mode=register&tenantSlug=x1&tenantName=y',
      '/auth/google/callback?code=fake&state=fake',
    ]) {
      const res = await fetch(`${BASE}${path}`, { redirect: 'manual' });
      expect(res.status, path).toBe(404);
    }
  });

  it('비밀번호 없는 예전 구글 계정은 PASSWORD_NOT_SET 으로 안내받고, 관리자가 재설정하면 들어온다', async () => {
    const email = `legacy-google-${t.slug}@example.test`;
    const created = await api('/users', {
      method: 'POST',
      token: t.token,
      json: { email, password: 'TempPass!234', name: '예전 구글 계정', role: 'editor' },
    });
    expect(created.status).toBe(201);
    const id = created.body.id as string;
    // 예전 구글 로그인이 만든 모양 — 비밀번호 없이 구글 신원만 있다
    sql(`UPDATE users SET password_hash = NULL, oauth_provider = 'google', oauth_sub = 'legacy-${id}' WHERE id = '${id}';`);

    const denied = await api('/auth/login', {
      method: 'POST',
      json: { email, password: 'TempPass!234', tenantSlug: t.slug },
    });
    expect(denied.status).toBe(401);
    expect(denied.body.code).toBe('PASSWORD_NOT_SET');

    const reset = await api(`/users/${id}/password`, {
      method: 'POST',
      token: t.token,
      json: { newPassword: 'ResetPass!234' },
    });
    expect(reset.status).toBe(200);

    const ok = await api('/auth/login', {
      method: 'POST',
      json: { email, password: 'ResetPass!234', tenantSlug: t.slug },
    });
    expect(ok.status).toBe(200);
    // 관리자가 정해 준 비밀번호이므로 첫 로그인 때 바꾸게 된다(T-122)
    expect(ok.body.user.mustChangePassword).toBe(true);
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
