import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execSync } from 'child_process';
import { randomUUID } from 'crypto';
import { api, createTenant, createPolicyWithArticle, waitForApi } from './helpers';

/**
 * 놓친 개정 후보 보충 — 배포 때 한 번 돌리는 명령 (T-149, `amendment-catchup.cli.ts`).
 *
 * 처리할 때 놓친 두 가지를 만든다: ㉠ 위 조항(조·항) 연결로만 닿는데 T-148 반영(2026-10-31T11:12:12Z) 전에 처리된 변경,
 * ㉡ 처리 뒤에 확정한 연결. 직접 연결이 처리 때 이미 있었는데 후보가 없는 조문(처리 때 까닭이 있어 건너뛴 것)과 기능 도입 전
 * 변경, 창 밖 변경은 만들지 않는다. 공용 DB 라 다른 시험의 데이터가 합계에 섞이므로 `--tenant` 로 이 시험 회사만 본다.
 * 컨테이너 안 dist 를 부른다 — api 이미지를 다시 빌드한 뒤에 돌린다.
 *
 * 막고 싶은 사고:
 * 1. 계획(--plan)이 쓰거나, 계획과 실행의 수가 어긋난다 — 같은 길(generateForEvent 의 plan)로 센다
 * 2. 대상이 아닌 조문(T-148 전에 처리된 직접 연결, 더 가까운 직접 연결이 있는 조문, T-148 뒤 처리·기능 도입 전·창 밖)까지 만든다
 * 3. 상한을 넘어도 만든다, 두 번째 실행이 또 만든다
 * 4. 잘못된 행(연결의 회사 ≠ 조문의 회사)을 놓치거나 코드가 지운다
 */

function sql(query: string): string {
  return execSync(
    `docker compose exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -t -A -v ON_ERROR_STOP=1 -f -'`,
    { encoding: 'utf8', input: query, stdio: ['pipe', 'pipe', 'pipe'] },
  ).trim();
}

const CLI = process.env.AMENDMENT_CATCHUP_CLI || 'docker compose exec -T api node dist/amendments/amendment-catchup.cli.js';
function cli(args: string): { code: number; out: string } {
  try {
    return { code: 0, out: execSync(`${CLI} ${args}`, { encoding: 'utf8', stdio: 'pipe' }) };
  } catch (e: any) {
    return { code: e.status ?? -1, out: `${e.stdout ?? ''}${e.stderr ?? ''}` };
  }
}

/** 한국 날짜 */
const day = (offset: number) => new Date(Date.now() + 9 * 3_600_000 + offset * 86_400_000).toISOString().slice(0, 10);

