import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn } from 'child_process';
import { randomUUID } from 'crypto';
import { api, createTenant, createPolicyWithArticle, waitForApi } from './helpers';
import { requireRedis, type FakeLaw } from './lawgokr-seed';
import { sleepTrigger, sql, waitForBlockedBy, waitForSleep } from './race';
import { dropLaws, hangulName, registerFakeLaw, seedVersions } from './evidence-seed';

/**
 * T-177 (PAT-08) 근거 문구의 원천 판 — 쓰기 경합(연결 쪽 기본 동작은 law-link-evidence-version.int.test.ts).
 *
 * 막고 싶은 사고:
 * 1. 같은 연결을 동시에 고쳐 근거 문구와 원천이 짝이 어긋난 채 남는다
 * 2. 고를 판이 지워지는 사이에 쓰면 FK 위반 500 이 되거나, 규칙과 다른 원천(없음)을 남긴다
 * 3. 조문을 지우는 사이 그 조문에 연결을 만들면 잠금 순서가 엇갈려 교착(409)한다 — 쓰기는 조문 → 판 → 연결 순서로 잡는다
 * 트리거·멈춘 트랜잭션은 잠금 기다림 한도(3초)보다 짧게(2초) 멈춘다.
 */
describe('T-177 근거 문구 원천 판 — 쓰기 경합', () => {
  let t: Awaited<ReturnType<typeof createTenant>>;
  const lawIds: string[] = [];
  let law: FakeLaw | undefined;
  let la: Record<string, string> = {};
  const A = { X: '', W: '', K: '', S: '', policy: '', chapter: '' };
  let lawName = '';
  const v = Object.fromEntries(['x1', 'x2', 'w1', 'w2', 'w3', 'k1', 's1'].map((k) => [k, randomUUID()]));

  const post = (path: string, json?: unknown) => api(path, { method: 'POST', token: t.token, json });
  const patch = (path: string, json: unknown) => api(path, { method: 'PATCH', token: t.token, json });

  beforeAll(async () => {
    await waitForApi();
    t = await createTenant('evrace');
    requireRedis();
    const reg = await registerFakeLaw(t.token, '근거판경합법', 4);
    law = reg.law;
    lawIds.push(reg.lawId);
    la = reg.la;
    lawName = hangulName('근거판경합');
    sql(`UPDATE laws SET law_name='${lawName}' WHERE id='${reg.lawId}';`);
    const { policy, chapter, article } = await createPolicyWithArticle(t.token, `EVR-${Date.now().toString(36)}`, '취업규칙');
    Object.assign(A, { X: article.id, policy: policy.id, chapter: chapter.id });
    for (const [key, number] of [['W', 2], ['K', 3], ['S', 4]] as const) {
      const res = await post(`/policies/${policy.id}/chapters/${chapter.id}/articles`, { number, title: `조문${number}`, content: '임시' });
      expect(res.status, JSON.stringify(res.body)).toBeLessThan(300);
      A[key] = res.body.id;
    }
    seedVersions(A.X, [
      [v.x1, 1, 'archived', '2020-01-01', '연차휴가는 15일로 한다.'],
      [v.x2, 2, 'published', '2024-01-01', '근로자는 휴가를 쓸 수 있다.'],
    ]);
    // W — 옛 판(w1)과 초안(w3)에 같은 문구, 시행 판(w2)에는 없다: 규칙대로면 번호가 큰 w3, w3 이 지워지면 w1
    seedVersions(A.W, [
      [v.w1, 1, 'archived', '2020-01-01', '옛 판과 초안에 있는 문구다.'],
      [v.w2, 2, 'published', '2024-01-01', '시행 중인 본문이다.'],
      [v.w3, 3, 'draft', null, '시행 중인 본문이다. 옛 판과 초안에 있는 문구다.'],
    ]);
    seedVersions(A.K, [[v.k1, 1, 'published', '2024-01-01', '지울 조문의 본문 문장이다.']]);
    // S — 자동 추천: 본문이 제1조·제2조를 법령조항 id 가 큰 쪽부터 인용한다(넣는 순서를 id 순으로 바로잡는지 보이려고)
    const cited = (['1', '2'] as const).slice().sort((a, b) => (la[a] < la[b] ? 1 : -1));
    seedVersions(A.S, [[v.s1, 1, 'published', '2024-01-01', `이 규정은 ${cited.map((no) => `「${lawName}」 제${no}조`).join('와 ')}에 따른다.`]]);
  }, 90_000);

  afterAll(() => {
    dropLaws(lawIds);
    law?.cleanup();
  });

  it('고치기 경합 — 같은 연결을 동시에 고쳐도 근거 문구와 원천이 짝으로 남는다 (T-177)', async () => {
    const made = await post('/law-links', { lawArticleId: la['1'], articleId: A.X, relationType: 'delegation', evidenceText: '15일로 한다' });
    expect(made.body.evidenceVersionId).toBe(v.x1);
    // 앞 요청(근거 문구 → 원천 x2)이 연결 행을 잡은 채 멈춘 사이, 뒤 요청은 옛 문구를 읽고 같은 문구와 적용 범위를 보낸다
    const drop = sleepTrigger('t177_ev', 'law_links', 'BEFORE', 'UPDATE', `NEW.id = '${made.body.id}' AND NEW.evidence_text = '근로자는 휴가를 쓸 수 있다'`, 2);
    try {
      const first = patch(`/law-links/${made.body.id}`, { evidenceText: '근로자는 휴가를 쓸 수 있다' });
      await waitForSleep('t177_ev');
      const second = patch(`/law-links/${made.body.id}`, { evidenceText: '15일로 한다', scope: '뒤 요청' });
      await waitForBlockedBy('t177_ev');
      const [a, b] = await Promise.all([first, second]);
      expect([a.status, b.status]).toEqual([200, 200]);
      // 마지막에 쓴 뒤 요청이 문구와 원천을 함께 썼다 — 문구만 덮여 원천(x2)이 남지 않는다
      expect(sql(`SELECT evidence_text || '|' || coalesce(evidence_version_id, '-') || '|' || scope FROM law_links WHERE id='${made.body.id}';`)).toBe(
        `15일로 한다|${v.x1}|뒤 요청`,
      );
    } finally {
      drop();
    }
  }, 30_000);

  it('고를 판이 지워지는 사이 쓰면 남은 판들로 규칙대로 고른다 — 500 없이, 지워진 초안 대신 옛 판 (T-177)', async () => {
    // w3 를 지우는 트랜잭션이 잠금을 쥔 채 멈춘 사이 연결을 만든다. 서버는 조문 → 판 순서로 잡다가 w3 에서 기다리고, 지우기가 끝나면 남은
    // 판들(w1·w2)로 고른다 — 고른 뒤에 지워지는 일이 없다
    const del = spawn(
      'docker',
      ['compose', 'exec', '-T', 'postgres', 'sh', '-c', `psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -q -v ON_ERROR_STOP=1 -c "SET application_name = 't131_t177_del'; BEGIN; DELETE FROM article_versions WHERE id = '${v.w3}'; SELECT pg_sleep(2); COMMIT;"`],
      { stdio: 'ignore' },
    );
    const deleted = new Promise<number | null>((resolve) => del.on('exit', resolve));
    await waitForSleep('t177_del');
    const made = post('/law-links', { lawArticleId: la['2'], articleId: A.W, relationType: 'delegation', evidenceText: '옛 판과 초안에 있는 문구' });
    await waitForBlockedBy('t177_del'); // 판을 잡으려다 지우는 쪽에 막혔다 — 겹침이 실제로 일어났다
    const res = await made;
    expect(await deleted).toBe(0);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body).toMatchObject({ evidenceVersionId: v.w1, evidenceFromBody: true });
  }, 30_000);

  it('같은 문구로 고치는 사이 원천 판이 지워지면 원천을 비운다 — 읽어 둔 원천을 그대로 써 500 이 되지 않게 (T-177)', async () => {
    // 앞 시험이 W 에 만든 연결(원천 w1). w1 을 지우는 트랜잭션이 멈춘 사이 같은 문구로 고친다 — 서버가 읽어 둔 원천(w1)은 잡은 판들에 없다
    const linkId = sql(`SELECT id FROM law_links WHERE article_id='${A.W}' AND evidence_version_id='${v.w1}';`);
    expect(linkId).toMatch(/^[0-9a-f-]{36}$/);
    const del = spawn(
      'docker',
      ['compose', 'exec', '-T', 'postgres', 'sh', '-c', `psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -q -v ON_ERROR_STOP=1 -c "SET application_name = 't131_t177_del2'; BEGIN; DELETE FROM article_versions WHERE id = '${v.w1}'; SELECT pg_sleep(2); COMMIT;"`],
      { stdio: 'ignore' },
    );
    const deleted = new Promise<number | null>((resolve) => del.on('exit', resolve));
    await waitForSleep('t177_del2');
    const editing = patch(`/law-links/${linkId}`, { evidenceText: '옛 판과 초안에 있는 문구', scope: '같은 문구' });
    await waitForBlockedBy('t177_del2');
    const res = await editing;
    expect(await deleted).toBe(0);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({ evidenceVersionId: null, evidenceFromBody: true, scope: '같은 문구' });
  }, 30_000);

  it('자동 추천이 쓰는 사이 같은 조합이 따로 생기면 그것만 건너뛰고 나머지는 저장한다 — 묶음 전체가 실패하지 않게 (T-177)', async () => {
    // 추천은 법령조항 id 순으로 넣는다 — 앞 행에서 멈춘 사이 뒤 행과 같은 조합을 다른 요청이 넣는다
    const [first, second] = [la['1'], la['2']].sort();
    const drop = sleepTrigger('t177_sug', 'law_links', 'BEFORE', 'INSERT', `NEW.article_id = '${A.S}' AND NEW.law_article_id = '${first}'`, 2);
    try {
      const suggesting = post('/law-links/suggest', { articleId: A.S });
      await waitForSleep('t177_sug');
      // 추천이 아직 뒤 행을 넣기 전이어야 한다 — 이미 넣었으면(트리거 2초 안에 못 끼어듦) 겹침이 아니라서 여기서 멈춘다
      // SELECT 로 읽는다 — psql 은 INSERT 문장 뒤에 명령 태그를 함께 찍는다
      const inserted = sql(`WITH ins AS (
             INSERT INTO law_links (id, tenant_id, law_article_id, article_id, relation_type, confirm_state, updated_at)
             VALUES ('${randomUUID()}', '${t.user.tenantId}', '${second}', '${A.S}', 'citation', 'confirmed', now())
             ON CONFLICT DO NOTHING RETURNING id)
           SELECT id FROM ins;`);
      expect(inserted, '추천이 멈춘 사이에 같은 조합을 넣지 못했다 — 겹침이 일어나지 않았다').toMatch(/^[0-9a-f-]{36}$/);
      const res = await suggesting;
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      expect(res.body.created.map((l: any) => l.lawArticleId)).toEqual([first]);
      expect(sql(`SELECT count(*) FROM law_links WHERE article_id='${A.S}';`)).toBe('2');
    } finally {
      drop();
    }
  }, 30_000);

  it('조문을 지우는 사이 그 조문에 연결을 만들어도 교착하지 않는다 — 삭제를 기다렸다가 404 (T-177)', async () => {
    // 삭제가 조문을 FOR UPDATE 로 잡고 지우기 직전에 멈춘 사이 연결을 만든다. 쓰기는 조문부터 잡으므로 삭제가 끝나길 기다린다 — 판을 먼저
    // 잡고 FK 확인에서 조문을 기다리면, 삭제가 그 판을 지우려다 서로 기다린다(40P01 → 409)
    const drop = sleepTrigger('t177_artdel', 'articles', 'BEFORE', 'DELETE', `OLD.id = '${A.K}'`, 2);
    try {
      const removing = api(`/policies/${A.policy}/chapters/${A.chapter}/articles/${A.K}`, { method: 'DELETE', token: t.token });
      await waitForSleep('t177_artdel');
      const making = post('/law-links', { lawArticleId: la['3'], articleId: A.K, relationType: 'delegation', evidenceText: '지울 조문의 본문 문장' });
      await waitForBlockedBy('t177_artdel');
      const [removed, made] = await Promise.all([removing, making]);
      expect(removed.status, JSON.stringify(removed.body)).toBeLessThan(300);
      expect(made.status, JSON.stringify(made.body)).toBe(404);
      expect(sql(`SELECT count(*) FROM law_links WHERE article_id='${A.K}';`)).toBe('0');
    } finally {
      drop();
    }
  }, 30_000);
});
