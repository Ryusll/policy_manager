import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execSync } from 'child_process';
import { randomUUID } from 'crypto';
import { api, createTenant, createPolicyWithArticle, waitForApi } from './helpers';

/**
 * T-124 법령에서 사라진 조항의 연결 보존.
 *
 * 전부개정 같은 구조 변경으로 조항이 법제처 응답에서 사라지면, 예전에는 조항 행을 지웠다. 그러면 회사들이
 * 걸어 둔 연결(LawLink)이 cascade 로 함께 지워져, 그 "삭제됨" 이벤트의 영향 분석(T-105)·개정 후보(T-106)에서
 * 그 조항에 걸려 있던 사내 조문을 찾을 수 없었다. 이제는 지우지 않고 "삭제됨"으로 표시한다.
 *
 * 실제 법제처 응답에는 없는 가짜 조항(제9999조)을 등록된 법령에 몰래 넣고 연결을 건 뒤, 동기화가 그 법령을
 * 다시 받게 만들어 "조항이 사라진 개정"을 재현한다. 법제처 호출이 필요해 인증값이 있을 때만 돈다(T-104 와 같다).
 */
function sql(query: string): string {
  return execSync(
    `docker compose exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -t -A -v ON_ERROR_STOP=1 -f -'`,
    { encoding: 'utf8', input: query },
  ).trim();
}

describe('T-124 법령에서 사라진 조항 — 연결을 남긴다', () => {
  let platform: Awaited<ReturnType<typeof createTenant>>;
  let lawGoKrReady = false;
  let lawId = '';
  let createdByTest = false;
  const ghostId = randomUUID();
  let articleId = '';
  let otherArticleId = '';
  let linkId = '';
  let countBefore = 0;

  /** 저장된 MST 를 옛 번호로 돌려 "새 판이 났다"고 보게 하고, 이 법령만 맨 앞에 세워 limit 1 로 돌린다 */
  const syncAsNewEdition = async () => {
    sql(`UPDATE laws SET external_id='1', last_checked_at = NULL WHERE id='${lawId}';`);
    const res = await api('/platform-admin/law-sync/run', { method: 'POST', token: platform.token, json: { limit: 1 } });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.results[0].lawId).toBe(lawId);
    return res.body;
  };

  beforeAll(async () => {
    await waitForApi();
    platform = await createTenant('law-ghost');
    sql(`UPDATE users SET platform_role='global_admin' WHERE id='${platform.user.id}';`);
    const status = await api('/lawgokr/status', { token: platform.token });
    lawGoKrReady = status.status === 200 && status.body?.configured === true;
    if (!lawGoKrReady) return;

    const found = await api('/lawgokr/search?q=%EA%B7%BC%EB%A1%9C%EA%B8%B0%EC%A4%80%EB%B2%95&display=1', {
      token: platform.token,
    });
    const mst = found.body.items[0].mst;
    const before = await api('/laws', { token: platform.token });
    createdByTest = !before.body.some((l: any) => l.externalId === mst);
    const reg = await api('/laws', { method: 'POST', token: platform.token, json: { mst } });
    expect(reg.status).toBe(200);
    lawId = reg.body.id;
    countBefore = (await api(`/laws/${lawId}`, { token: platform.token })).body.articleCount;

    // 법제처 응답에 없는 조항을 몰래 넣어 둔다 — 다음 동기화에서 "사라진 조항"이 된다
    sql(`INSERT INTO law_articles (id, law_id, node_key, article_no, label, title, content, version_key, sort_order, created_at, updated_at)
         VALUES ('${ghostId}', '${lawId}', '9999//', 9999, '제9999조', '시험 조항', '시험용으로 넣은 조항이다.', 'v1:t124', 999999, now(), now());`);

    const set = await createPolicyWithArticle(platform.token, `LG-${Date.now().toString(36)}`);
    articleId = set.article.id;
    const other = await api(`/policies/${set.policy.id}/chapters/${set.chapter.id}/articles`, {
      method: 'POST',
      token: platform.token,
      json: { number: 2, title: '다른 조문', content: '새 연결 시험용 조문이다.' },
    });
    otherArticleId = other.body.id;
    const link = await api('/law-links', {
      method: 'POST',
      token: platform.token,
      json: { lawArticleId: ghostId, articleId, relationType: 'citation' },
    });
    expect(link.status, JSON.stringify(link.body)).toBe(201);
    linkId = link.body.id;
  }, 180_000);

  afterAll(async () => {
    if (!lawId) return;
    // 가짜 조항은 반드시 지운다 — 남으면 다른 동기화 테스트의 이벤트 수가 달라진다(연결은 cascade)
    sql(`DELETE FROM law_articles WHERE id='${ghostId}';`);
    if (createdByTest) await api(`/laws/${lawId}`, { method: 'DELETE', token: platform.token });
  });

  it('사라진 조항은 지우지 않고 "삭제됨"으로 남고, 걸어 둔 연결과 이벤트의 조항이 이어진다', async ({ skip }) => {
    if (!lawGoKrReady) return skip();
    const run = await syncAsNewEdition();
    expect(run.status).toBe('succeeded');
    expect(run.results[0]).toMatchObject({ outcome: 'updated', events: 1 });

    expect(sql(`SELECT (deleted_at IS NOT NULL)::text FROM law_articles WHERE id='${ghostId}';`)).toBe('true');
    expect(sql(`SELECT change_type FROM law_change_events WHERE law_article_id='${ghostId}';`)).toBe('deleted');

    const links = await api(`/law-links?articleId=${articleId}`, { token: platform.token });
    const kept = links.body.find((l: any) => l.id === linkId);
    expect(kept, '연결이 지워졌다').toBeTruthy();
    expect(kept.lawArticle.deletedAt).toBeTruthy();
  }, 120_000);

  it('그 "삭제됨" 이벤트의 영향 분석이 연결된 사내 조문을 찾는다', async ({ skip }) => {
    if (!lawGoKrReady) return skip();
    const eventId = sql(`SELECT id FROM law_change_events WHERE law_article_id='${ghostId}';`);
    const { status, body } = await api(`/law-changes/${eventId}/impact`, { token: platform.token });
    expect(status).toBe(200);
    expect(body.unresolvable ?? null).toBeNull();
    expect(body.impacted.map((i: any) => i.article.id)).toContain(articleId);
  });

  it('조항 목록·건수에서는 빠지고, 새로 연결할 수 없다', async ({ skip }) => {
    if (!lawGoKrReady) return skip();
    const list = await api(`/laws/${lawId}/articles`, { token: platform.token });
    expect(list.body.some((a: any) => a.id === ghostId)).toBe(false);
    expect((await api(`/laws/${lawId}`, { token: platform.token })).body.articleCount).toBe(countBefore);

    const again = await api('/law-links', {
      method: 'POST',
      token: platform.token,
      json: { lawArticleId: ghostId, articleId: otherArticleId, relationType: 'citation' },
    });
    expect(again.status).toBe(409);
  });

  it('다음 동기화에서 "삭제됨" 이벤트를 되풀이하지 않는다', async ({ skip }) => {
    if (!lawGoKrReady) return skip();
    const run = await syncAsNewEdition();
    expect(run.status).toBe('succeeded');
    expect(sql(`SELECT count(*) FROM law_change_events WHERE law_article_id='${ghostId}';`)).toBe('1');
    expect(sql(`SELECT (deleted_at IS NOT NULL)::text FROM law_articles WHERE id='${ghostId}';`)).toBe('true');
  }, 120_000);
});
