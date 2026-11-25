import { describe, it, expect, beforeAll } from 'vitest';
import { api, createTenant, login, waitForApi } from './helpers';

/**
 * 사용자 정보 수정 — `PATCH /users/me`(본인 이름) · `PATCH /users/:id`(관리자).
 *
 * 막고 싶은 사고는 셋이다.
 * 1. 일반 사용자가 `/users/me` 로 자기 역할을 올리는 것(권한 상승)
 * 2. 다른 조직 사용자를 건드리는 것(테넌트 격리)
 * 3. 조직에 관리자가 한 명도 없는 상태가 되는 것(동시 강등 포함)
 */

type Tenant = Awaited<ReturnType<typeof createTenant>>;
type Role = 'admin' | 'editor' | 'viewer';
const PASSWORD = 'IntegrationTest!234';

async function addUser(t: Tenant, role: Role, tag: string) {
  const email = `${tag}-${t.slug}@example.test`;
  const created = await api('/users', {
    method: 'POST',
    token: t.token,
    json: { email, password: PASSWORD, name: tag, role },
  });
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  const l = await login(email, PASSWORD, t.slug);
  expect(l.status, JSON.stringify(l.body)).toBe(200);
  return { id: created.body.id as string, email, token: l.body.accessToken as string };
}

const patch = (path: string, token: string | undefined, json: unknown) =>
  api(path, { method: 'PATCH', token, json });

async function listUsers(token: string) {
  const { status, body } = await api('/users', { token });
  expect(status).toBe(200);
  return body as { id: string; email: string; name: string; role: string }[];
}

describe('내 정보 수정 — PATCH /users/me', () => {
  let t: Tenant;
  let editor: Awaited<ReturnType<typeof addUser>>;
  let viewer: Awaited<ReturnType<typeof addUser>>;

  beforeAll(async () => {
    await waitForApi();
    t = await createTenant('me');
    editor = await addUser(t, 'editor', 'editor');
    viewer = await addUser(t, 'viewer', 'viewer');
  });

  it('관리자·편집자·열람자 모두 자기 이름을 바꿀 수 있다', async () => {
    // viewer 가 200 을 받는다는 것은 `me` 가 `:id`(관리자 전용)로 잡히지 않는다는 뜻이기도 하다
    for (const [who, token] of [
      ['admin', t.token],
      ['editor', editor.token],
      ['viewer', viewer.token],
    ] as const) {
      const { status, body } = await patch('/users/me', token, { name: `새이름-${who}` });
      expect(status, `${who}: ${JSON.stringify(body)}`).toBe(200);
      expect(body.name).toBe(`새이름-${who}`);
    }
  });

  it('바꾼 이름이 /auth/me 에 바로 보인다', async () => {
    await patch('/users/me', editor.token, { name: '반영 확인' });
    const me = await api('/auth/me', { method: 'POST', token: editor.token });
    expect(me.body.name).toBe('반영 확인');
  });

  it('앞뒤 공백은 지운다', async () => {
    const { body } = await patch('/users/me', viewer.token, { name: '   공백 이름   ' });
    expect(body.name).toBe('공백 이름');
  });

  it('빈 이름·공백뿐인 이름·100자 초과는 400', async () => {
    for (const name of ['', '   ', 'a'.repeat(101)]) {
      const { status } = await patch('/users/me', editor.token, { name });
      expect(status, `name=${JSON.stringify(name).slice(0, 20)}`).toBe(400);
    }
    const { status } = await patch('/users/me', editor.token, {});
    expect(status).toBe(400);
  });

  it('이름 말고는 받지 않는다 — 열람자가 role 을 보내 관리자가 될 수 없다', async () => {
    const attempt = await patch('/users/me', viewer.token, { name: '권한상승', role: 'admin' });
    expect(attempt.status).toBe(400);

    // 이름까지 안 바뀌었고(요청 전체가 거부), 역할도 그대로이며, 관리자 전용 API 도 여전히 막힌다
    const row = (await listUsers(t.token)).find((u) => u.id === viewer.id)!;
    expect(row.role).toBe('viewer');
    expect(row.name).not.toBe('권한상승');
    expect((await api('/audit-logs?limit=1', { token: viewer.token })).status).toBe(403);
  });

  it('이메일도 여기서는 바꿀 수 없다', async () => {
    const { status } = await patch('/users/me', editor.token, { email: 'x@example.test' });
    expect(status).toBe(400);
  });

  it('토큰이 없으면 401', async () => {
    const { status } = await patch('/users/me', undefined, { name: '아무개' });
    expect(status).toBe(401);
  });
});

