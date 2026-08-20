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
});
