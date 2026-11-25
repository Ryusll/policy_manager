import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { api, createTenant, waitForApi } from './helpers';
import { sql } from './race';
import { todayDateOnly, toDateOnlyString } from '../../apps/api/src/common/date-only';
// @ts-expect-error — 스크립트(.mjs)는 타입 선언이 없다
import { main } from '../../scripts/demo/seed-demo.mjs';

/*
 * T-216 영업 시연 데이터 채우기 — 실제 API 로 완료 정의 ⑦을 본다.
 * 빈 고객사는 운영과 같은 경로(통합 관리자 개설 → 첫 로그인 → 비밀번호 변경)로 만들고, 두 번 돌려 두 번째에 새로 만든 것이 0건,
 * 다른 고객사의 규정·법령 연결·개정 후보·알림은 그대로, 후보 하나를 승인한 뒤 다시 채우면(--reset) 처리 대기 수가 처음과 같다.
 * 법령·조항·변경은 SQL 로 심고(법제처 없이 — 새 법령 등록은 격리 스택에서만 본다) afterAll 에서 지운다. 시연 규정은 이 시험이 쓴 파일이다.
 */

const BASE = process.env.API_BASE_URL ?? 'http://localhost:3001/api';
const today = toDateOnlyString(todayDateOnly());
const plusDays = (n: number) => new Date(Date.parse(`${today}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const tag = Math.random().toString(36).slice(2, 8).replace(/\d/g, 'x');
const LAW1 = `시연채우기시험법${tag}`;
const LAW2 = `시연채우기둘째법${tag}`;
const ids = {
  source: randomUUID(),
  laws: [randomUUID(), randomUUID()] as const,
  arts: Object.fromEntries(['l1j3', 'l1c31', 'l1c32', 'l1j5', 'l1j9', 'l2j7', 'l2c71', 'l2i711'].map((k) => [k, randomUUID()])) as Record<string, string>,
  events: { in: randomUUID(), out: randomUUID(), item: randomUUID(), none: randomUUID() },
};
const ext = () => String(700000 + Math.floor(Math.random() * 99999));

const policies = [
  {
    code: 'DS-1',
    title: '시연 시험 규정',
    // 부서·분류는 서버가 metadata 에 둔다 — 다시 실행할 때 '이 스크립트가 넣은 규정' 판정이 실제 응답 꼴을 지나게 한다
    description: '시연 채우기 시험을 위한 규정이다.',
    department: '인사팀',
    category: '인사',
    effectiveDate: '2025-01-01',
    chapters: [
      {
        number: 1,
        title: '총칙',
        articles: [
          { number: 1, title: '목적', content: '이 규정은 시연 채우기 시험을 위한 규정이다.' },
          {
            number: 3,
            title: '휴가',
            clauses: [
              { text: '휴가는 연 15일로 한다.', cites: [{ law: LAW1, article: '제3조제1항' }] },
              { text: '휴가는 나누어 쓸 수 있다.', cites: [{ law: LAW1, article: '제3조제2항' }] },
            ],
          },
          { number: 5, title: '보고', content: '보고는 분기마다 한다.', cites: [{ law: LAW1, article: '제5조' }] },
        ],
      },
    ],
  },
  {
    code: 'DS-2',
    title: '시연 시험 둘째 규정',
    effectiveDate: '2025-01-01',
    chapters: [{ number: 1, title: '총칙', articles: [{ number: 7, title: '교육', clauses: [{ text: '교육은 연 1회 한다.', cites: [{ law: LAW2, article: '제7조제1항제1호' }] }] }] }],
  },
];

let dataDir = '';
let demoSlug = '';
let demoEmail = '';
let demoPassword = '';
let demoToken = '';
let other: Awaited<ReturnType<typeof createTenant>>;

const ENV = () => ({ VEDA_DEMO_URL: BASE, VEDA_DEMO_TENANT: demoSlug, VEDA_DEMO_EMAIL: demoEmail, VEDA_DEMO_PASSWORD: demoPassword });
async function seed(argv: string[] = []) {
  const out: string[] = [];
  const code = await main(argv, ENV(), { out: (s: string) => out.push(s), err: (s: string) => out.push(s) }, { dataDir, paceMs: 0 });
  return { code, text: out.join('\n') };
}
const tenantCounts = (slug: string) =>
  sql(`SELECT
      (SELECT count(*) FROM policies p JOIN tenants t ON t.id = p.tenant_id WHERE t.slug = '${slug}') || ',' ||
      (SELECT count(*) FROM law_links l JOIN tenants t ON t.id = l.tenant_id WHERE t.slug = '${slug}') || ',' ||
      (SELECT count(*) FROM amendment_candidates c JOIN tenants t ON t.id = c.tenant_id WHERE t.slug = '${slug}') || ',' ||
      (SELECT count(*) FROM amendment_candidates c JOIN tenants t ON t.id = c.tenant_id WHERE t.slug = '${slug}' AND c.review_state IN ('draft', 'review')) || ',' ||
      (SELECT count(*) FROM amendment_candidates c JOIN tenants t ON t.id = c.tenant_id WHERE t.slug = '${slug}' AND c.review_state = 'review') || ',' ||
      (SELECT count(*) FROM user_notifications n JOIN tenants t ON t.id = n.tenant_id WHERE t.slug = '${slug}');`);
const parse = (s: string) => {
  const [policiesN, links, candidates, pending, review, notifications] = s.split(',').map(Number);
  return { policies: policiesN, links, candidates, pending, review, notifications };
};

function cleanup() {
  const events = Object.values(ids.events).map((x) => `'${x}'`).join(',');
  const arts = Object.values(ids.arts).map((x) => `'${x}'`).join(',');
  const laws = ids.laws.map((x) => `'${x}'`).join(',');
  sql(`
    DELETE FROM amendment_candidates WHERE change_event_id IN (${events});
    UPDATE article_versions SET change_event_id = NULL WHERE change_event_id IN (${events});
    DELETE FROM law_change_events WHERE id IN (${events});
    DELETE FROM law_links WHERE law_article_id IN (${arts});
    DELETE FROM laws WHERE id IN (${laws});
    DELETE FROM law_sources WHERE id = '${ids.source}';
  `);
}

beforeAll(async () => {
  await waitForApi();
  dataDir = mkdtempSync(join(tmpdir(), 'demo-seed-int-'));
  policies.forEach((p, i) => writeFileSync(join(dataDir, `0${i + 1}.json`), JSON.stringify(p)));

  const [L1, L2] = ids.laws;
  const a = ids.arts;
  const e = ids.events;
  sql(`
    INSERT INTO law_sources (id, code, name, base_url, updated_at) VALUES ('${ids.source}', 'it-${ids.source.slice(0, 8)}', '통합테스트', 'http://example.test', now());
    INSERT INTO laws (id, source_id, external_id, external_law_id, law_name, effective_date, last_checked_at, updated_at) VALUES
      ('${L1}', '${ids.source}', '${ext()}', '${ext()}', '${LAW1}', '2020-01-01', now(), now()),
      ('${L2}', '${ids.source}', '${ext()}', '${ext()}', '${LAW2}', '2020-01-01', now(), now());
    INSERT INTO law_articles (id, law_id, node_key, article_no, clause_no, item_no, label, content, version_key, sort_order, updated_at) VALUES
      ('${a.l1j3}', '${L1}', '3//', 3, NULL, NULL, '제3조', '', 'v1', 1, now()),
      ('${a.l1c31}', '${L1}', '3/1/', 3, 1, NULL, '제3조제1항', '사용자는 15일의 휴가를 주어야 한다.', 'v1', 2, now()),
      ('${a.l1c32}', '${L1}', '3/2/', 3, 2, NULL, '제3조제2항', '휴가는 나누어 쓸 수 있다.', 'v1', 3, now()),
      ('${a.l1j5}', '${L1}', '5//', 5, NULL, NULL, '제5조', '보고는 분기마다 한다.', 'v1', 4, now()),
      ('${a.l1j9}', '${L1}', '9//', 9, NULL, NULL, '제9조', '벌칙을 정한다.', 'v1', 5, now()),
      ('${a.l2j7}', '${L2}', '7//', 7, NULL, NULL, '제7조', '', 'v1', 1, now()),
      ('${a.l2c71}', '${L2}', '7/1/', 7, 1, NULL, '제7조제1항', '사업주는 다음 교육을 하여야 한다.', 'v1', 2, now()),
      ('${a.l2i711}', '${L2}', '7/1/1', 7, 1, 1, '제7조제1항제1호', '연 1회 교육', 'v1', 3, now());
    INSERT INTO law_change_events (id, law_id, law_article_id, node_key, change_type, before_content, after_content, before_version_key, after_version_key, law_effective_date, promulgated_date, received_via, amendments_processed_at) VALUES
      ('${e.in}', '${L1}', '${a.l1c31}', '3/1/', 'modified', '사용자는 15일의 휴가를 주어야 한다.', '사용자는 20일의 휴가를 주어야 한다.', 'v1', 'v2', '${plusDays(60)}', '${plusDays(-20)}', 'poll', now()),
      ('${e.out}', '${L1}', '${a.l1j5}', '5//', 'modified', '보고는 반기마다 한다.', '보고는 분기마다 한다.', 'v0', 'v1', '2025-06-01', '2025-01-10', 'poll', now()),
      ('${e.item}', '${L2}', '${a.l2i711}', '7/1/1', 'modified', '연 1회 교육', '연 2회 교육', 'v1', 'v2', '${today}', '${plusDays(-40)}', 'poll', now()),
      ('${e.none}', '${L1}', '${a.l1j9}', '9//', 'modified', '벌칙을 정한다.', '벌칙을 무겁게 정한다.', 'v1', 'v2', '${plusDays(60)}', '${plusDays(-20)}', 'poll', now());
  `);

  // 다른 고객사 — 같은 법령 조항에 자기 연결·후보를 가진다(우리 실행에 섞이면 안 된다)
  other = await createTenant('demo-other');
  const op = await api('/policies/import', {
    method: 'POST',
    token: other.token,
    json: { code: 'DS-1', title: '다른 회사 규정', effectiveDate: '2025-01-01', chapters: [{ number: 1, title: '총칙', articles: [{ number: 1, title: '휴가', content: '휴가는 15일이다.' }] }] },
  });
  expect(op.status, JSON.stringify(op.body)).toBeLessThan(300);
  const orow = await api(`/policies/${op.body.id}`, { token: other.token });
  const link = await api('/law-links', { method: 'POST', token: other.token, json: { lawArticleId: a.l1c31, articleId: orow.body.chapters[0].articles[0].id, relationType: 'obligation' } });
  expect(link.status, JSON.stringify(link.body)).toBeLessThan(300);
  // 창 밖 변경(e.out, 5//)이 닿는 조항에도 다른 고객사의 확정 연결을 건다 — 창 밖이라 지금은 후보가 없고, 우리 실행의
  // '개정 후보 만들기'가 고객사 경계를 넘으면 이 고객사에 후보가 생겨 아래 '다른 고객사 그대로'가 깨진다
  const outLink = await api('/law-links', { method: 'POST', token: other.token, json: { lawArticleId: a.l1j5, articleId: orow.body.chapters[0].articles[0].id, relationType: 'obligation' } });
  expect(outLink.status, JSON.stringify(outLink.body)).toBeLessThan(300);

  // 시연 고객사 — 통합 관리자가 개설(Pro), 첫 관리자는 임시 비밀번호를 받는다
  const platform = await createTenant('demo-pf');
  sql(`UPDATE users SET platform_role = 'global_admin' WHERE id = '${platform.user.id}';`);
  demoSlug = `it-demo-${Date.now().toString(36)}${tag}`;
  demoEmail = `${demoSlug}@example.test`;
  const opened = await api('/platform-admin/tenants', { method: 'POST', token: platform.token, json: { name: '시연 시험 회사', slug: demoSlug, plan: 'pro', masterEmail: demoEmail, masterName: '시연 관리자' } });
  expect(opened.status, JSON.stringify(opened.body)).toBe(201);
  demoPassword = opened.body.temporaryPassword;
}, 120_000);

afterAll(async () => {
  for (const token of [demoToken, other?.token].filter(Boolean)) {
    const list = await api('/policies', { token });
    for (const p of (list.body as { id: string }[]) ?? []) await api(`/policies/${p.id}`, { method: 'DELETE', token });
  }
  cleanup();
  if (dataDir) rmSync(dataDir, { recursive: true, force: true });
}, 120_000);

describe('시연 데이터 채우기 — 실제 API (T-216 ⑦)', () => {
  let otherBefore = '';
  let first: ReturnType<typeof parse>;

  it('임시 비밀번호 그대로면 화면에서 먼저 바꾸라고 알리고 멈춘다 — 아무것도 쓰지 않는다', async () => {
    const r = await seed();
    expect(r.code).toBe(3);
    expect(r.text).toContain('비밀번호를 먼저 바꿔야 합니다');
    expect(parse(tenantCounts(demoSlug)).policies).toBe(0);
    // 화면에서 바꾼 것처럼 — 첫 로그인 → 비밀번호 변경
    const login = await api('/auth/login', { method: 'POST', json: { email: demoEmail, password: demoPassword, tenantSlug: demoSlug } });
    const changed = await api('/users/me/password', { method: 'POST', token: login.body.accessToken, json: { currentPassword: demoPassword, newPassword: 'DemoSeed!2345' } });
    expect(changed.status, JSON.stringify(changed.body)).toBeLessThan(300);
    demoPassword = 'DemoSeed!2345';
    const again = await api('/auth/login', { method: 'POST', json: { email: demoEmail, password: demoPassword, tenantSlug: demoSlug } });
    demoToken = again.body.accessToken;
    otherBefore = tenantCounts(other.slug);
  });

  it('--plan 은 쓰지 않고 쓸 변경(창 안/밖)과 만들 후보 수를 보인다', async () => {
    const r = await seed(['--plan']);
    expect(r.code, r.text).toBe(0);
    expect(r.text).toContain('새로 넣을 시연 규정: DS-1, DS-2');
    expect(r.text).toContain('새로 등록할 법령: 없음');
    expect(r.text).toMatch(new RegExp(`${LAW1} .*시행 ${plusDays(60)} · 창 안 — 연결하면 바로 후보 · 변경 1건 · 닿는 조문 1개`));
    expect(r.text).toMatch(new RegExp(`${LAW1} .*시행 2025-06-01 · 창 밖 — '개정 후보 만들기'로`));
    expect(r.text).toContain('개정 후보: 새로 최대 3건(연결하면 바로 2 · 만들기 1)');
    expect(parse(tenantCounts(demoSlug)).policies).toBe(0);
  });

  it('채우기 — 규정 둘·연결 넷·처리 대기 후보 셋(검토 중 하나), 다른 고객사는 그대로', async () => {
    const r = await seed();
    expect(r.code, r.text).toBe(0);
    first = parse(tenantCounts(demoSlug));
    expect(first).toMatchObject({ policies: 2, links: 4, candidates: 3, pending: 3, review: 1 });
    expect(r.text).toContain('처리 대기 후보(작성·검토 중): 3건 — 검토 중 1건');
    // 연결을 확정하며 바로 생긴 후보(T-149)도 '새로'로 센다 — 계획의 '연결하면 바로 2 · 만들기 1'과 같은 수(6차 #2)
    expect(r.text).toContain('새로 3건(연결하면서 생김 2 · 만들기 1), 이미 있음 0건');
    expect(tenantCounts(other.slug)).toBe(otherBefore);
  });

  it('두 번째 실행은 새로 만드는 것이 없다', async () => {
    const r = await seed();
    expect(r.code, r.text).toBe(0);
    expect(parse(tenantCounts(demoSlug))).toEqual(first);
    expect(r.text).toContain('넣은 시연 규정: 0개');
    expect(r.text).toContain('법령 연결: 새로 0건, 이미 있음 4건');
    // 개정 후보 줄에 묶는다 — '새로 0건, 이미 있음 N건'은 법령 연결 줄로도 맞는다(7차 #6)
    expect(r.text).toMatch(/개정 후보: 닿는 변경 \d+건에서 새로 0건, 이미 있음 3건/);
    expect(tenantCounts(other.slug)).toBe(otherBefore);
  });

  it('후보 하나를 승인한 뒤 --reset 으로 다시 채우면 처리 대기 수가 처음과 같다', async () => {
    const list = await api('/amendments?state=review', { token: demoToken });
    const target = list.body.rows[0];
    const detail = await api(`/amendments/${target.id}`, { token: demoToken });
    const approved = await api(`/amendments/${target.id}/approve`, {
      method: 'POST',
      token: demoToken,
      json: { expectedRevision: detail.body.revision, expectedLockVersion: detail.body.lockVersion, effectiveDate: plusDays(90), changeNote: '시연 승인' },
    });
    expect(approved.status, JSON.stringify(approved.body)).toBeLessThan(300);
    expect(parse(tenantCounts(demoSlug)).pending).toBe(first.pending - 1);
    const r = await seed(['--reset']);
    expect(r.code, r.text).toBe(0);
    expect(r.text).toContain('지운 시연 규정: 2개');
    expect(parse(tenantCounts(demoSlug))).toMatchObject({ policies: 2, links: 4, pending: first.pending, review: 1 });
    expect(tenantCounts(other.slug)).toBe(otherBefore);
  });

  it("시연 고객사의 다른 규정에도 확정 연결이 닿는 변경은 '개정 후보 만들기'를 하지 않는다 — 그 규정에 후보가 생기지 않는다(3차 #2)", async () => {
    // 시연 코드가 아닌 규정 하나가 창 밖 변경(e.out, 5//)이 닿는 조항에 확정 연결돼 있다
    const own = await api('/policies/import', {
      method: 'POST',
      token: demoToken,
      json: { code: 'REAL-1', title: '실제 규정', effectiveDate: '2025-01-01', chapters: [{ number: 1, title: '총칙', articles: [{ number: 1, title: '보고', content: '보고는 분기마다 한다.' }] }] },
    });
    expect(own.status, JSON.stringify(own.body)).toBeLessThan(300);
    const ownRow = (await api(`/policies/${own.body.id}`, { token: demoToken })).body.chapters[0].articles[0].id;
    const link = await api('/law-links', { method: 'POST', token: demoToken, json: { lawArticleId: ids.arts.l1j5, articleId: ownRow, relationType: 'obligation' } });
    expect(link.status, JSON.stringify(link.body)).toBeLessThan(300);
    const r = await seed(['--reset']);
    expect(r.code, r.text).toBe(0);
    expect(r.text).toContain("다른 규정에도 닿아 '개정 후보 만들기'를 하지 않음");
    const ownCandidates = sql(`SELECT count(*) FROM amendment_candidates c JOIN articles a ON a.id = c.article_id WHERE a.id = '${ownRow}';`);
    expect(Number(ownCandidates)).toBe(0);
    // 시연 규정의 창 밖 후보(5//)도 이번에는 만들지 않는다 — 처리 대기는 처음보다 하나 적다
    expect(parse(tenantCounts(demoSlug)).pending).toBe(first.pending - 1);
    expect(tenantCounts(other.slug)).toBe(otherBefore);
    // 다음 시험이 쓰도록 그 연결을 걷는다
    const del = await api(`/law-links/${link.body.id}`, { method: 'DELETE', token: demoToken });
    expect(del.status, JSON.stringify(del.body)).toBeLessThan(300);
  });

  it("한 변경이 닿는 시연 조문 일부에만 후보가 있으면 '개정 후보 만들기'를 하지 않는다 — 이미 후보가 있는 조문에 다시 생기지 않게(4차 #1)", async () => {
    // 다른 규정이 빠졌으니 창 밖 변경(e.out, 5//)으로 시연 조문(DS-1 제5조)에 후보가 생긴다
    const r1 = await seed();
    expect(r1.code, r1.text).toBe(0);
    const outCount = () => Number(sql(`SELECT count(*) FROM amendment_candidates WHERE change_event_id = '${ids.events.out}';`));
    expect(outCount()).toBe(1);
    // 다른 시연 조문(DS-1 제3조제2항)도 같은 조항(5//)에 확정 연결 — 창 밖이라 연결할 때 후보가 생기지 않는다
    const ds1 = ((await api('/policies', { token: demoToken })).body as { id: string; code: string }[]).find((p) => p.code === 'DS-1')!;
    const rows = (await api(`/policies/${ds1.id}`, { token: demoToken })).body.chapters.flatMap((c: { articles: unknown[] }) => c.articles) as { id: string; number: number; clauseNumber: number | null }[];
    const row32 = rows.find((r) => r.number === 3 && r.clauseNumber === 2)!;
    const extra = await api('/law-links', { method: 'POST', token: demoToken, json: { lawArticleId: ids.arts.l1j5, articleId: row32.id, relationType: 'obligation' } });
    expect(extra.status, JSON.stringify(extra.body)).toBeLessThan(300);
    expect(outCount()).toBe(1);
    const r2 = await seed();
    expect(r2.code, r2.text).toBe(0);
    expect(r2.text).toContain("일부 시연 조문에만 후보가 있어 '개정 후보 만들기'를 하지 않음");
    // 계획도 서버의 지금 영향 판정으로 센다 — 손으로 더 건 연결(제3조제2항)까지(5차 #6)
    expect(r2.text.split('실행합니다.')[0]).toContain('일부 조문에만 후보가 있어 만들지 않음 1건');
    expect(outCount()).toBe(1);
    expect(tenantCounts(other.slug)).toBe(otherBefore);
  });
});
