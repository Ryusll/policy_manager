import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn } from 'child_process';
import { randomUUID } from 'crypto';
import { api, createTenant, waitForApi } from './helpers';
import { brief, sql, waitForBlockedBy } from './race';

/**
 * T-180 (PAT-22 — 특허 도 13 문단 466~467) 시점 조회 일관성. 한 요청이 규정 전문(비교라면 두 쪽·두 규정)을 만드는 모든 읽기는 같은 발행
 * 이력 상태 하나로 — 조회 중 다른 커밋이 끼어도 한 전문에 섞이지 않는다.
 *
 * 끼워 넣는 법(결정적): 쓰기 세션이 판 표(article_versions)를 ACCESS EXCLUSIVE 로 잠근 채 같은 트랜잭션에서 조문 행(제목)과 판(본문)을 함께
 * 바꾸고, 시험이 풀어 줄 때까지(advisory lock 문지기) 커밋하지 않는다(재파싱 묶음 승인처럼 계층과 판을 한 커밋에 바꾸는 쓰기). 읽기는
 * 규정·장·조문 행을 읽고 판 문장에서 막힌다. 쓰기가 커밋하면
 * - READ COMMITTED(문장마다 스냅숏): 제목은 커밋 전, 본문은 커밋 뒤 — 어느 순간에도 없던 조합이 나온다
 * - 한 스냅숏(읽기 전용 REPEATABLE READ): 첫 조회 때의 상태로 끝까지 — 옛 제목·옛 본문
 */
