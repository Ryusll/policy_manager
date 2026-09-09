import { describe, it, expect, beforeAll } from 'vitest';
import { api, createTenant, login, waitForApi } from './helpers';

describe('인증 플로우', () => {
  let tenant: Awaited<ReturnType<typeof createTenant>>;

  beforeAll(async () => {
    await waitForApi();
    tenant = await createTenant('auth');
  });

  it('가입 즉시 접근 토큰을 준다', () => {
    expect(tenant.token).toBeTruthy();
  });

  it('올바른 자격으로 로그인된다', async () => {
    const { status, body } = await login(tenant.email, tenant.password, tenant.slug);
    expect(status).toBe(200);
    expect(body.accessToken).toBeTruthy();
  });

  it('비밀번호가 틀리면 401', async () => {
    const { status } = await login(tenant.email, '틀린비밀번호', tenant.slug);
    expect(status).toBe(401);
  });

  it('다른 테넌트로는 로그인되지 않는다', async () => {
    // 같은 이메일이라도 테넌트가 다르면 남의 회사에 들어가면 안 된다.
    const other = await createTenant('auth2');
    const { status } = await login(tenant.email, tenant.password, other.slug);
    expect(status).toBe(401);
  });

  it('토큰 없이 규정 목록을 못 본다', async () => {
    const { status } = await api('/policies');
    expect(status).toBe(401);
  });

  it('위조된 토큰을 거부한다', async () => {
    const { status } = await api('/policies', { token: 'not.a.real.token' });
    expect(status).toBe(401);
  });

  it('/auth/me 가 내 정보를 준다', async () => {
    const { status, body } = await api('/auth/me', { method: 'POST', token: tenant.token });
    expect(status).toBe(200);
    expect(body.email).toBe(tenant.email);
  });

  /**
   * 로그인은 이메일을 소문자로 낮춰 찾는데, 가입·사용자 생성은 그대로 저장했다.
   * 그래서 `Alice@Co.com` 으로 가입한 사람은 **어떤 표기로도 다시 로그인할 수
   * 없었다** — 가입은 성공하고 토큰까지 받은 뒤, 그 세션이 끝나면 잠긴다(T-42).
   */
  describe('이메일 대소문자', () => {
    const stamp = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

    it('대문자로 가입해도 다시 로그인할 수 있다', async () => {
      const slug = `it-case-${stamp()}`;
      const mixed = `Alice.${stamp()}@Co.Test`;
      const reg = await api('/auth/register', {
        method: 'POST',
        json: {
          tenantName: '대소문자',
          tenantSlug: slug,
          email: mixed,
          password: 'IntegrationTest!234',
          name: '앨리스',
        },
      });
      expect(reg.status).toBe(201);
      // 저장은 소문자로 눕혀서 한다
      expect(reg.body.user.email).toBe(mixed.toLowerCase());

      for (const attempt of [mixed, mixed.toLowerCase(), `  ${mixed.toUpperCase()}  `]) {
        const { status } = await login(attempt, 'IntegrationTest!234', slug);
        expect(status, `${attempt} 로 로그인`).toBe(200);
      }
    });

    it('관리자가 대문자로 만든 팀원도 로그인할 수 있다', async () => {
      const admin = await createTenant('case2');
      const mixed = `Bob.${stamp()}@Co.Test`;
      const created = await api('/users', {
        method: 'POST',
        token: admin.token,
        json: { email: mixed, password: 'IntegrationTest!234', name: '밥', role: 'viewer' },
      });
      expect(created.status).toBe(201);
      expect(created.body.email).toBe(mixed.toLowerCase());

      const { status } = await login(mixed.toLowerCase(), 'IntegrationTest!234', admin.slug);
      expect(status).toBe(200);
    });
  });
});
