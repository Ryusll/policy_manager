import { describe, it, expect, beforeAll } from 'vitest';
import { execSync } from 'child_process';
import { api, BASE, createTenant, waitForApi } from './helpers';

/**
 * 계정 체계 — 아스트룸이 고객사를 개설하고, 고객사 마스터가 직원 계정을 발급한다 (T-122).
 *
 * 막고 싶은 사고:
 * 1. 아무나 회사를 만든다 — 공개 회원가입(운영에서 닫힘, 아래 마지막 블록).
 * 2. 고객사 개설을 플랫폼 관리자 아닌 사람이 한다.
 * 3. **남이 정해 준 비밀번호를 그대로 계속 쓴다** — 정해 준 사람(아스트룸·마스터)이 그 비밀번호를
 *    알고 있다. 화면만 막으면 API 로 그대로 쓸 수 있으므로 서버가 막는지 본다.
 *
 * ⚠️ 여기서는 공용 `login()` 대신 `/auth/login` 을 직접 부른다 — `login()` 은 첫 로그인 변경을
 * 대신 처리해 "이미 온보딩한 직원"을 돌려주기 때문이다.
 */

function sql(query: string): string {
  return execSync(
    `docker compose exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -t -A -v ON_ERROR_STOP=1 -f -'`,
    { encoding: 'utf8', input: query },
  ).trim();
}

const rawLogin = (email: string, password: string, tenantSlug: string) =>
  api('/auth/login', { method: 'POST', json: { email, password, tenantSlug } });
const stamp = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const NEW_PW = 'MyOwnPassw0rd!';

