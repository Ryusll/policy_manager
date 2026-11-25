import { describe, it, expect, beforeAll } from 'vitest';
import { api, createTenant, login, waitForApi } from './helpers';
import { brief, sql } from './race';

/**
 * 규정 자리(T-198) — 대표가 "규정 등록이 아예 안 된다"고 한 것의 재현: Starter(5건) 회사에 5건이 차면 모든 생성 경로가 403 인데
 * 화면은 끝에서야 알았다. 자리 조회로 미리 알리고, 막히면 세 경로가 같은 코드·문구로 답하는지 본다.
 */
const TYPE = 'application/vnd.policy-import+json';

async function starter(tag: string) {
  const t = await createTenant(tag);
  sql(`UPDATE tenants SET plan='starter' WHERE slug='${t.slug}';`);
  return { ...t, id: sql(`SELECT id FROM tenants WHERE slug='${t.slug}';`) };
}
const create = (token: string, code: string) => api('/policies', { method: 'POST', token, json: { code, title: `규정 ${code}` } });
const slots = (token: string) => api('/policies/slots', { token });

/** 미리보기가 준비된 법제처 세션을 바로 심는다 — 원문 PDF 가 없어 업로드·추출 없이 확정까지 갈 수 있다 */
function readySession(tenantId: string) {
  const tree = JSON.stringify({
    roots: [{ id: 'n1', articleNumber: 'L1', articleTitle: '목적', content: '이 규정은 자리 시험을 목적으로 한다.', children: [] }],
  });
  return sql(`WITH ins AS (
    INSERT INTO regulation_parse_sessions (id, tenant_id, file_name, status, extract_meta, parse_tree, updated_at)
    VALUES (gen_random_uuid(), '${tenantId}', '자리 시험', 'ready', '{"source":"lawgokr"}', '${tree}', now()) RETURNING id)
    SELECT id FROM ins;`);
}

function expectLimit(res: { status: number; body: any }, used: number) {
  expect(res.status, brief(res)).toBe(403);
  expect(res.body.code).toBe('POLICY_LIMIT_REACHED');
  expect(res.body).toMatchObject({ plan: 'starter', max: 5, used });
  // 예전 시험(T-135)이 보는 문장과 요금제 이름·문의 안내
  expect(String(res.body.message)).toContain('최대 5건');
  expect(String(res.body.message)).toContain('(스타터)');
  expect(String(res.body.message)).toContain('아스트룸에 문의');
  expect(String(res.body.message)).not.toContain('(starter)');
}

