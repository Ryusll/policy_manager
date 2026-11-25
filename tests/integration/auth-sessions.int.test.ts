import { describe, it, expect, beforeAll } from 'vitest';
import { api, createTenant, waitForApi } from './helpers';

/**
 * 로그인 세션 — 기기마다 하나, 자동 로그인 (T-137).
 *
 * 예전에는 사용자당 갱신 토큰을 하나만 둬서 다른 PC 에서 로그인하면 먼저 쓰던 PC 가 튕겼다.
 * 또 화면이 갱신 때 받은 새 갱신 토큰을 버려서, 로그인 30분쯤 뒤 두 번째 갱신이 거절됐다.
 */
type Tenant = Awaited<ReturnType<typeof createTenant>>;

const loginAs = (t: Tenant, remember?: boolean) =>
  api('/auth/login', {
    method: 'POST',
    json: { email: t.email, password: t.password, tenantSlug: t.slug, ...(remember === undefined ? {} : { remember }) },
  });
const refresh = (refreshToken: string) => api('/auth/refresh', { method: 'POST', json: { refreshToken } });
const me = (token: string) => api('/auth/me', { method: 'POST', token });
const claims = (jwt: string) => JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString());

describe('로그인 세션 — 기기마다 하나, 자동 로그인 (T-137)', () => {
  let t: Tenant;

  beforeAll(async () => {
    await waitForApi();
    t = await createTenant('sess');
  });

  it('두 기기에서 로그인해도 서로 튕기지 않는다', async () => {
    const a = await loginAs(t);
    const b = await loginAs(t);
    const ra = await refresh(a.body.refreshToken);
    const rb = await refresh(b.body.refreshToken);
    expect(ra.status).toBe(200);
    expect(rb.status).toBe(200);
    expect((await me(ra.body.accessToken)).status).toBe(200);
    expect((await me(rb.body.accessToken)).status).toBe(200);
  });

  it('갱신하면 새 갱신 토큰을 주고 그걸로 계속 이어진다 — 쓴 토큰은 401', async () => {
    let token = (await loginAs(t)).body.refreshToken as string;
    for (let i = 1; i <= 3; i += 1) {
      const r = await refresh(token);
      expect(r.status, `${i}번째 갱신`).toBe(200);
      expect(r.body.refreshToken).not.toBe(token);
      expect((await refresh(token)).status, `${i}번째에 쓴 토큰`).toBe(401);
      token = r.body.refreshToken;
    }
  });

  /** 이미 받은 접근 토큰은 예전처럼 만료(15분)까지 통한다 — 갱신이 막히는 것으로 세션이 끝난다 */
  it('로그아웃은 그 기기만 끝낸다 — 그 기기는 갱신이 막히고, 다른 기기는 그대로', async () => {
    const a = await loginAs(t);
    const b = await loginAs(t);
    expect((await api('/auth/logout', { method: 'POST', token: a.body.accessToken })).status).toBe(200);
    expect((await refresh(a.body.refreshToken)).status).toBe(401);
    expect((await me(b.body.accessToken)).status).toBe(200);
    expect((await refresh(b.body.refreshToken)).status).toBe(200);
  });

  it('비밀번호를 바꾸면 모든 기기가 끊긴다 — 새 비밀번호로는 들어온다', async () => {
    const u = await createTenant('sess-pw');
    const a = await loginAs(u);
    const b = await loginAs(u);
    const NEW = 'Changed!Passw0rd';
    const changed = await api('/users/me/password', {
      method: 'POST',
      token: a.body.accessToken,
      json: { currentPassword: u.password, newPassword: NEW },
    });
    expect(changed.status).toBe(200);
    for (const [name, s] of [['바꾼 기기', a], ['다른 기기', b]] as const) {
      expect((await refresh(s.body.refreshToken)).status, name).toBe(401);
    }
    const again = await api('/auth/login', { method: 'POST', json: { email: u.email, password: NEW, tenantSlug: u.slug } });
    expect(again.status).toBe(200);
  });

  it('자동 로그인이면 30일, 아니면 12시간 — 갱신해도 그대로 이어진다', async () => {
    const DAY = 86_400;
    const kept = await loginAs(t, true);
    expect(kept.body.remember).toBe(true);
    let c = claims(kept.body.refreshToken);
    expect(c.exp - c.iat).toBe(30 * DAY);

    const r = await refresh(kept.body.refreshToken);
    expect(r.body.remember).toBe(true);
    c = claims(r.body.refreshToken);
    expect(c.exp - c.iat).toBe(30 * DAY);

    for (const remember of [false, undefined]) {
      const s = await loginAs(t, remember);
      expect(s.body.remember, String(remember)).toBe(false);
      const sc = claims(s.body.refreshToken);
      expect(sc.exp - sc.iat, String(remember)).toBe(12 * 3600);
    }
  });
});