// 아래 본 블록은 가입으로 회사를 만들어 준비한다 — 가입이 닫힌 서버(운영 설정)에서는 건너뛴다
describe.skipIf(process.env.EXPECT_SIGNUP_CLOSED === '1')('T-122 계정 체계 — 아스트룸 개설형', () => {
  let platform: Awaited<ReturnType<typeof createTenant>>;
  let customerAdmin: Awaited<ReturnType<typeof createTenant>>;

  beforeAll(async () => {
    await waitForApi();
    platform = await createTenant('acct-pf');
    customerAdmin = await createTenant('acct-ca');
    sql(`UPDATE users SET platform_role='global_admin' WHERE id='${platform.user.id}';`);
  }, 90_000);

  const provision = (token: string | undefined, json: Record<string, unknown>) =>
    api('/platform-admin/tenants', { method: 'POST', token, json });

  describe('고객사 개설 — 플랫폼 관리자만', () => {
    it('토큰이 없으면 401, 고객사 관리자(admin)라도 403', async () => {
      const body = { name: '아무개', slug: `it-acct-x-${stamp()}`, masterEmail: 'x@example.test', masterName: 'x' };
      expect((await provision(undefined, body)).status).toBe(401);
      expect((await provision(customerAdmin.token, body)).status).toBe(403);
    });

    it('조직 코드 형식이 틀리면 400, 이미 있는 코드면 409', async () => {
      const base = { name: '회사', masterEmail: `m-${stamp()}@example.test`, masterName: '마스터' };
      for (const slug of ['A', '-abc', 'has space', 'x'.repeat(41)]) {
        expect((await provision(platform.token, { ...base, slug })).status, slug).toBe(400);
      }
      expect((await provision(platform.token, { ...base, slug: customerAdmin.slug })).status).toBe(409);
      expect((await provision(platform.token, { ...base, slug: `it-acct-${stamp()}`, masterEmail: 'not-email' })).status).toBe(400);
      // 비밀번호는 받지 않는다 — 서버가 만든다
      const withPw = await provision(platform.token, { ...base, slug: `it-acct-${stamp()}`, password: 'chosen' });
      expect(withPw.status).toBe(400);
    });
  });

  describe('개설 → 마스터 첫 로그인 → 직원 발급 → 직원 첫 로그인', () => {
    let slug = '';
    let masterEmail = '';
    let temp = '';
    let masterToken = '';

    it('개설하면 임시 비밀번호를 한 번 돌려주고, 기본 플랜은 Starter 다', async () => {
      slug = `it-acct-${stamp()}`;
      masterEmail = `Master-${stamp()}@Example.Test`;
      const res = await provision(platform.token, { name: '고객사 가', slug: slug.toUpperCase(), masterEmail, masterName: '김마스터' });
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      expect(res.body.tenant).toMatchObject({ slug, name: '고객사 가', plan: 'starter' });
      expect(res.body.master).toMatchObject({ email: masterEmail.toLowerCase(), name: '김마스터' });
      temp = res.body.temporaryPassword;
      expect(temp).toMatch(/^[A-Za-z2-9]{14}$/);
      masterEmail = masterEmail.toLowerCase();
    });

    it('마스터는 임시 비밀번호로 들어오지만, 바꾸기 전에는 내 정보·비밀번호 변경 말고는 못 한다', async () => {
      const r = await rawLogin(masterEmail, temp, slug);
      expect(r.status).toBe(200);
      expect(r.body.user).toMatchObject({ role: 'admin', mustChangePassword: true, tenantSlug: slug });
      masterToken = r.body.accessToken;

      for (const path of ['/policies', '/users', '/audit-logs']) {
        const blocked = await api(path, { token: masterToken });
        expect(blocked.status, path).toBe(403);
        expect(blocked.body.code, path).toBe('PASSWORD_CHANGE_REQUIRED');
      }
      const invite = await api('/users', {
        method: 'POST', token: masterToken,
        json: { email: `e-${stamp()}@example.test`, password: 'Employee!234', name: '직원', role: 'editor' },
      });
      expect(invite.status).toBe(403);

      const me = await api('/auth/me', { method: 'POST', token: masterToken });
      expect(me.status).toBe(200);
      expect(me.body.mustChangePassword).toBe(true);
    });

    it('비밀번호를 바꾸면 바로 풀리고, 다음 로그인부터 변경 요구가 없다', async () => {
      const changed = await api('/users/me/password', {
        method: 'POST', token: masterToken, json: { currentPassword: temp, newPassword: NEW_PW },
      });
      expect(changed.status, JSON.stringify(changed.body)).toBe(200);
      expect((await api('/policies', { token: masterToken })).status).toBe(200);

      expect((await rawLogin(masterEmail, temp, slug)).status).toBe(401);
      const again = await rawLogin(masterEmail, NEW_PW, slug);
      expect(again.body.user.mustChangePassword).toBe(false);
      masterToken = again.body.accessToken;
    });

    it('Starter 고객사의 마스터도 직원 계정을 발급하고, 직원도 첫 로그인 때 바꿔야 한다', async () => {
      const employeeEmail = `emp-${stamp()}@example.test`;
      const invite = await api('/users', {
        method: 'POST', token: masterToken,
        json: { email: employeeEmail, password: 'Employee!234', name: '직원', role: 'editor' },
      });
      expect(invite.status, JSON.stringify(invite.body)).toBe(201);

      const listed = (await api('/users', { token: masterToken })).body.find((u: any) => u.email === employeeEmail);
      expect(listed.mustChangePassword).toBe(true); // 마스터가 "아직 첫 로그인 전"을 볼 수 있다

      const r = await rawLogin(employeeEmail, 'Employee!234', slug);
      expect(r.body.user.mustChangePassword).toBe(true);
      expect((await api('/policies', { token: r.body.accessToken })).status).toBe(403);
      await api('/users/me/password', {
        method: 'POST', token: r.body.accessToken, json: { currentPassword: 'Employee!234', newPassword: NEW_PW },
      });
      expect((await api('/policies', { token: r.body.accessToken })).status).toBe(200);

      // 마스터가 재설정하면 다시 첫 로그인 상태가 된다
      const reset = await api(`/users/${invite.body.id}/password`, {
        method: 'POST', token: masterToken, json: { newPassword: 'TempAgain!234' },
      });
      expect(reset.status).toBe(200);
      const afterReset = await rawLogin(employeeEmail, 'TempAgain!234', slug);
      expect(afterReset.body.user.mustChangePassword).toBe(true);
    });

    it('개설은 감사 로그에 남고, 임시 비밀번호는 기록되지 않는다', async () => {
      const { body } = await api('/audit-logs?action=platform_admin.tenant.create', { token: masterToken });
      expect(body.rows).toHaveLength(1);
      const detail = await api(`/audit-logs/${body.rows[0].id}`, { token: masterToken });
      expect(detail.body.details).toMatchObject({ slug, plan: 'starter', masterEmail });
      expect(JSON.stringify(detail.body)).not.toContain(temp);
    });
  });

  it('플랜을 정해 개설할 수 있다', async () => {
    const res = await provision(platform.token, {
      name: '프로 고객사', slug: `it-acct-pro-${stamp()}`, plan: 'pro',
      masterEmail: `pro-${stamp()}@example.test`, masterName: '마스터',
    });
    expect(res.status).toBe(201);
    expect(res.body.tenant.plan).toBe('pro');
  });

  it('스스로 가입한 관리자는 비밀번호를 직접 골랐으므로 변경 요구가 없다', () => {
    expect(customerAdmin.user.mustChangePassword).toBe(false);
  });

  it('로그인 화면 설정은 로그인 없이 읽는다', async () => {
    const res = await api('/auth/options');
    expect(res.status).toBe(200);
    expect(typeof res.body.publicSignup).toBe('boolean');
  });
});

/**
 * 개발·CI 의 docker API 는 가입이 열려 있다(테스트가 가입으로 회사를 만든다). 닫힌 상태는
 * `ALLOW_PUBLIC_SIGNUP` 없이 띄운 API 에 `EXPECT_SIGNUP_CLOSED=1` 로 돌려 확인한다 — 운영과 같은 설정이다.
 */
describe.runIf(process.env.EXPECT_SIGNUP_CLOSED === '1')('공개 회원가입이 닫힌 서버 (운영 설정)', () => {
  it('가입하면 403 SIGNUP_CLOSED, 로그인 화면 설정도 닫힘', async () => {
    const res = await api('/auth/register', {
      method: 'POST',
      json: { tenantName: '무단', tenantSlug: `it-closed-${stamp()}`, email: `c-${stamp()}@example.test`, password: 'Whatever!234', name: '무단' },
    });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('SIGNUP_CLOSED');
    expect((await api('/auth/options')).body).toEqual({ publicSignup: false });
  });

  it('구글로 새 회사를 만들려 해도 구글에 가기 전에 돌려보낸다', async ({ skip }) => {
    const res = await fetch(`${BASE}/auth/google?mode=register&tenantSlug=x1&tenantName=y`, { redirect: 'manual' });
    if (res.status === 503) return skip(); // 구글 로그인을 설정하지 않은 서버
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toContain('reason=signup_closed');
  });
});