describe('T-149 놓친 개정 후보 보충 명령', () => {
  const sourceId = randomUUID();
  const lawId = randomUUID();
  const node = ['60//', '60/1/', '70//', '70/1/', '80//', '80/1/'] as const;
  const la = Object.fromEntries(node.map((k) => [k, randomUUID()])) as Record<(typeof node)[number], string>;
  const ev = { a: randomUUID(), b: randomUUID(), c: randomUUID(), pre: randomUUID(), old: randomUUID(), noop: randomUUID() };
  const bad = randomUUID();
  let t1: Awaited<ReturnType<typeof createTenant>>;
  let t2: Awaited<ReturnType<typeof createTenant>>;
  const art = { a1: '', a2: '', a3: '', a4: '', a5: '', a6: '', a7: '', b1: '' };

  const made = () =>
    sql(`SELECT article_id || '|' || change_event_id FROM amendment_candidates WHERE tenant_id='${t1.user.tenantId}' ORDER BY 1;`)
      .split('\n')
      .filter(Boolean);
  const lawNotes = async () => (await api('/notifications', { token: t1.token })).body.filter((n: { kind: string }) => n.kind === 'law_amendment');

  beforeAll(async () => {
    await waitForApi();
    t1 = await createTenant('catchup-1');
    t2 = await createTenant('catchup-2');
    const values = node.map((k, i) => {
      const [jo, hang] = k.split('/');
      return `('${la[k]}', '${lawId}', '${k}', ${jo}, ${hang || 'NULL'}, NULL, '제${jo}조${hang ? `제${hang}항` : ''}', '${hang ? '새 문구' : ''}', 'v1:${i}', ${i + 1}, now())`;
    });
    sql(`
      INSERT INTO law_sources (id, code, name, base_url, updated_at) VALUES ('${sourceId}', 'it-${sourceId.slice(0, 8)}', '통합테스트', 'http://example.test', now());
      INSERT INTO laws (id, source_id, external_id, external_law_id, law_name, effective_date, updated_at)
        VALUES ('${lawId}', '${sourceId}', '900150', '990150', '보충시험법', '${day(20)}', now());
      INSERT INTO law_articles (id, law_id, node_key, article_no, clause_no, item_no, label, content, version_key, sort_order, updated_at) VALUES
        ${values.join(',\n        ')};
    `);

    const { policy, chapter, article } = await createPolicyWithArticle(t1.token, `CAT-${Date.now().toString(36)}`, '취업규칙');
    art.a1 = article.id;
    const add = async (number: number, title: string) =>
      (await api(`/policies/${policy.id}/chapters/${chapter.id}/articles`, { method: 'POST', token: t1.token, json: { number, title, content: `${title} 본문` } }))
        .body.id as string;
    art.a2 = await add(2, '처리 뒤 확정한 직접 연결');
    art.a3 = await add(3, 'T-148 뒤 처리, 위 조항 연결');
    art.a4 = await add(4, '확정 시각 없음, 처리 뒤 생성');
    art.a5 = await add(5, '처리 때 있던 직접 연결');
    art.a6 = await add(6, 'T-148 전 처리, 처리 때 있던 직접 연결');
    art.a7 = await add(7, '조 연결은 처리 뒤 확정, 더 가까운 항 연결은 처리 때 있음');
    art.b1 = (await createPolicyWithArticle(t2.token, `CAT2-${Date.now().toString(36)}`, '다른 회사 규정')).article.id;
    const ids = Object.values(art);
    sql(`
      DELETE FROM article_versions WHERE article_id IN (${ids.map((id) => `'${id}'`).join(', ')});
      INSERT INTO article_versions (id, article_id, version_num, content, status, effective_date, updated_at) VALUES
        ${ids.map((id) => `('${randomUUID()}', '${id}', 1, '연차 유급휴가는 15일로 한다.', 'published', '2020-01-01', now())`).join(',\n        ')};
    `);

    // 연결 — 화면을 거치지 않고 넣는다(확정 시점 경로가 돌지 않게, 확정 시각을 정해 두려고)
    // 변경 — A 는 T-148 전 처리, B·C 는 그 뒤 처리. 기능 도입 전(처리 = 감지)과 창 밖은 빠진다
    sql(`
      INSERT INTO law_links (id, tenant_id, law_article_id, article_id, relation_type, confirm_state, confirmed_at, created_at, updated_at) VALUES
        ('${randomUUID()}', '${t1.user.tenantId}', '${la['60//']}', '${art.a1}', 'citation', 'confirmed', '2026-10-28 00:00:00', '2026-10-28 00:00:00', now()),
        ('${randomUUID()}', '${t1.user.tenantId}', '${la['70/1/']}', '${art.a2}', 'citation', 'confirmed', now(), now(), now()),
        ('${randomUUID()}', '${t1.user.tenantId}', '${la['70//']}', '${art.a3}', 'citation', 'confirmed', now() - interval '3 days', now() - interval '3 days', now()),
        ('${randomUUID()}', '${t1.user.tenantId}', '${la['80//']}', '${art.a4}', 'citation', 'confirmed', NULL, now(), now()),
        ('${randomUUID()}', '${t1.user.tenantId}', '${la['80/1/']}', '${art.a5}', 'citation', 'confirmed', now() - interval '3 days', now() - interval '3 days', now()),
        ('${randomUUID()}', '${t1.user.tenantId}', '${la['60/1/']}', '${art.a6}', 'citation', 'confirmed', '2026-10-28 00:00:00', '2026-10-28 00:00:00', now()),
        ('${randomUUID()}', '${t1.user.tenantId}', '${la['60//']}', '${art.a7}', 'citation', 'confirmed', now(), now(), now()),
        ('${randomUUID()}', '${t1.user.tenantId}', '${la['60/1/']}', '${art.a7}', 'citation', 'confirmed', '2026-10-28 00:00:00', '2026-10-28 00:00:00', now()),
        ('${bad}', '${t1.user.tenantId}', '${la['60//']}', '${art.b1}', 'citation', 'confirmed', now(), now(), now());
      INSERT INTO law_change_events (id, law_id, law_article_id, node_key, change_type, before_content, after_content, law_effective_date, received_via, detected_at, amendments_processed_at) VALUES
        ('${ev.a}', '${lawId}', '${la['60/1/']}', '60/1/', 'modified', '옛 문구', '새 문구', '${day(20)}', 'poll', '2026-10-29 00:00:00', '2026-10-30 00:00:00'),
        ('${ev.b}', '${lawId}', '${la['70/1/']}', '70/1/', 'modified', '옛 문구', '새 문구', '${day(20)}', 'poll', now() - interval '2 days', now() - interval '1 day'),
        ('${ev.c}', '${lawId}', '${la['80/1/']}', '80/1/', 'modified', '옛 문구', '새 문구', '${day(20)}', 'poll', now() - interval '2 days', now() - interval '1 day'),
        ('${ev.pre}', '${lawId}', '${la['60/1/']}', '60/1/', 'modified', '옛 문구', '새 문구', '${day(20)}', 'poll', '2026-10-29 01:00:00', '2026-10-29 01:00:00'),
        ('${ev.old}', '${lawId}', '${la['60/1/']}', '60/1/', 'modified', '옛 문구', '새 문구', '${day(-31)}', 'poll', '2026-10-29 00:00:00', '2026-10-30 00:00:00'),
        ('${ev.noop}', '${lawId}', '${la['70/1/']}', '70/1/', 'modified', '새 문구 <개정 2012.2.1>', '새 문구 <개정 2012.2.1, 2027.1.1>', '${day(20)}', 'poll', now() - interval '2 days', now() - interval '1 day');
    `);
  }, 120_000);

  afterAll(() => {
    sql(`
      DELETE FROM amendment_candidates WHERE change_event_id IN (SELECT id FROM law_change_events WHERE law_id='${lawId}');
      DELETE FROM laws WHERE id='${lawId}';
      DELETE FROM law_sources WHERE id='${sourceId}';
    `);
  });

  it('--plan 은 쓰지 않고 회사의 만들 후보 수·까닭, 확정 시각이 빈 연결, 잘못된 행과 지울 SQL 을 찍는다', () => {
    const r = cli(`--plan --tenant ${t1.user.tenantId}`);
    expect(r.code, r.out).toBe(0);
    // ㉡ 셋 가운데 하나(연혁 표기만 바뀐 변경)는 본문 변화가 없어 만들지 않는다 — 대상 수와 만들 수가 왜 다른지 찍는다
    expect(r.out).toContain(
      `회사 ${t1.user.tenantId}: 만들 후보 3건(변경 3건 · 조문 3곳) — 대상 조문 ㉠ 위 조항 연결 1 · ㉡ 처리 뒤 확정 3 · 만들지 않을 것(기준 본문 없음·폐지·본문 변화 없음) 1`,
    );
    expect(r.out).toContain('합계 만들 후보 3건 · 회사 1곳 · 확정 시각이 빈 확정 연결 1개');
    expect(r.out).toContain('잘못된 행 1개');
    expect(r.out).toContain(bad);
    expect(r.out).toContain(`WHERE ll.id IN ('${bad}')`);
    expect(r.out).toContain('(DB 에는 쓰지 않았습니다)');
    expect(r.out).toContain('상한 합계 100건·한 회사 20건,'); // 기본값 — 올린 값이면 '(기본값 아님 — PM 승인 값)'
    expect(made()).toEqual([]);
    expect(sql(`SELECT count(*) FROM law_links WHERE id='${bad}';`)).toBe('1'); // 코드는 지우지 않는다
  });

  it('운영처럼 범위 없이 돌려도 이 회사를 찾아 같은 수를 낸다 — 회사 찾기 조회', () => {
    // 공용 DB 라 다른 시험의 데이터로 상한·세기 실패가 날 수 있어 종료 코드는 보지 않는다(회사 줄은 상한 검사 전에 찍힌다)
    const r = cli('--plan');
    expect(r.out).toContain(`회사 ${t1.user.tenantId}: 만들 후보 3건(변경 3건 · 조문 3곳) — 대상 조문 ㉠ 위 조항 연결 1 · ㉡ 처리 뒤 확정 3`);
    expect(made()).toEqual([]);
  });

  it('상한을 넘으면 만들지 않고 2 로 끝난다 — PM 승인 뒤 값을 올려 다시 돌린다', () => {
    const r = cli(`--tenant ${t1.user.tenantId} --max-per-tenant 2`);
    expect(r.code, r.out).toBe(2);
    expect(r.out).toContain('상한 합계 100건·한 회사 2건(기본값 아님 — PM 승인 없이 쓰지 않는다)');
    expect(r.out).toContain('상한을 넘었습니다');
    expect(r.out).toContain('만들지 않았습니다');
    expect(made()).toEqual([]);
    const total = cli(`--plan --tenant ${t1.user.tenantId} --max-total 2`);
    expect(total.code, total.out).toBe(2);
  });

  it('실행하면 ㉠·㉡ 대상만 계획한 수만큼 만들고 회사에 알림 하나, 다시 돌리면 0건이다', async () => {
    const r = cli(`--tenant ${t1.user.tenantId}`);
    expect(r.code, r.out).toBe(0);
    expect(r.out).toContain('만든 후보 3건 / 계획 3건 — 일치합니다');
    expect(made()).toEqual([`${art.a1}|${ev.a}`, `${art.a2}|${ev.b}`, `${art.a4}|${ev.c}`].sort());

    const notes = await lawNotes();
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({ title: '[법령 개정] 개정 후보 3건', link: '/amendments' });
    expect(notes[0].body).toContain('그동안 만들지 못한 개정 후보 3건을 우리 조문 3곳에 만들었습니다');
    expect(sql(`SELECT details->>'origin' FROM audit_logs WHERE action='amendment.generate' AND entity_id='${ev.a}' AND tenant_id='${t1.user.tenantId}';`)).toBe('catchup');

    const again = cli(`--tenant ${t1.user.tenantId}`);
    expect(again.code, again.out).toBe(0);
    expect(again.out).toContain('만든 후보 0건 / 계획 0건');
    expect(made()).toHaveLength(3);
    expect(await lawNotes()).toHaveLength(1);
  });

  it('잘못된 인자는 1 로 끝나고 아무것도 만들지 않는다(거부) — --plan 오타가 계획을 건너뛰고 쓰지 않게', () => {
    const before = made();
    for (const args of ['--tenant', '--tenant --plan', '--max-total -1', '--max-per-tenant x', '--max-total 1e3', '--tenant not-a-uuid', '--paln', `--tenant=${t1.user.tenantId}`, '—plan']) {
      const r = cli(args);
      expect(r.code, `${args}: ${r.out}`).toBe(1);
      expect(r.out).toContain('[amendment-catchup] 실행 실패');
    }
    expect(cli('--paln').out).toContain('알 수 없는 인자: --paln');
    expect(made()).toEqual(before);
  });
});
