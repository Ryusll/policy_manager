import { describe, it, expect, beforeAll } from 'vitest';
import { api, createTenant, login, waitForApi } from './helpers';

/**
 * 비밀번호 변경(`POST /users/me/password`)·관리자 재설정(`POST /users/:id/password`).
 *
 * 막고 싶은 사고: ① 토큰만 훔친 사람이 현재 비밀번호 없이 계정을 가로챔(본인 재설정 금지의 이유)
 * ② 다른 조직 사용자의 비밀번호를 바꿈 ③ 바꾼 뒤에도 옛 세션(refresh)이 살아 있음.
 */

type Tenant = Awaited<ReturnType<typeof createTenant>>;
const PW = 'IntegrationTest!234';
const NEW = 'BrandNewPass!567';

async function addUser(t: Tenant, role: 'admin' | 'editor' | 'viewer', tag: string) {
  const email = `${tag}-${t.slug}@example.test`;
  const created = await api('/users', {
    method: 'POST', token: t.token, json: { email, password: PW, name: tag, role },
  });
  expect(created.status).toBe(201);
  const l = await login(email, PW, t.slug);
  return {
    id: created.body.id as string,
    email,
    token: l.body.accessToken as string,
    refreshToken: l.body.refreshToken as string,
  };
}
const post = (path: string, token: string | undefined, json: unknown) =>
  api(path, { method: 'POST', token, json });

describe('내 비밀번호 변경', () => {
  let t: Tenant;
  beforeAll(async () => {
    await waitForApi();
    t = await createTenant('pwchg');
  });

  it('현재 비밀번호가 틀리면 400 — 401 이 아니다(화면이 로그아웃되지 않게)', async () => {
    const { status, body } = await post('/users/me/password', t.token, {
      currentPassword: '틀린비밀번호', newPassword: NEW,
    });
    expect(status).toBe(400);
    expect(body.message).toContain('현재 비밀번호');
  });

  it('규칙에 어긋나는 새 비밀번호는 400', async () => {
    for (const newPassword of ['short1', PW, '가'.repeat(25)]) {
      const { status } = await post('/users/me/password', t.token, { currentPassword: PW, newPassword });
      expect(status, newPassword.slice(0, 8)).toBe(400);
    }
    // 실패한 요청은 아무것도 바꾸지 않는다
    expect((await login(t.email, PW, t.slug)).status).toBe(200);
  });

  it('필드 누락·허용되지 않은 필드는 400, 토큰이 없으면 401', async () => {
    expect((await post('/users/me/password', t.token, { newPassword: NEW })).status).toBe(400);
    expect((await post('/users/me/password', t.token, { currentPassword: PW, newPassword: NEW, role: 'admin' })).status).toBe(400);
    expect((await post('/users/me/password', undefined, { currentPassword: PW, newPassword: NEW })).status).toBe(401);
  });

  it('바꾸면 새 비밀번호로만 로그인되고, 옛 세션은 갱신되지 못한다', async () => {
    const u = await addUser(t, 'viewer', 'changer'); // 열람자도 자기 비밀번호는 바꾼다
    const { status } = await post('/users/me/password', u.token, { currentPassword: PW, newPassword: NEW });
    expect(status).toBe(200);

    // 로그인하면 refresh 토큰이 새로 발급되어 옛 토큰이 어차피 무효가 된다 — 그 전에 확인해야 의미가 있다
    const refreshed = await post('/auth/refresh', undefined, { refreshToken: u.refreshToken });
    expect(refreshed.status).toBe(401);
    expect((await login(u.email, PW, t.slug)).status).toBe(401);
    expect((await login(u.email, NEW, t.slug)).status).toBe(200);
  });

  it('감사 로그에 남고 비밀번호 자체는 기록되지 않는다', async () => {
    const u = await addUser(t, 'editor', 'audited');
    await post('/users/me/password', u.token, { currentPassword: PW, newPassword: NEW });
    const { body } = await api('/audit-logs?action=user.password_changed&limit=50', { token: t.token });
    const row = body.rows.find((r: any) => r.entityId === u.id);
    expect(row).toBeTruthy();
    const detail = await api(`/audit-logs/${row.id}`, { token: t.token });
    expect(JSON.stringify(detail.body)).not.toContain(NEW);
    expect(JSON.stringify(detail.body)).not.toContain(PW);
  });
});

describe('관리자의 비밀번호 재설정', () => {
  let t: Tenant;
  let other: Tenant;
  beforeAll(async () => {
    await waitForApi();
    t = await createTenant('pwreset');
    other = await createTenant('pwreset-other');
  });

  it('편집자·열람자는 403', async () => {
    const editor = await addUser(t, 'editor', 'ed');
    const victim = await addUser(t, 'viewer', 'vic');
    expect((await post(`/users/${victim.id}/password`, editor.token, { newPassword: NEW })).status).toBe(403);
    expect((await login(victim.email, PW, t.slug)).status).toBe(200);
  });

  it('관리자가 재설정하면 새 비밀번호로만 로그인되고 옛 세션은 끊긴다', async () => {
    const victim = await addUser(t, 'editor', 'locked');
    const { status } = await post(`/users/${victim.id}/password`, t.token, { newPassword: NEW });
    expect(status).toBe(200);
    // 로그인보다 먼저 — 로그인이 refresh 토큰을 교체하면 무효화를 검증할 수 없다
    expect((await post('/auth/refresh', undefined, { refreshToken: victim.refreshToken })).status).toBe(401);
    expect((await login(victim.email, PW, t.slug)).status).toBe(401);
    expect((await login(victim.email, NEW, t.slug)).status).toBe(200);
  });

  it('본인에게는 쓸 수 없다 — 현재 비밀번호 확인을 건너뛰는 경로가 되기 때문', async () => {
    const { status } = await post(`/users/${t.user.id}/password`, t.token, { newPassword: NEW });
    expect(status).toBe(400);
    expect((await login(t.email, PW, t.slug)).status).toBe(200);
  });

  it('규칙에 어긋나면 400, 없는 사용자·다른 조직 사용자는 404 이고 바뀌지 않는다', async () => {
    const victim = await addUser(t, 'viewer', 'rule');
    expect((await post(`/users/${victim.id}/password`, t.token, { newPassword: 'short' })).status).toBe(400);
    expect((await post('/users/00000000-0000-0000-0000-000000000000/password', t.token, { newPassword: NEW })).status).toBe(404);
    expect((await post(`/users/${other.user.id}/password`, t.token, { newPassword: NEW })).status).toBe(404);
    expect((await login(other.email, other.password, other.slug)).status).toBe(200);
  });

  it('감사 로그에 user.password_reset 으로 남는다', async () => {
    const victim = await addUser(t, 'viewer', 'logged');
    await post(`/users/${victim.id}/password`, t.token, { newPassword: NEW });
    const { body } = await api('/audit-logs?action=user.password_reset&limit=50', { token: t.token });
    expect(body.rows.some((r: any) => r.entityId === victim.id)).toBe(true);
  });
});
