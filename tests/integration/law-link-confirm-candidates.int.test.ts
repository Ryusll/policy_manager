import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execSync } from 'child_process';
import { randomUUID } from 'crypto';
import { api, createTenant, createPolicyWithArticle, login, waitForApi } from './helpers';

/**
 * 연결을 확정할 때 개정 후보를 만든다 (T-149).
 *
 * 동기화 끝 자동 생성은 이벤트를 처리할 때 이미 확정된 연결만 본다. 그 뒤에 확정한 연결의 조문은 화면에서 직접 만들어야 해서
 * 대표 시연 흐름(법령 등록 → 규정 가져오기 → 연결 확정 → 후보)이 끊겼다. 이제 연결이 확정되는 순간(만들기·확정으로 바꾸기)
 * 법령 시행일이 오늘 이후이거나 최근 30일 안인 변경으로 그 연결의 조문 후보를 만들고 회사에 알림 하나를 보낸다.
 * 법제처 없이 돈다 — 법령·조항·변경 이벤트를 DB 에 직접 심는다.
 *
 * 막고 싶은 사고:
 * 1. 확정해도 후보가 생기지 않는다(두 경로 모두) — 또는 창 밖·시행일 없는 변경까지 만든다(창 안이면 기능 도입 전 변경도 만든다 — 대장은 창만 건다)
 * 2. 같은 회사의 다른 연결로 닿는 조문까지 만든다(세어 둔 수와 어긋난다)
 * 3. 변경마다 알림이 쏟아진다, 반려 뒤 다시 확정하면 후보·알림이 또 생긴다
 * 4. 다른 회사의 조문·잘못된 행으로 남의 회사에 후보가 생긴다, 열람자가 연결을 만든다
 */

function sql(query: string): string {
  return execSync(
    `docker compose exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -t -A -v ON_ERROR_STOP=1 -f -'`,
    { encoding: 'utf8', input: query },
  ).trim();
}

/** 한국 날짜 — 서버의 "오늘"(todayDateOnly)이 한국 날짜다 */
const day = (offset: number) => new Date(Date.now() + 9 * 3_600_000 + offset * 86_400_000).toISOString().slice(0, 10);