describe('규정 자리 조회와 상한 응답 (T-198)', () => {
  let s: Awaited<ReturnType<typeof starter>>;

  beforeAll(async () => {
    await waitForApi();
    s = await starter('slots');
  }, 60_000);

  it('자리 조회는 요금제·등록 수·상한·남은 자리를 준다 — 비활성 규정도 센다(저장 때 검사와 같다)', async () => {
    expect((await slots(s.token)).body).toEqual({ plan: 'starter', used: 0, max: 5, remaining: 5 });
    const ids: string[] = [];
    for (const code of ['S1', 'S2', 'S3', 'S4']) {
      const c = await create(s.token, code);
      expect(c.status, brief(c)).toBe(201);
      ids.push(c.body.id);
    }
    const off = await api(`/policies/${ids[0]}`, { method: 'PUT', token: s.token, json: { isActive: false } });
    expect(off.status, brief(off)).toBe(200);
    const r = await slots(s.token);
    expect(r.status, brief(r)).toBe(200);
    expect(r.body).toEqual({ plan: 'starter', used: 4, max: 5, remaining: 1 });
  });

  it('다른 회사의 규정은 세지 않는다', async () => {
    const other = await starter('slots-other');
    expect((await slots(other.token)).body).toMatchObject({ used: 0, max: 5 });
  });

  it('열람자는 자리 조회도 못 한다(새 규정을 만들 수 없는 역할)', async () => {
    const email = `viewer-${s.slug}@example.test`;
    const made = await api('/users', { method: 'POST', token: s.token, json: { email, name: '열람자', password: 'ViewerTest!234', role: 'viewer' } });
    expect(made.status, brief(made)).toBe(201);
    const v = await login(email, 'ViewerTest!234', s.slug);
    expect((await slots(v.body.accessToken)).status).toBe(403);
  });

  it('5건이 차면 자리 조회가 남은 자리 0 — 새 규정·텍스트 가져오기·PDF/법제처 확정이 같은 코드·문구로 403', async () => {
    expect((await create(s.token, 'S5')).status).toBe(201);
    expect((await slots(s.token)).body).toEqual({ plan: 'starter', used: 5, max: 5, remaining: 0 });

    expectLimit(await create(s.token, 'S6'), 5);

    const doc = {
      code: 'T6',
      title: '텍스트 규정',
      effectiveDate: '2024-01-01',
      chapters: [{ number: 1, title: '', suppressHeader: true, articles: [{ number: 1, title: '목적', content: '본문' }] }],
      log: { sourceName: 'manual-import', parseProfile: 'korean', articleCount: 1, cleanupOptions: {} },
    };
    expectLimit(await api('/policies/import', { method: 'POST', token: s.token, headers: { 'Content-Type': TYPE }, body: JSON.stringify(doc) }), 5);

    const sid = readySession(s.id);
    const commit = await api(`/regulation-parse/${sid}/commit`, {
      method: 'POST',
      token: s.token,
      json: { code: 'L6', title: '법제처 규정', effectiveDate: '2024-01-01' },
    });
    expectLimit(commit, 5);
    // 막힌 확정은 원문을 쓰지 않는다 — 요금제를 올린 뒤 같은 미리보기로 다시 확정할 수 있다
    expect(sql(`SELECT status || ',' || coalesce(committed_policy_id, '-') FROM regulation_parse_sessions WHERE id='${sid}';`)).toBe('ready,-');
    expect(sql(`SELECT count(*) FROM policies WHERE tenant_id='${s.id}';`)).toBe('5');
  });

  it('일괄 등록도 상한이면 같은 코드·값 — 사전 검사(200)와 저장(400, issues 는 그대로)', async () => {
    const policies = [{ code: 'B1', title: '일괄', articles: [{ number: 1, title: '목적', content: '본문' }] }];
    const check = await api('/admin/import/policies/validate', { method: 'POST', token: s.token, json: { policies } });
    expect(check.status, brief(check)).toBe(200);
    expect(check.body.canImport).toBe(false);
    expect(check.body.limit).toEqual({ code: 'POLICY_LIMIT_REACHED', plan: 'starter', max: 5, used: 5 });
    const limitIssue = (check.body.issues as { message: string }[]).find((i) => i.message.includes('상한'))!;
    expect(limitIssue.message).toContain('아스트룸에 문의');

    const saved = await api('/admin/import/policies', { method: 'POST', token: s.token, json: { policies } });
    expect(saved.status, brief(saved)).toBe(400);
    expect(saved.body).toMatchObject({ code: 'POLICY_LIMIT_REACHED', plan: 'starter', max: 5, used: 5 });
    expect(Array.isArray(saved.body.issues)).toBe(true);
    expect(String(saved.body.message)).toContain('상한');

    // 코드 중복과 상한이 함께 걸려도 상한 코드를 실으면 문구도 상한의 것이다(코드와 문구가 다른 실패를 가리키지 않게)
    const both = await api('/admin/import/policies', {
      method: 'POST',
      token: s.token,
      json: { policies: [{ code: 'S1', title: '겹치는 코드', articles: [{ number: 1, title: '목적', content: '본문' }] }] },
    });
    expect(both.status, brief(both)).toBe(400);
    expect(both.body.code).toBe('POLICY_LIMIT_REACHED');
    expect(String(both.body.message)).toContain('상한');
    expect(JSON.stringify(both.body.issues)).toContain('S1');
    expect(sql(`SELECT count(*) FROM policies WHERE tenant_id='${s.id}';`)).toBe('5');
  });

  it('하나를 지우면 자리가 나서 다시 만들 수 있다', async () => {
    const list = await api('/policies', { token: s.token });
    const victim = (list.body as { id: string; code: string }[]).find((p) => p.code === 'S5')!;
    expect((await api(`/policies/${victim.id}`, { method: 'DELETE', token: s.token })).status).toBe(204);
    expect((await slots(s.token)).body).toMatchObject({ used: 4, remaining: 1 });
    expect((await create(s.token, 'S7')).status).toBe(201);
  });

  it('요금제를 올리면 자리 조회도 바로 따라온다(로그인 토큰의 요금제가 아니라 회사 행을 읽는다)', async () => {
    sql(`UPDATE tenants SET plan='pro' WHERE id='${s.id}';`);
    expect((await slots(s.token)).body).toMatchObject({ plan: 'pro', used: 5, max: 10_000 });
    expect((await create(s.token, 'S8')).status).toBe(201);
  });
});