describe('관리자의 사용자 수정 — PATCH /users/:id', () => {
  let t: Tenant;
  let other: Tenant;
  let editor: Awaited<ReturnType<typeof addUser>>;
  let viewer: Awaited<ReturnType<typeof addUser>>;

  beforeAll(async () => {
    await waitForApi();
    t = await createTenant('upd');
    other = await createTenant('upd-other');
    editor = await addUser(t, 'editor', 'editor');
    viewer = await addUser(t, 'viewer', 'viewer');
  });

  it('편집자·열람자는 403 — 자기 자신도 이 경로로는 못 바꾼다', async () => {
    for (const actor of [editor, viewer]) {
      const onOther = await patch(`/users/${viewer.id}`, actor.token, { name: '시도' });
      expect(onOther.status).toBe(403);
      const onSelf = await patch(`/users/${actor.id}`, actor.token, { name: '시도' });
      expect(onSelf.status).toBe(403);
    }
  });

  it('관리자가 이름·이메일·역할을 바꾸면 그 이메일로 로그인된다', async () => {
    const member = await addUser(t, 'viewer', 'member');
    const newEmail = `renamed-${t.slug}@example.test`;

    const { status, body } = await patch(`/users/${member.id}`, t.token, {
      name: '바뀐 이름',
      email: newEmail,
      role: 'editor',
    });
    expect(status, JSON.stringify(body)).toBe(200);
    expect(body).toMatchObject({ id: member.id, name: '바뀐 이름', email: newEmail, role: 'editor' });

    expect((await login(newEmail, PASSWORD, t.slug)).status).toBe(200);
    expect((await login(member.email, PASSWORD, t.slug)).status).toBe(401);
  });

  it('이메일은 소문자로 저장한다', async () => {
    const member = await addUser(t, 'viewer', 'casing');
    const mixed = `MiXeD-${t.slug}@Example.Test`;
    const { status, body } = await patch(`/users/${member.id}`, t.token, { email: mixed });
    expect(status).toBe(200);
    expect(body.email).toBe(mixed.toLowerCase());
    expect((await login(mixed, PASSWORD, t.slug)).status).toBe(200);
  });

  it('같은 조직에 있는 이메일은 409 — 대소문자만 달라도 같다', async () => {
    const member = await addUser(t, 'viewer', 'dup');
    const same = await patch(`/users/${member.id}`, t.token, { email: editor.email });
    expect(same.status).toBe(409);
    const caseOnly = await patch(`/users/${member.id}`, t.token, { email: editor.email.toUpperCase() });
    expect(caseOnly.status).toBe(409);
    // 실패한 요청은 아무것도 바꾸지 않는다
    const row = (await listUsers(t.token)).find((u) => u.id === member.id)!;
    expect(row.email).toBe(member.email);
  });

  it('다른 조직에 있는 이메일은 쓸 수 있다 — 이메일은 조직 안에서만 고유하다', async () => {
    const member = await addUser(t, 'viewer', 'cross');
    const { status } = await patch(`/users/${member.id}`, t.token, { email: other.email });
    expect(status).toBe(200);
  });

  it('잘못된 값·빈 요청·허용되지 않은 항목은 400', async () => {
    const member = await addUser(t, 'viewer', 'bad');
    const cases: unknown[] = [
      { email: 'not-an-email' },
      { role: 'superuser' },
      { name: '' },
      { name: null },
      {},
      // 비밀번호·플랫폼 역할은 이 경로로 못 바꾼다
      { password: 'NewPassw0rd!' },
      { platformRole: 'global_admin' },
    ];
    for (const json of cases) {
      const { status } = await patch(`/users/${member.id}`, t.token, json);
      expect(status, JSON.stringify(json)).toBe(400);
    }
    const me = await api('/auth/me', { method: 'POST', token: member.token });
    expect(me.body.platformRole).toBe('none');
    expect((await login(member.email, PASSWORD, t.slug)).status).toBe(200);
  });

  it('없는 사용자는 404', async () => {
    const { status } = await patch('/users/00000000-0000-0000-0000-000000000000', t.token, { name: '없음' });
    expect(status).toBe(404);
  });

  it('다른 조직 사용자는 "없음"과 똑같이 404 이고 바뀌지 않는다', async () => {
    const { status } = await patch(`/users/${other.user.id}`, t.token, { name: '침입', role: 'viewer' });
    expect(status).toBe(404);
    const me = await api('/auth/me', { method: 'POST', token: other.token });
    expect(me.body.name).not.toBe('침입');
    expect(me.body.role).toBe('admin');
  });

  it('역할 변경은 다음 요청부터 바로 효과가 난다 — 로그인을 다시 하지 않아도', async () => {
    const member = await addUser(t, 'viewer', 'promote');
    const adminOnly = () => api('/audit-logs?limit=1', { token: member.token });

    expect((await adminOnly()).status).toBe(403);
    expect((await patch(`/users/${member.id}`, t.token, { role: 'admin' })).status).toBe(200);
    expect((await adminOnly()).status).toBe(200);
    expect((await patch(`/users/${member.id}`, t.token, { role: 'editor' })).status).toBe(200);
    expect((await adminOnly()).status).toBe(403);
  });
});