describe('T-149 연결을 확정할 때 개정 후보를 만든다', () => {
  const sourceId = randomUUID();
  const lawId = randomUUID();
  const node = ['60//', '60/1/', '60/2/', '60/3/', '60/4/', '60/5/', '60/6/', '60/7/', '70//', '70/1/', '80//', '80/1/'] as const;
  const la = Object.fromEntries(node.map((k) => [k, randomUUID()])) as Record<(typeof node)[number], string>;
  // 창: 오늘 이후·최근 30일 안. 미처리 변경과 기능 도입 전 변경(처리 = 감지)도 창 안이면 든다. 오래된 것·시행일 없음은 빠진다
  const ev = {
    future: randomUUID(), // 60/1/ +30일
    soon: randomUUID(), // 60/2/ +10일
    old: randomUUID(), // 60/3/ −31일 — 창 밖
    noDate: randomUUID(), // 60/4/ 시행일 없음
    pre: randomUUID(), // 60/5/ 기능 도입 전(처리 = 감지) — 창 안이라 확정 시점에는 든다
    edge: randomUUID(), // 60/6/ −30일 — 창 안(경계)
    pending: randomUUID(), // 60/7/ 아직 처리하지 않음
    s: randomUUID(), // 70/1/ — 추천을 확정으로
    r: randomUUID(), // 80/1/ — 반려 뒤 다시 확정
  };

  let t1: Awaited<ReturnType<typeof createTenant>>;
  let t2: Awaited<ReturnType<typeof createTenant>>;
  let viewerToken = '';
  let platformToken = '';
  const art = { x: '', y: '', s: '', r: '', e: '', w: '' };
  const link = { s: '', e: '', bad: '' };

  const candidates = (tenantId: string, articleId: string) =>
    sql(`SELECT change_event_id FROM amendment_candidates WHERE tenant_id='${tenantId}' AND article_id='${articleId}' ORDER BY change_event_id;`)
      .split('\n')
      .filter(Boolean);
  const lawNotes = async (token: string) =>
    (await api('/notifications', { token })).body.filter((n: { kind: string }) => n.kind === 'law_amendment');

  beforeAll(async () => {
    await waitForApi();
    t1 = await createTenant('confirm-1');
    t2 = await createTenant('confirm-2');
    const email = `viewer-${Date.now().toString(36)}@confirm.test`;
    const added = await api('/users', { method: 'POST', token: t1.token, json: { email, password: 'Viewer-pass-1234', name: '열람자', role: 'viewer' } });
    expect(added.status, JSON.stringify(added.body)).toBeLessThan(300);
    viewerToken = (await login(email, 'Viewer-pass-1234', t1.slug)).body.accessToken;
    const platform = await createTenant('confirm-pf');
    sql(`UPDATE users SET platform_role='global_admin' WHERE id='${platform.user.id}';`);
    platformToken = platform.token;

    const values = node.map((k, i) => {
      const [jo, hang] = k.split('/');
      return `('${la[k]}', '${lawId}', '${k}', ${jo}, ${hang || 'NULL'}, NULL, '제${jo}조${hang ? `제${hang}항` : ''}', '${hang ? `${hang}항 본문(개정)` : ''}', 'v1:${i}', ${i + 1}, now())`;
    });
    sql(`
      INSERT INTO law_sources (id, code, name, base_url, updated_at) VALUES ('${sourceId}', 'it-${sourceId.slice(0, 8)}', '통합테스트', 'http://example.test', now());
      INSERT INTO laws (id, source_id, external_id, external_law_id, law_name, effective_date, updated_at)
        VALUES ('${lawId}', '${sourceId}', '900149', '990149', '확정시험법', '${day(30)}', now());
      INSERT INTO law_articles (id, law_id, node_key, article_no, clause_no, item_no, label, content, version_key, sort_order, updated_at) VALUES
        ${values.join(',\n        ')};
    `);

    // 회사 1: X(조 연결을 이 시험에서 만든다), Y(같은 조에 미리 걸린 확정 연결 — 후보를 만들지 않아야 한다), S(추천 → 확정), R(반려 뒤 다시 확정)
    const { policy, chapter, article } = await createPolicyWithArticle(t1.token, `CNF-${Date.now().toString(36)}`, '취업규칙');
    art.x = article.id;
    const add = async (number: number, title: string) =>
      (await api(`/policies/${policy.id}/chapters/${chapter.id}/articles`, { method: 'POST', token: t1.token, json: { number, title, content: `${title} 본문` } }))
        .body.id as string;
    art.y = await add(2, '같은 조의 다른 연결');
    art.s = await add(3, '추천 연결');
    art.r = await add(4, '반려 뒤 확정');
    art.e = await add(5, '근거 문구와 함께 확정');
    art.w = (await createPolicyWithArticle(t2.token, `CNF2-${Date.now().toString(36)}`, '다른 회사 규정')).article.id;
    // 기준 본문 — 법령 시행일 전부터 시행 중인 판
    const ids = Object.values(art);
    sql(`
      DELETE FROM article_versions WHERE article_id IN (${ids.map((id) => `'${id}'`).join(', ')});
      INSERT INTO article_versions (id, article_id, version_num, content, status, effective_date, updated_at) VALUES
        ${ids.map((id) => `('${randomUUID()}', '${id}', 1, '연차 유급휴가는 15일로 한다.', 'published', '2020-01-01', now())`).join(',\n        ')};
    `);
    // 화면을 거치지 않은 연결 — Y 는 확정(이 시험의 확정 전에 이미 있던 것), S 는 추천, 회사 1 이름으로 회사 2 조문을 가리키는 잘못된 행
    link.s = randomUUID();
    link.e = randomUUID();
    link.bad = randomUUID();
    sql(`
      INSERT INTO law_links (id, tenant_id, law_article_id, article_id, relation_type, confirm_state, confirmed_at, updated_at) VALUES
        ('${randomUUID()}', '${t1.user.tenantId}', '${la['60//']}', '${art.y}', 'citation', 'confirmed', now() - interval '2 days', now()),
        ('${link.s}', '${t1.user.tenantId}', '${la['70//']}', '${art.s}', 'citation', 'suggested', NULL, now()),
        ('${link.e}', '${t1.user.tenantId}', '${la['70//']}', '${art.e}', 'citation', 'suggested', NULL, now()),
        ('${link.bad}', '${t1.user.tenantId}', '${la['70//']}', '${art.w}', 'citation', 'suggested', NULL, now());
    `);

    // 변경 — 동기화가 처리한 것은 처리 시각이 감지 시각과 다르다. 기능 도입 전 변경만 둘이 같다
    const row = (id: string, k: (typeof node)[number], effective: string | null, processed: string) =>
      `('${id}', '${lawId}', '${la[k]}', '${k}', 'modified', '옛 문구', '새 문구', ${effective ? `'${effective}'` : 'NULL'}, 'poll', now() - interval '1 day', ${processed})`;
    sql(`
      INSERT INTO law_change_events (id, law_id, law_article_id, node_key, change_type, before_content, after_content, law_effective_date, received_via, detected_at, amendments_processed_at) VALUES
        ${[
          row(ev.future, '60/1/', day(30), 'now()'),
          row(ev.soon, '60/2/', day(10), 'now()'),
          row(ev.old, '60/3/', day(-31), 'now()'),
          row(ev.noDate, '60/4/', null, 'now()'),
          row(ev.edge, '60/6/', day(-30), 'now()'),
          row(ev.pending, '60/7/', day(3), 'NULL'),
          row(ev.s, '70/1/', day(15), 'now()'),
          row(ev.r, '80/1/', day(5), 'now()'),
        ].join(',\n        ')};
      INSERT INTO law_change_events (id, law_id, law_article_id, node_key, change_type, before_content, after_content, law_effective_date, received_via, detected_at, amendments_processed_at)
        VALUES ('${ev.pre}', '${lawId}', '${la['60/5/']}', '60/5/', 'modified', '옛 문구', '새 문구', '${day(20)}', 'poll', '2026-10-05 01:00:00', '2026-10-05 01:00:00');
    `);
  }, 120_000);

  afterAll(() => {
    // 후보가 이벤트를 Restrict 로 잡고 있다 — 먼저 지워야 법령(→ 이벤트·조항·연결)을 지울 수 있다
    sql(`
      DELETE FROM amendment_candidates WHERE change_event_id IN (SELECT id FROM law_change_events WHERE law_id='${lawId}');
      DELETE FROM laws WHERE id='${lawId}';
      DELETE FROM law_sources WHERE id='${sourceId}';
    `);
  });

  it('만들기(POST)로 확정하면 창 안 변경(앞으로·오늘 − 30일·미처리·기능 도입 전)으로 그 조문 후보만 만들고 회사에 알림 하나를 보낸다', async () => {
    const res = await api('/law-links', { method: 'POST', token: t1.token, json: { lawArticleId: la['60//'], articleId: art.x, relationType: 'citation', evidenceText: '연차 유급휴가' } });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body).toMatchObject({ confirmState: 'confirmed', articleId: art.x }); // 응답 모양은 그대로다

    expect(candidates(t1.user.tenantId, art.x)).toEqual([ev.future, ev.soon, ev.edge, ev.pending, ev.pre].sort());
    // 같은 조에 걸린 Y 는 이번 확정과 상관없다 — 조문 목록으로 거른다
    expect(candidates(t1.user.tenantId, art.y)).toEqual([]);

    const notes = await lawNotes(t1.token);
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({ title: '[법령 개정] 개정 후보 5건', link: '/amendments' });
    expect(notes[0].body).toContain('법령 관계를 확정한 조문 1곳에 개정 후보 5건을 만들었습니다(최근 30일 안에 시행됐거나 앞으로 시행될 법령 개정 5건).');
    expect(await lawNotes(viewerToken)).toHaveLength(0); // 받는 사람은 관리자·편집자

    // 감사 기록 — 사람 손이 아닌 자동(system)이고, 연결 확정 때 누가 어느 연결을 확정해 만들었는지 남긴다
    expect(
      sql(
        `SELECT details->>'trigger' || '|' || (details->>'origin') || '|' || (details->>'confirmedBy') || '|' || (details->'confirmedLinkIds'->>0) FROM audit_logs WHERE action='amendment.generate' AND entity_id='${ev.future}' AND tenant_id='${t1.user.tenantId}';`,
      ),
    ).toBe(`system|link_confirm|${t1.user.id}|${res.body.id}`); // confirmedLinkIds — 후보가 생기게 한 계기
  });

  it("창 밖 변경(오래된 것·시행일 없음)은 확정 때 만들지 않고, 화면의 '개정 후보 만들기'로는 그대로 만든다", async () => {
    expect(sql(`SELECT count(*) FROM amendment_candidates WHERE change_event_id IN ('${ev.old}', '${ev.noDate}');`)).toBe('0');
    const gen = await api('/amendments/generate', { method: 'POST', token: t1.token, json: { changeEventId: ev.old } });
    expect(gen.status, JSON.stringify(gen.body)).toBe(200);
    expect(gen.body.created.map((c: { articleId: string }) => c.articleId)).toContain(art.x);
  });

  it('추천을 확정으로 바꿔도(PATCH) 같은 함수로 만든다', async () => {
    const res = await api(`/law-links/${link.s}`, { method: 'PATCH', token: t1.token, json: { confirmState: 'confirmed' } });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(candidates(t1.user.tenantId, art.s)).toEqual([ev.s]);
    expect(await lawNotes(t1.token)).toHaveLength(2);
  });

  it('반려했다가 다시 확정해도 후보·알림이 늘지 않는다 — 이미 후보가 있는 조문은 건너뛴다', async () => {
    const res = await api('/law-links', { method: 'POST', token: t1.token, json: { lawArticleId: la['80//'], articleId: art.r, relationType: 'citation' } });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(candidates(t1.user.tenantId, art.r)).toEqual([ev.r]);
    expect(await lawNotes(t1.token)).toHaveLength(3);

    for (const confirmState of ['rejected', 'confirmed']) {
      const patch = await api(`/law-links/${res.body.id}`, { method: 'PATCH', token: t1.token, json: { confirmState } });
      expect(patch.status, JSON.stringify(patch.body)).toBe(200);
    }
    expect(candidates(t1.user.tenantId, art.r)).toEqual([ev.r]);
    expect(await lawNotes(t1.token)).toHaveLength(3);
    // 이미 확정인 연결의 수정(관계 유형)도 만들지 않는다
    const edit = await api(`/law-links/${res.body.id}`, { method: 'PATCH', token: t1.token, json: { confirmState: 'confirmed', relationType: 'delegation' } });
    expect(edit.status).toBe(200);
    expect(await lawNotes(t1.token)).toHaveLength(3);
  });

  it('남의 조문·잘못된 행은 404, 열람자는 403 — 회사 2 의 확정은 회사 1 에 후보·알림을 만들지 않는다', async () => {
    const before = sql(`SELECT count(*) FROM amendment_candidates WHERE tenant_id='${t1.user.tenantId}';`);
    expect((await api('/law-links', { method: 'POST', token: t1.token, json: { lawArticleId: la['60//'], articleId: art.w, relationType: 'citation' } })).status).toBe(404);
    expect((await api(`/law-links/${link.bad}`, { method: 'PATCH', token: t1.token, json: { confirmState: 'confirmed' } })).status).toBe(404);
    expect((await api('/law-links', { method: 'POST', token: viewerToken, json: { lawArticleId: la['60//'], articleId: art.y, relationType: 'citation' } })).status).toBe(403);
    expect(sql(`SELECT count(*) FROM amendment_candidates WHERE change_event_id IN (SELECT id FROM law_change_events WHERE law_id='${lawId}') AND article_id='${art.w}';`)).toBe('0');

    const own = await api('/law-links', { method: 'POST', token: t2.token, json: { lawArticleId: la['60//'], articleId: art.w, relationType: 'citation' } });
    expect(own.status, JSON.stringify(own.body)).toBe(201);
    expect(candidates(t2.user.tenantId, art.w)).toEqual([ev.future, ev.soon, ev.edge, ev.pending, ev.pre].sort());
    expect(await lawNotes(t2.token)).toHaveLength(1);
    expect(sql(`SELECT count(*) FROM amendment_candidates WHERE tenant_id='${t1.user.tenantId}';`)).toBe(before);
    expect(await lawNotes(t1.token)).toHaveLength(3);
  });

  it('근거 문구를 함께 보내며 확정해도(판을 잡는 갈래) 같은 함수로 만든다', async () => {
    const res = await api(`/law-links/${link.e}`, { method: 'PATCH', token: t1.token, json: { confirmState: 'confirmed', evidenceText: '연차 유급휴가' } });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(candidates(t1.user.tenantId, art.e)).toEqual([ev.s]);
  });

  it('확정 때 만든 미처리 변경은 나중에 동기화 끝 처리가 그 조문을 건너뛴다 — 후보·알림이 겹치지 않고 처리 표시는 찍힌다', async () => {
    // 본문은 여러 줄이라 건수와 첫 줄을 따로 읽는다
    const pendingNotes = (what: string) => sql(`SELECT ${what} FROM user_notifications WHERE tenant_id='${t1.user.tenantId}' AND link LIKE '%change=${ev.pending}';`);
    expect(pendingNotes('count(*)')).toBe('0');
    // 이 법령만 돌린다(lawId — 차례에 기대지 않는다, T-153 ⑤) — 가짜 법령이라 확인은 실패하지만 끝의 자동 생성은 돈다
    const run = await api('/platform-admin/law-sync/run', { method: 'POST', token: platformToken, json: { lawId } });
    expect(run.status, JSON.stringify(run.body)).toBeLessThan(300);
    expect(run.body.results.map((r: { lawId: string }) => r.lawId)).toEqual([lawId]); // 이 법령만 돌았다
    expect(sql(`SELECT amendments_processed_at IS NOT NULL FROM law_change_events WHERE id='${ev.pending}';`)).toBe('t');
    // X 는 확정 때 이미 만들었으니 다시 만들지 않는다. 같은 조에 미리 걸려 있던 Y 만 이번에 만들고 알린다(변경마다 1건)
    expect(candidates(t1.user.tenantId, art.x).filter((e) => e === ev.pending)).toHaveLength(1);
    expect(candidates(t1.user.tenantId, art.y).filter((e) => e === ev.pending)).toHaveLength(1); // Y 의 창 밖 변경 후보는 앞 시험의 '개정 후보 만들기' 몫
    expect(pendingNotes('count(*)')).toBe('1');
    expect(pendingNotes("split_part(body, E'\\n', 1)")).toBe('우리 조문 1곳에 개정 후보를 만들었습니다.');
  });
});