describe('T-180 시점 조회는 한 발행 이력 상태로', () => {
  let t: Awaited<ReturnType<typeof createTenant>>;
  const get = (path: string) => api(path, { token: t.token });
  const post = (path: string, json?: unknown) => api(path, { method: 'POST', token: t.token, json });

  /** 규정 하나·장 하나·조문 하나(2020-01-01 시행본, 제목·본문 '옛 …') — 조문·판 id */
  const seedPolicy = async (code: string) => {
    const pol = await post('/policies', { code, title: `일관성${code}` });
    expect(pol.status, JSON.stringify(pol.body)).toBeLessThan(300);
    const ch = await post(`/policies/${pol.body.id}/chapters`, { number: 1, title: '총칙' });
    expect(ch.status, JSON.stringify(ch.body)).toBeLessThan(300);
    const art = await post(`/policies/${pol.body.id}/chapters/${ch.body.id}/articles`, { number: 1, title: '옛 제목', content: '옛 본문' });
    expect(art.status, JSON.stringify(art.body)).toBeLessThan(300);
    expect((await post(`/policies/${pol.body.id}/publish-drafts`, { changeNote: '제정', effectiveDate: '2020-01-01' })).status).toBeLessThan(300);
    const versionId = sql(`SELECT id FROM article_versions WHERE article_id = '${art.body.id}';`);
    return { policyId: pol.body.id as string, articleId: art.body.id as string, versionId };
  };

  /** psql 한 세션을 뒤에서 돌린다 — 끝난 종료 코드를 돌려주는 약속 */
  const psqlInBackground = (statements: string) => {
    const p = spawn(
      'docker',
      ['compose', 'exec', '-T', 'postgres', 'sh', '-c', `psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -q -v ON_ERROR_STOP=1 -c "${statements}"`],
      { stdio: 'ignore' },
    );
    return new Promise<number | null>((resolve) => p.on('exit', resolve));
  };
  const count = (statement: string) => Number(sql(statement));
  const until = async (what: string, check: () => boolean) => {
    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 100));
      if (check()) return;
    }
    throw new Error(what);
  };
  /**
   * 표 하나를 잠근 채 SQL 을 실행하고, 시험이 풀어 줄 때까지 커밋하지 않는 쓰기 세션. 시간(pg_sleep)에 기대면 부하 때 확인이 끝나기 전에
   * 커밋돼 버린다 — 문지기 세션이 advisory lock 을 쥐고, 쓰기는 커밋 직전에 그것을 기다린다. `release()` 가 문지기를 끝내면 커밋한다.
   * 표를 통째로 잠그니 공용 DB 의 다른 요청이 그동안 기다린다 — 쓰기는 잠금을 5초 안에 못 잡으면 포기하고(줄 서서 남을 막지 않게),
   * 준비가 어긋나면 바로 풀며, 시험이 중간에 실패해도 문지기는 20초 뒤 스스로 끝난다(afterAll 도 남은 문지기를 끝낸다)
   */
  const hold = async (name: string, table: string, statements: string) => {
    const key = 180_000_000 + Math.floor(Math.random() * 1_000_000);
    const release = () => void sql(`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE application_name = 't180g_${name}';`);
    void psqlInBackground(`SET application_name = 't180g_${name}'; SELECT pg_advisory_lock(${key}); SELECT pg_sleep(20);`);
    try {
      await until(`문지기 t180g_${name} 가 잠금을 쥐지 않았다`, () =>
        count(`SELECT count(*) FROM pg_locks l JOIN pg_stat_activity a ON a.pid = l.pid WHERE a.application_name = 't180g_${name}' AND l.locktype = 'advisory' AND l.granted;`) > 0);
      const done = psqlInBackground(
        `SET application_name = 't131_${name}'; SET lock_timeout = '5s'; BEGIN; LOCK TABLE ${table} IN ACCESS EXCLUSIVE MODE; SET LOCAL lock_timeout = 0; ${statements} SELECT pg_advisory_lock(${key}); COMMIT;`,
      );
      await until(`쓰기 t131_${name} 가 바꾼 뒤 문지기 앞에 서지 않았다`, () =>
        count(`SELECT count(*) FROM pg_stat_activity WHERE application_name = 't131_${name}' AND wait_event = 'advisory';`) > 0);
      return { done, release };
    } catch (e) {
      release();
      throw e;
    }
  };
  /** 판 표를 잠근 채 조문 제목·판 본문을 함께 바꾼다(재파싱 묶음 승인처럼 계층과 판을 한 커밋에) */
  const holdAndRewrite = (name: string, ...seeds: { articleId: string; versionId: string }[]) =>
    hold(
      name,
      'article_versions',
      seeds
        .map((s) => `UPDATE articles SET title = '새 제목' WHERE id = '${s.articleId}'; UPDATE article_versions SET content = '새 본문' WHERE id = '${s.versionId}';`)
        .join(' '),
    );
  /**
   * 쓰기가 붙잡혀 있는 동안 요청을 보내 그 쓰기에 막힌 것을 확인하고, 쓰기를 풀어 준 뒤 응답을 돌려준다. 막힌 연결 수는 세지 않는다 —
   * 같은 DB 를 쓰는 다른 세션의 요청도 함께 막혀 셈이 흔들린다. 한 스냅숏인지는 내용(커밋 전 상태 그대로인지)으로 본다: READ COMMITTED
   * 연결(문장마다 스냅숏)이 끼면 막혔다 풀린 판 문장이 커밋 뒤 상태를 읽어 "옛 제목 + 새 본문"이 된다. 커밋 전에 잡힌 스냅숏 둘은 내용으로
   * 가를 수 없어 정적 가드(readSnapshot.test — 들어오는 메서드마다 스냅숏 하나, 서로 부르지 않음)가 맡는다
   */
  const readWhileHeld = async (held: Awaited<ReturnType<typeof hold>>, name: string, path: string) => {
    const reading = get(path);
    try {
      await waitForBlockedBy(name);
    } finally {
      held.release();
    }
    const res = await reading;
    expect(await held.done).toBe(0);
    return { res };
  };
  const flat = (o: any) =>
    (o.chapters ?? []).flatMap((c: any) => [...(c.articles ?? []), ...(c.sections ?? []).flatMap((s: any) => s.articles ?? [])]);
  /**
   * 커밋 전 상태 그대로인지. 모두 커밋 뒤 값이면 원인이 둘이다 — 잠금이 일찍 풀렸거나(waitForBlockedBy 는 같은 DB 의 다른 세션 요청이 막혀도
   * 끝난다 — 다시 돌리면 대개 통과), 요청이 스냅숏을 여러 번 열어 뒤쪽이 커밋 뒤에 열렸다(다시 돌려도 같으면 회귀). 어느 쪽이든 실패한다
   */
  const expectBeforeCommit = <T>(got: T, before: T, after: T) => {
    if (JSON.stringify(got) === JSON.stringify(after)) {
      throw new Error(
        `요청이 모두 커밋 뒤 상태를 읽었다(${JSON.stringify(got)}) — 잠금이 일찍 풀렸거나(같은 DB 의 다른 세션 요청이 먼저 막힘 — 다시 돌리면 대개 통과), ` +
          '요청이 스냅숏을 여러 번 열어 뒤쪽이 커밋 뒤에 열렸다(다시 돌려도 같으면 회귀)',
      );
    }
    expect(got).toEqual(before);
  };
  const OLD = { title: '옛 제목', content: '옛 본문' };
  const NEW = { title: '새 제목', content: '새 본문' };

  const cleanups: (() => void)[] = [];

  beforeAll(async () => {
    await waitForApi();
    t = await createTenant('as-of-snapshot');
    // 경로마다 규정을 새로 만든다 — starter 상한(5건)을 넘으므로 시험 회사만 pro 로
    sql(`UPDATE tenants SET plan = 'pro' WHERE slug = '${t.slug}';`);
  }, 90_000);

  afterAll(() => {
    // 실패한 시험이 남긴 문지기가 있으면 끝낸다(붙잡힌 쓰기가 커밋하고 표 잠금이 풀린다)
    sql(`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE application_name LIKE 't180g\\_%';`);
    for (const c of cleanups) c();
  });

  it('시점 조회 — 조문 행과 판 사이에 커밋이 끼어도 옛 제목·옛 본문으로 일관된다 (T-180)', async () => {
    const s = await seedPolicy(`SNAP-A-${Date.now().toString(36)}`);
    // 판 문장이 잠금에 막힌다 — 조문 행은 이미 읽었다
    const { res } = await readWhileHeld(await holdAndRewrite('t180_asof', s), 't180_asof', `/policies/${s.policyId}/as-of?date=2026-01-01`);
    expect(res.status, brief(res)).toBe(200);
    const a = flat(res.body).find((x: any) => x.id === s.articleId);
    expectBeforeCommit({ title: a.title, content: a.versions[0]?.content }, OLD, NEW);
    // 커밋 뒤에 다시 읽으면 새 상태로 일관된다
    const after = flat((await get(`/policies/${s.policyId}/as-of?date=2026-01-01`)).body).find((x: any) => x.id === s.articleId);
    expect({ title: after.title, content: after.versions[0].content }).toEqual({ title: '새 제목', content: '새 본문' });
  }, 60_000);

  it('규정 상세 "현재" — 오늘 판 고르기 전후에 커밋이 끼어도 일관된다 (T-180)', async () => {
    const s = await seedPolicy(`SNAP-C-${Date.now().toString(36)}`);
    const { res } = await readWhileHeld(await holdAndRewrite('t180_cur', s), 't180_cur', `/policies/${s.policyId}`);
    expect(res.status, brief(res)).toBe(200);
    const a = flat(res.body).find((x: any) => x.id === s.articleId);
    expectBeforeCommit({ title: a.title, content: a.versions[0]?.content }, OLD, NEW);
  }, 60_000);

  it('신구조문대비표 — 두 기준일을 한 스냅숏으로 읽어 쪽마다 일관되고 없던 변경이 생기지 않는다 (T-180)', async () => {
    const s = await seedPolicy(`SNAP-D-${Date.now().toString(36)}`);
    // 두 기준일을 다른 연결(다른 스냅숏)에서 읽으면 막혔다 풀린 쪽이 커밋 뒤 본문을 읽는다 — 한 스냅숏이면 두 쪽 모두 옛 상태
    const { res } = await readWhileHeld(await holdAndRewrite('t180_cmp', s), 't180_cmp', `/policies/${s.policyId}/compare?from=2020-06-01&to=2026-01-01`);
    expect(res.status, brief(res)).toBe(200);
    const row = res.body.rows.find((r: any) => r.articleId === s.articleId);
    expectBeforeCommit(
      { before: row.before?.content, after: row.after?.content, title: row.after?.title },
      { before: '옛 본문', after: '옛 본문', title: '옛 제목' },
      { before: '새 본문', after: '새 본문', title: '새 제목' },
    );
  }, 60_000);

  it('규정 간 비교 — 두 규정을 한 스냅숏으로 읽는다 (T-180)', async () => {
    const left = await seedPolicy(`SNAP-L-${Date.now().toString(36)}`);
    const right = await seedPolicy(`SNAP-R-${Date.now().toString(36)}`);
    // 두 규정을 한 커밋에 바꾼다 — 다른 연결이면 그쪽이 "옛 제목 + 새 본문", 스냅숏을 차례로 두 번 열면 "왼쪽 옛 값 + 오른쪽 새 값"
    const { res } = await readWhileHeld(
      await holdAndRewrite('t180_cross', left, right),
      't180_cross',
      `/policies/${left.policyId}/compare-with?targetId=${right.policyId}`,
    );
    expect(res.status, brief(res)).toBe(200);
    const row = res.body.rows.find((r: any) => r.number === 1); // 두 규정 모두 제1조 하나 — 자리로 맞댄다
    const side = (x: any) => ({ title: x?.title, content: x?.content });
    expectBeforeCommit({ left: side(row.left), right: side(row.right) }, { left: OLD, right: OLD }, { left: NEW, right: NEW });
  }, 60_000);

  it('3단비교 — 기준 규정의 조문 행과 판 사이에 커밋이 끼어도 일관된다 (T-180)', async () => {
    const s = await seedPolicy(`SNAP-T-${Date.now().toString(36)}`);
    const { res } = await readWhileHeld(await holdAndRewrite('t180_three', s), 't180_three', `/policies/${s.policyId}/three-way`);
    expect(res.status, brief(res)).toBe(200);
    const row = res.body.rows.find((r: any) => r.base?.id === s.articleId);
    expectBeforeCommit({ title: row.base.title, content: row.base.content }, OLD, NEW);
  }, 60_000);

  it('규정 상세 — 오늘 판을 고른 뒤 시행 예정을 읽기 전에 커밋이 끼어도 시행 예정이 섞이지 않는다(장벽) (T-180)', async () => {
    const s = await seedPolicy(`SNAP-B-${Date.now().toString(36)}`);
    // 오늘 판에 법령 변경 이벤트를 단다 — 다시 읽을 때 법령 변경 표를 읽게(그 표를 잠가 고르기·다시 읽기 뒤, 시행 예정 앞에서 멈춘다)
    const [src, law, ev] = [randomUUID(), randomUUID(), randomUUID()];
    // 정리를 먼저 걸고 시드는 한 트랜잭션으로 — 도중에 실패해도 반쯤 남지 않게
    cleanups.push(() =>
      sql(`UPDATE article_versions SET change_event_id = NULL WHERE change_event_id = '${ev}'; DELETE FROM laws WHERE id = '${law}'; DELETE FROM law_sources WHERE id = '${src}';`),
    );
    sql(`
      BEGIN;
      INSERT INTO law_sources (id, code, name, base_url, updated_at) VALUES ('${src}', 'snap-${src.slice(0, 8)}', '시점시험', 'http://example.test', now());
      INSERT INTO laws (id, source_id, external_id, external_law_id, law_name, effective_date, updated_at)
        VALUES ('${law}', '${src}', '7${Date.now() % 100000}', '77${Date.now() % 100000}', '시점일관성시험법', '2020-01-01', now());
      INSERT INTO law_change_events (id, law_id, node_key, change_type, after_content, after_version_key, law_effective_date, received_via)
        VALUES ('${ev}', '${law}', '1//', 'modified', '시험', 'v1', '2020-01-01', 'poll');
      UPDATE article_versions SET change_event_id = '${ev}' WHERE id = '${s.versionId}';
      COMMIT;
    `);
    // 한 커밋에: 오늘 판을 v2 로 바꾸고(v1 내림) 시행 예정 v3 를 넣는다 — 커밋 전에는 "v1, 시행 예정 없음", 뒤에는 "v2, 시행 예정 v3"
    const [v2, v3] = [randomUUID(), randomUUID()];
    const held = await hold(
      't180_bar',
      'law_change_events',
      `UPDATE article_versions SET status = 'archived' WHERE id = '${s.versionId}'; INSERT INTO article_versions (id, article_id, version_num, content, status, effective_date, published_at, updated_at) VALUES ('${v2}', '${s.articleId}', 2, '오늘 새 본문', 'published', '2021-01-01', now(), now()), ('${v3}', '${s.articleId}', 3, '예정 본문', 'published', '2099-01-01', now(), now());`,
    );
    // 오늘 판을 고르고 다시 읽은 뒤(법령 변경 표에서) 막힌다
    const { res } = await readWhileHeld(held, 't180_bar', `/policies/${s.policyId}`);
    expect(res.status, brief(res)).toBe(200);
    const a = flat(res.body).find((x: any) => x.id === s.articleId);
    expectBeforeCommit({ current: a.versions[0]?.id, scheduled: (a.scheduledVersions ?? []).map((v: any) => v.id) }, { current: s.versionId, scheduled: [] }, { current: v2, scheduled: [v3] });
    // 커밋 뒤에는 새 상태로 일관된다
    const after = flat((await get(`/policies/${s.policyId}`)).body).find((x: any) => x.id === s.articleId);
    expect({ current: after.versions[0]?.id, scheduled: after.scheduledVersions.map((v: any) => v.id) }).toEqual({ current: v2, scheduled: [v3] });
  }, 60_000);
});