describe('마지막 관리자 보호', () => {
  let ready = false;
  beforeAll(async () => {
    await waitForApi();
    ready = true;
  });

  it('유일한 관리자는 자신을 강등할 수 없다', async () => {
    expect(ready).toBe(true);
    const t = await createTenant('last');
    const { status } = await patch(`/users/${t.user.id}`, t.token, { role: 'editor' });
    expect(status).toBe(409);
    // 여전히 관리자다
    expect((await api('/audit-logs?limit=1', { token: t.token })).status).toBe(200);
  });

  it('유일한 관리자도 이름·이메일은 바꿀 수 있다', async () => {
    const t = await createTenant('last-name');
    const { status, body } = await patch(`/users/${t.user.id}`, t.token, {
      name: '대표',
      role: 'admin', // 같은 역할을 다시 보내는 것은 변경이 아니다
    });
    expect(status, JSON.stringify(body)).toBe(200);
    expect(body.name).toBe('대표');
  });

  it('다른 관리자를 지정하면 강등할 수 있고, 남은 한 명은 다시 보호된다', async () => {
    const t = await createTenant('last-handover');
    const successor = await addUser(t, 'editor', 'successor');

    expect((await patch(`/users/${successor.id}`, t.token, { role: 'admin' })).status).toBe(200);
    expect((await patch(`/users/${t.user.id}`, t.token, { role: 'editor' })).status).toBe(200);

    // 이제 successor 가 유일한 관리자다
    const blocked = await patch(`/users/${successor.id}`, successor.token, { role: 'viewer' });
    expect(blocked.status).toBe(409);
    const admins = (await listUsers(successor.token)).filter((u) => u.role === 'admin');
    expect(admins).toHaveLength(1);
  });

  /**
   * 두 관리자가 동시에 서로를 강등하면, 잠금이 없을 때 둘 다 "관리자가 아직 2명"으로 보고
   * 통과해 0명이 된다. 하나만 성공해야 한다. 요청이 겹치는 것은 확률이라 여러 번 시도한다.
   */
  it('두 관리자가 동시에 서로를 강등해도 관리자는 한 명 남는다', async () => {
    for (let round = 0; round < 8; round += 1) {
      const t = await createTenant(`race${round}`);
      const b = await addUser(t, 'admin', 'racer');

      const [aDemotesB, bDemotesA] = await Promise.all([
        patch(`/users/${b.id}`, t.token, { role: 'editor' }),
        patch(`/users/${t.user.id}`, b.token, { role: 'editor' }),
      ]);

      const statuses = [aDemotesB.status, bDemotesA.status];
      expect(statuses.filter((s) => s === 200), `round ${round}: ${statuses.join(',')}`).toHaveLength(1);

      const survivor = aDemotesB.status === 200 ? t.token : b.token;
      const admins = (await listUsers(survivor)).filter((u) => u.role === 'admin');
      expect(admins, `round ${round}`).toHaveLength(1);
    }
  }, 120_000);
});

