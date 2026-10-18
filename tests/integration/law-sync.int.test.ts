import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execSync } from 'child_process';
import { randomUUID } from 'crypto';
import { api, createTenant, createPolicyWithArticle, waitForApi } from './helpers';
import { FakeLaw, requireRedis, type FakeVersion } from './lawgokr-seed';

/**
 * 법령 주기 동기화 (T-104).
 *
 * 막고 싶은 사고:
 * 1. **개정을 놓친다** — 법제처 MST 는 판마다 새로 매겨지고 한 MST 의 본문은 바뀌지 않는다.
 *    저장된 MST 로 다시 받으면 개정이 영원히 안 보인다.
 * 2. **새 판을 별도 법령으로 만든다** — 그러면 회사들이 걸어 둔 연결(LawLink)이 옛 판에 남는다.
 * 3. **실패를 "개정 없음"으로 삼킨다** — 법제처는 인증·IP 오류도 HTTP 200 으로 준다.
 * 4. 예약 실행과 수동 실행이 겹친다.
 *
 * 동기화 자체는 가짜 법제처(lawgokr-seed — 캐시에 응답을 심는다)로 돈다(T-151). 실제 법제처는 판 목록 계획만 본다 —
 * 인증값이 있을 때만, 아무것도 쓰지 않는다.
 */

function sql(query: string): string {
  return execSync(
    `docker compose exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -t -A -v ON_ERROR_STOP=1 -f -'`,
    { encoding: 'utf8', input: query },
  ).trim();
}

/** 컨테이너 안 CLI 를 돌려 종료 코드와 출력을 받는다 — 서버 cron 이 부르는 것과 같은 경로 */
function cli(args: string): { code: number; out: string } {
  try {
    const out = execSync(`docker compose exec -T api node dist/laws/law-sync.cli.js ${args}`, {
      encoding: 'utf8',
      stdio: 'pipe',
    });
    return { code: 0, out };
  } catch (e: any) {
    return { code: e.status ?? -1, out: `${e.stdout ?? ''}${e.stderr ?? ''}` };
  }
}

const art = (no: string, title: string, body: string) => ({ no, title, body });

