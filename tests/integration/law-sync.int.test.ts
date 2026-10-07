import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execSync } from 'child_process';
import { randomUUID } from 'crypto';
import { api, createTenant, createPolicyWithArticle, waitForApi } from './helpers';

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
 * 법제처 호출이 필요한 부분은 인증값이 있을 때만 돈다(T-100 테스트와 같은 방식).
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

  describe('법제처 동기화 (인증값이 있을 때만)', () => {
    let lawId = '';
    let currentMst = '';
    let createdByTest = false;
    let linkId = '';
    let linkedLawArticleId = '';

    /** 이 법령만 맨 앞에 세워 limit 1 로 확인한다 — 다른 테스트의 법령을 건드리지 않게 */
    const runOne = async () => {
      sql(`UPDATE laws SET last_checked_at = NULL WHERE id='${lawId}';`);
      const res = await api('/platform-admin/law-sync/run', {
        method: 'POST', token: platform.token, json: { limit: 1 },
      });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body.results[0].lawId).toBe(lawId);
      return res.body;
    };

    beforeAll(async () => {
      if (!lawGoKrReady) return;
      const found = await api('/lawgokr/search?q=%EA%B7%BC%EB%A1%9C%EA%B8%B0%EC%A4%80%EB%B2%95&display=1', {
        token: platform.token,
      });
      currentMst = found.body.items[0].mst;
      const before = await api('/laws', { token: platform.token });
      createdByTest = !before.body.some((l: any) => l.externalId === currentMst);
      const reg = await api('/laws', { method: 'POST', token: platform.token, json: { mst: currentMst } });
      expect(reg.status).toBe(200);
      lawId = reg.body.id;
    }, 120_000);

    afterAll(async () => {
      if (!lawId) return;
      if (linkId) await api(`/law-links/${linkId}`, { method: 'DELETE', token: platform.token });
      // 깨뜨려 둔 값이 남지 않게 되돌린다
      sql(`UPDATE laws SET external_law_id = coalesce(external_law_id, '001872') WHERE id='${lawId}';`);
      if (createdByTest) await api(`/laws/${lawId}`, { method: 'DELETE', token: platform.token });
    });

    it('새 판이 없으면 unchanged — 이벤트를 만들지 않고 확인 시각만 남긴다', async ({ skip }) => {
      if (!lawGoKrReady) return skip();
      const run = await runOne();
      expect(run.status).toBe('succeeded');
      expect(run.results[0]).toMatchObject({ outcome: 'unchanged', fromMst: currentMst });
      expect(run.eventCount).toBe(0);
      const law = await api(`/laws/${lawId}`, { token: platform.token });
      expect(law.body.lastCheckError).toBeNull();
      expect(Date.now() - new Date(law.body.lastCheckedAt).getTime()).toBeLessThan(60_000);
    }, 60_000);

    it('새 판이 나면 같은 법령 행을 갈아끼우고, 달라진 조항만 poll 이벤트로 남긴다 — 걸어 둔 연결은 그대로', async ({ skip }) => {
      if (!lawGoKrReady) return skip();

      // 회사가 이 법의 한 조항에 사내 조문을 걸어 둔다
      const articles = await api(`/laws/${lawId}/articles`, { token: platform.token });
      const target = articles.body[1];
      linkedLawArticleId = target.id;
      const { article } = await createPolicyWithArticle(platform.token, `LS-${Date.now().toString(36)}`);
      const link = await api('/law-links', {
        method: 'POST', token: platform.token,
        json: { lawArticleId: target.id, articleId: article.id, relationType: 'citation' },
      });
      expect(link.status, JSON.stringify(link.body)).toBe(201);
      linkId = link.body.id;

      // "옛 판을 들고 있다"를 만든다: 저장된 MST 를 옛 번호로, 그 조항 본문을 옛 문구로
      sql(`UPDATE laws SET external_id='1' WHERE id='${lawId}';
           UPDATE law_articles SET content = content || ' (옛 판 문구)', version_key = 'v1:old' WHERE id='${target.id}';`);

      const run = await runOne();
      expect(run.results[0]).toMatchObject({ outcome: 'updated', fromMst: '1', toMst: currentMst, events: 1 });
      expect(run.changedCount).toBe(1);

      // 같은 행이 새 MST 를 가진다 — 별도 법령이 생기지 않았다
      expect(sql(`SELECT external_id FROM laws WHERE id='${lawId}';`)).toBe(currentMst);
      expect(sql(`SELECT count(*) FROM laws WHERE external_id='${currentMst}';`)).toBe('1');

      // 그 조항 하나만 modified · poll 로 남았고, 옛 문구가 "이전 본문"이다
      const ev = sql(`SELECT change_type || '|' || received_via || '|' || right(before_content, 8)
                      FROM law_change_events WHERE law_article_id='${target.id}' ORDER BY detected_at DESC LIMIT 1;`);
      expect(ev).toBe('modified|poll|(옛 판 문구)');

      // 조항 id 가 유지돼 연결이 살아 있다
      const links = await api(`/law-links?articleId=${article.id}`, { token: platform.token });
      expect(links.body.some((l: any) => l.id === linkId && l.lawArticleId === linkedLawArticleId)).toBe(true);
    }, 90_000);

    it('확인하지 못하면 failed 로 남겨 "개정 없음"과 구별한다', async ({ skip }) => {
      if (!lawGoKrReady) return skip();
      sql(`UPDATE laws SET external_law_id = NULL WHERE id='${lawId}';`);
      try {
        const run = await runOne();
        expect(run.status).toBe('failed');
        expect(run.failedCount).toBe(1);
        expect(run.results[0].outcome).toBe('failed');
        expect(run.results[0].error).toContain('법령ID');

        const law = await api(`/laws/${lawId}`, { token: platform.token });
        expect(law.body.lastCheckError).toContain('법령ID');

        const runs = await api('/platform-admin/law-sync/runs?limit=1', { token: platform.token });
        expect(runs.body[0].id).toBe(run.id);
      } finally {
        sql(`UPDATE laws SET external_law_id='001872' WHERE id='${lawId}';`);
      }
    }, 60_000);

    it('cron 용 CLI — 실패가 있으면 종료 코드 1, 모두 성공이면 0', async ({ skip }) => {
      if (!lawGoKrReady) return skip();
      sql(`UPDATE laws SET external_law_id = NULL, last_checked_at = NULL WHERE id='${lawId}';`);
      let failed: { code: number; out: string };
      try {
        failed = cli('--limit 1');
      } finally {
        sql(`UPDATE laws SET external_law_id='001872' WHERE id='${lawId}';`);
      }
      expect(failed.code, failed.out).toBe(1);
      expect(failed.out).toContain('실패');

      sql(`UPDATE laws SET last_checked_at = NULL WHERE id='${lawId}';`);
      const ok = cli('--limit 1');
      expect(ok.code, ok.out).toBe(0);
      expect(ok.out).toContain('succeeded');

      const runs = await api('/platform-admin/law-sync/runs?limit=1', { token: platform.token });
      expect(runs.body[0].trigger).toBe('schedule');
    }, 120_000);
  });
});