describe('감사 로그', () => {
  let t: Tenant;
  let member: Awaited<ReturnType<typeof addUser>>;

  async function rowsOf(action: string, entityId: string) {
    const { body } = await api(`/audit-logs?action=${action}&limit=100`, { token: t.token });
    return (body.rows as any[]).filter((r) => r.entityId === entityId);
  }

  beforeAll(async () => {
    await waitForApi();
    t = await createTenant('audit-upd');
    member = await addUser(t, 'viewer', 'audited');
  });

  it('이름·이메일 변경은 user.updated 로, 전후 값과 함께 남는다', async () => {
    const newEmail = `audited-new-${t.slug}@example.test`;
    await patch(`/users/${member.id}`, t.token, { name: '기록 확인', email: newEmail });

    const rows = await rowsOf('user.updated', member.id);
    expect(rows).toHaveLength(1);
    const detail = await api(`/audit-logs/${rows[0].id}`, { token: t.token });
    expect(detail.body.details.self).toBe(false);
    expect(detail.body.details.changes.name).toEqual({ before: 'audited', after: '기록 확인' });
    expect(detail.body.details.changes.email).toEqual({ before: member.email, after: newEmail });
  });

  it('역할 변경은 user.role_changed 로 따로 남는다 — "누가 관리자가 됐나"를 거를 수 있게', async () => {
    await patch(`/users/${member.id}`, t.token, { role: 'editor' });

    const rows = await rowsOf('user.role_changed', member.id);
    expect(rows).toHaveLength(1);
    const detail = await api(`/audit-logs/${rows[0].id}`, { token: t.token });
    expect(detail.body.details).toMatchObject({ beforeRole: 'viewer', afterRole: 'editor', self: false });
  });

  it('본인 이름 변경은 self: true 로 남는다', async () => {
    await patch('/users/me', member.token, { name: '내가 바꿈' });
    const rows = await rowsOf('user.updated', member.id);
    // 목록 행은 행위자를 `user: { id, … }` 로 준다
    const mine = rows.find((r) => r.user?.id === member.id);
    expect(mine).toBeTruthy();
    const detail = await api(`/audit-logs/${mine.id}`, { token: t.token });
    expect(detail.body.details.self).toBe(true);
  });

  it('값이 그대로면 기록하지 않는다', async () => {
    const before = (await rowsOf('user.updated', member.id)).length;
    const same = await patch(`/users/${member.id}`, t.token, { name: '내가 바꿈' });
    expect(same.status).toBe(200);
    expect((await rowsOf('user.updated', member.id)).length).toBe(before);
  });

  it('거부된 요청(마지막 관리자 강등)은 기록하지 않는다', async () => {
    const solo = await createTenant('audit-solo');
    await patch(`/users/${solo.user.id}`, solo.token, { role: 'viewer' });
    const { body } = await api('/audit-logs?action=user.role_changed', { token: solo.token });
    expect(body.rows).toHaveLength(0);
  });
});