describe('T-104 법령 동기화', () => {
  let platform: Awaited<ReturnType<typeof createTenant>>;
  let tenantAdmin: Awaited<ReturnType<typeof createTenant>>;
  let lawGoKrReady = false;

  beforeAll(async () => {
    await waitForApi();
    platform = await createTenant('lawsync-pf');
    tenantAdmin = await createTenant('lawsync-ta');
    sql(`UPDATE users SET platform_role='global_admin' WHERE id='${platform.user.id}';`);
    const status = await api('/lawgokr/status', { token: platform.token });
    lawGoKrReady = status.status === 200 && status.body?.configured === true;
    requireRedis();
  }, 90_000);

  describe('권한 — 법령은 모든 회사가 함께 쓰므로 플랫폼 관리자만', () => {
    it('토큰이 없으면 401', async () => {
      expect((await api('/platform-admin/law-sync/runs')).status).toBe(401);
      expect((await api('/platform-admin/law-sync/run', { method: 'POST', json: {} })).status).toBe(401);
    });

    it('회사 관리자(admin)라도 403', async () => {
      expect((await api('/platform-admin/law-sync/runs', { token: tenantAdmin.token })).status).toBe(403);
      const run = await api('/platform-admin/law-sync/run', { method: 'POST', token: tenantAdmin.token, json: {} });
      expect(run.status).toBe(403);
    });

    it('플랫폼 관리자는 이력을 본다', async () => {
      const { status, body } = await api('/platform-admin/law-sync/runs', { token: platform.token });
      expect(status).toBe(200);
      expect(Array.isArray(body)).toBe(true);
    });

    it('limit 은 1~100 정수', async () => {
      for (const limit of [0, 101, 'abc']) {
        const { status } = await api('/platform-admin/law-sync/run', {
          method: 'POST', token: platform.token, json: { limit },
        });
        expect(status, String(limit)).toBe(400);
      }
    });
  });

  describe('실행이 겹치지 않는다', () => {
    it('진행 중인 실행이 있으면 409, 30분 넘게 끝나지 않은 실행은 "중단됨"으로 닫고 새로 돈다', async () => {
      const stuck = randomUUID();
      sql(`INSERT INTO law_sync_runs (id, trigger, status, started_at) VALUES ('${stuck}', 'manual', 'running', now());`);
      try {
        const blocked = await api('/platform-admin/law-sync/run', {
          method: 'POST', token: platform.token, json: { limit: 1 },
        });
        expect(blocked.status).toBe(409);

        sql(`UPDATE law_sync_runs SET started_at = now() - interval '31 minutes' WHERE id='${stuck}';`);
        const ran = await api('/platform-admin/law-sync/run', {
          method: 'POST', token: platform.token, json: { limit: 1 },
        });
        expect(ran.status).toBe(200);
        expect(ran.body.status).not.toBe('running');
        expect(sql(`SELECT status || '|' || coalesce(error,'') FROM law_sync_runs WHERE id='${stuck}';`)).toMatch(/^failed\|중단됨/);
      } finally {
        sql(`UPDATE law_sync_runs SET status='failed', finished_at=now() WHERE id='${stuck}' AND status='running';`);
      }
    });
  });

  describe('동기화 — 가짜 법제처(캐시 심기, T-151)', () => {
    // T-151 전에는 실제 법제처의 근로기준법으로 돌렸다. 이제 동기화는 판 목록에서 저장 판 뒤에 공포된 판을 따라가므로
    // 실데이터는 날마다 결과가 달라진다(근로기준법은 현행 뒤에 시행 예정 판이 있다). 판을 정해 둔 가짜 법령으로 돈다
    const law = new FakeLaw('동기화시험법');
    const A: FakeVersion = { mst: law.mst(1), promulgated: '20260110', promulgationNo: '111', effective: '20260201', articles: [art('1', '목적', '목적 본문'), art('2', '휴가', '휴가는 15일')] };
    const B: FakeVersion = { mst: law.mst(2), promulgated: '20260310', promulgationNo: '112', effective: '20260401', articles: [art('1', '목적', '목적 본문'), art('2', '휴가', '휴가는 20일')] };
    let lawId = '';
    let linkId = '';
    let linkedLawArticleId = '';

    const runOne = async () => {
      const res = await api('/platform-admin/law-sync/run', { method: 'POST', token: platform.token, json: { lawId } });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body.results[0].lawId).toBe(lawId);
      return res.body;
    };

    beforeAll(async () => {
      law.seedAll([A]); // 지금은 A 뿐
      const reg = await api('/laws', { method: 'POST', token: platform.token, json: { mst: A.mst } });
      expect(reg.status, JSON.stringify(reg.body)).toBe(200);
      lawId = reg.body.id;
    }, 120_000);

    afterAll(() => {
      if (lawId) {
        sql(`
          DELETE FROM amendment_candidates WHERE change_event_id IN (SELECT id FROM law_change_events WHERE law_id='${lawId}');
          DELETE FROM law_links WHERE law_article_id IN (SELECT id FROM law_articles WHERE law_id='${lawId}');
          DELETE FROM laws WHERE id='${lawId}';
        `);
      }
      law.cleanup();
    });

    it('새 판이 없으면 unchanged — 이벤트를 만들지 않고 확인 시각만 남긴다', async () => {
      const run = await runOne();
      expect(run.status).toBe('succeeded');
      expect(run.results[0]).toMatchObject({ outcome: 'unchanged', fromMst: A.mst });
      expect(run.eventCount).toBe(0);
      const got = await api(`/laws/${lawId}`, { token: platform.token });
      expect(got.body.lastCheckError).toBeNull();
      expect(Date.now() - new Date(got.body.lastCheckedAt).getTime()).toBeLessThan(60_000);
    }, 60_000);

    it('새 판이 나면 같은 법령 행을 갈아끼우고, 달라진 조항만 poll 이벤트로 남긴다 — 걸어 둔 연결은 그대로', async () => {
      // 회사가 이 법의 한 조항에 사내 조문을 걸어 둔다
      linkedLawArticleId = sql(`SELECT id FROM law_articles WHERE law_id='${lawId}' AND node_key='2//';`);
      const { article } = await createPolicyWithArticle(platform.token, `LS-${Date.now().toString(36)}`);
      const link = await api('/law-links', {
        method: 'POST', token: platform.token,
        json: { lawArticleId: linkedLawArticleId, articleId: article.id, relationType: 'citation' },
      });
      expect(link.status, JSON.stringify(link.body)).toBe(201);
      linkId = link.body.id;

      law.seedAll([A, B]); // 새 판 B 가 공포됐다
      const run = await runOne();
      expect(run.results[0]).toMatchObject({ outcome: 'updated', fromMst: A.mst, toMst: B.mst, events: 1 });
      expect(run.changedCount).toBe(1);

      // 같은 행이 새 MST 를 가진다 — 별도 법령이 생기지 않았다
      expect(sql(`SELECT external_id FROM laws WHERE id='${lawId}';`)).toBe(B.mst);
      expect(sql(`SELECT count(*) FROM laws WHERE external_id='${B.mst}';`)).toBe('1');

      // 그 조항 하나만 modified · poll 로 남았고, 옛 문구가 "이전 본문"이다
      const ev = sql(`SELECT change_type || '|' || received_via || '|' || before_content
                      FROM law_change_events WHERE law_article_id='${linkedLawArticleId}' ORDER BY detected_at DESC LIMIT 1;`);
      expect(ev).toBe('modified|poll|휴가는 15일');

      // 조항 id 가 유지돼 연결이 살아 있다
      const links = await api(`/law-links?articleId=${article.id}`, { token: platform.token });
      expect(links.body.some((l: any) => l.id === linkId && l.lawArticleId === linkedLawArticleId)).toBe(true);
    }, 90_000);

    // 확인을 실패시키는 방법: 판 목록에서 저장 판(B)을 뺀다 — 사이 판을 확인할 수 없어 반영하지 않는다. (예전에는 법령ID 를 비웠는데,
    // 이제 동기화가 저장 판 본문에서 법령ID 를 채운다 — law-sync-lawid.int.test.ts)
    it('확인하지 못하면 failed 로 남겨 "개정 없음"과 구별한다', async () => {
      law.seedVersionList([A]);
      try {
        const run = await runOne();
        expect(run.status).toBe('failed');
        expect(run.failedCount).toBe(1);
        expect(run.results[0].outcome).toBe('failed');
        expect(run.results[0].error).toContain('판 목록에서 찾지 못했습니다');

        const got = await api(`/laws/${lawId}`, { token: platform.token });
        expect(got.body.lastCheckError).toContain('판 목록에서 찾지 못했습니다');

        const runs = await api('/platform-admin/law-sync/runs?limit=1', { token: platform.token });
        expect(runs.body[0].id).toBe(run.id);
      } finally {
        law.seedVersionList([A, B]);
      }
    }, 60_000);

    it('cron 용 CLI — 실패가 있으면 종료 코드 1, 모두 성공이면 0', async () => {
      law.seedVersionList([A]);
      let failed: { code: number; out: string };
      try {
        failed = cli(`--law ${lawId}`);
      } finally {
        law.seedVersionList([A, B]);
      }
      expect(failed.code, failed.out).toBe(1);
      expect(failed.out).toContain('실패');

      const ok = cli(`--law ${lawId}`);
      expect(ok.code, ok.out).toBe(0);
      expect(ok.out).toContain('succeeded');

      const runs = await api('/platform-admin/law-sync/runs?limit=1', { token: platform.token });
      expect(runs.body[0].trigger).toBe('schedule');
    }, 120_000);
  });

  describe('실제 법제처 판 목록 (인증값이 있을 때만, 아무것도 쓰지 않는다)', () => {
    it('저장 판 뒤의 판을 공포 순으로 계획한다 — 근로기준법 283457(2026-02-19 공포) 다음은 284443(03-17, 타법개정)', ({ skip }) => {
      if (!lawGoKrReady) return skip();
      // 다른 시험·실데이터의 근로기준법 행과 겹치지 않게 시험용 법령원에 옛 판으로 한 행을 둔다(계획만 보고 지운다)
      const sourceId = randomUUID();
      const id = randomUUID();
      sql(`INSERT INTO law_sources (id, code, name, base_url, updated_at) VALUES ('${sourceId}', 'it-${sourceId.slice(0, 8)}', '통합테스트', 'http://example.test', now());
           INSERT INTO laws (id, source_id, external_id, external_law_id, law_name, promulgated_date, updated_at)
             VALUES ('${id}', '${sourceId}', '283457', '001872', '근로기준법', '2026-02-19', now());`);
      try {
        const out = cli(`--plan --law ${id}`);
        expect(out.code, out.out).toBe(0);
        const line = out.out.split('\n').find((l) => l.includes('저장 MST 283457')) ?? '';
        const labels = [...line.matchAll(/제(\d+)호\((\d{4}-\d{2}-\d{2}) 공포\)/g)].map((m) => ({ no: m[1], day: m[2] }));
        expect(labels[0], line).toEqual({ no: '21472', day: '2026-03-17' });
        // 공포 순 — 날짜가 거꾸로 가지 않는다
        for (let i = 1; i < labels.length; i++) expect(labels[i].day >= labels[i - 1].day, line).toBe(true);
        expect(sql(`SELECT external_id FROM laws WHERE id='${id}';`)).toBe('283457');
      } finally {
        sql(`DELETE FROM laws WHERE id='${id}'; DELETE FROM law_sources WHERE id='${sourceId}';`);
      }
    }, 120_000);
  });
});
