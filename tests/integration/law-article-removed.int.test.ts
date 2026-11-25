import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execSync } from 'child_process';
import { api, createTenant, createPolicyWithArticle, waitForApi } from './helpers';
import { FakeLaw, requireRedis, type FakeVersion } from './lawgokr-seed';

/**
 * T-124 법령에서 사라진 조항의 연결 보존.
 *
 * 전부개정 같은 구조 변경으로 조항이 법제처 응답에서 사라지면, 예전에는 조항 행을 지웠다. 그러면 회사들이
 * 걸어 둔 연결(LawLink)이 cascade 로 함께 지워져, 그 "삭제됨" 이벤트의 영향 분석(T-105)·개정 후보(T-106)에서
 * 그 조항에 걸려 있던 사내 조문을 찾을 수 없었다. 이제는 지우지 않고 "삭제됨"으로 표시한다.
 *
 * 가짜 법제처(lawgokr-seed — 캐시에 응답을 심는다)로 "제9999조가 있는 판 → 그 조가 없는 다음 판"을 만들어 재현한다.
 * 법제처 인증값 없이 돈다. (T-151 전에는 실제 법령에 가짜 조항을 몰래 넣고 저장 MST 를 '1' 로 돌려 새 판을 흉내 냈는데,
 * 이제 동기화는 판 목록에서 저장 판의 자리를 찾아 그 뒤 판만 반영하므로 그 흉내가 통하지 않는다.)
 */
function sql(query: string): string {
  return execSync(
    `docker compose exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -t -A -v ON_ERROR_STOP=1 -f -'`,
    { encoding: 'utf8', input: query },
  ).trim();
}

const art = (no: string, title: string, body: string) => ({ no, title, body });

describe('T-124 법령에서 사라진 조항 — 연결을 남긴다', () => {
  let platform: Awaited<ReturnType<typeof createTenant>>;
  let lawId = '';
  let ghostId = '';
  let articleId = '';
  let otherArticleId = '';
  let linkId = '';
  let countAfter = 0;

  const law = new FakeLaw('조항삭제시험법');
  const A: FakeVersion = { mst: law.mst(1), promulgated: '20260110', promulgationNo: '901', effective: '20260201', articles: [art('1', '목적', '목적 본문'), art('2', '정의', '정의 본문'), art('9999', '시험 조항', '시험용 조항이다.')] };
  // 다음 판에서 제9999조가 사라진다
  const B: FakeVersion = { mst: law.mst(2), promulgated: '20260310', promulgationNo: '902', effective: '20260401', articles: [art('1', '목적', '목적 본문'), art('2', '정의', '정의 본문')] };
  // 그다음 판 — 제1조만 바뀐다. 이미 사라진 조항의 "삭제됨" 이벤트를 되풀이하면 안 된다
  const C: FakeVersion = { mst: law.mst(3), promulgated: '20260510', promulgationNo: '903', effective: '20260601', articles: [art('1', '목적', '바뀐 목적 본문'), art('2', '정의', '정의 본문')] };

  /** 이 법령만 돈다 */
  const sync = async () => {
    const res = await api('/platform-admin/law-sync/run', { method: 'POST', token: platform.token, json: { lawId } });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.results[0].lawId).toBe(lawId);
    return res.body;
  };

  beforeAll(async () => {
    await waitForApi();
    platform = await createTenant('law-ghost');
    sql(`UPDATE users SET platform_role='global_admin' WHERE id='${platform.user.id}';`);
    requireRedis();

    // 지금 법제처에는 B 까지 있다 — 등록은 A(저장 판)로
    law.seedAll([A, B]);
    const reg = await api('/laws', { method: 'POST', token: platform.token, json: { mst: A.mst } });
    expect(reg.status, JSON.stringify(reg.body)).toBe(200);
    lawId = reg.body.id;
    ghostId = sql(`SELECT id FROM law_articles WHERE law_id='${lawId}' AND node_key='9999//';`);
    countAfter = (await api(`/laws/${lawId}`, { token: platform.token })).body.articleCount - 1;

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

  it('사라진 조항은 지우지 않고 "삭제됨"으로 남고, 걸어 둔 연결과 이벤트의 조항이 이어진다', async () => {
    const run = await sync();
    expect(run.status).toBe('succeeded');
    expect(run.results[0]).toMatchObject({ outcome: 'updated', toMst: B.mst, events: 1 });

    expect(sql(`SELECT (deleted_at IS NOT NULL)::text FROM law_articles WHERE id='${ghostId}';`)).toBe('true');
    expect(sql(`SELECT change_type FROM law_change_events WHERE law_article_id='${ghostId}';`)).toBe('deleted');

    const links = await api(`/law-links?articleId=${articleId}`, { token: platform.token });
    const kept = links.body.find((l: any) => l.id === linkId);
    expect(kept, '연결이 지워졌다').toBeTruthy();
    expect(kept.lawArticle.deletedAt).toBeTruthy();
  }, 120_000);

  it('그 "삭제됨" 이벤트의 영향 분석이 연결된 사내 조문을 찾는다', async () => {
    const eventId = sql(`SELECT id FROM law_change_events WHERE law_article_id='${ghostId}';`);
    const { status, body } = await api(`/law-changes/${eventId}/impact`, { token: platform.token });
    expect(status).toBe(200);
    expect(body.unresolvable ?? null).toBeNull();
    expect(body.impacted.map((i: any) => i.article.id)).toContain(articleId);
  });

  it('조항 목록·건수에서는 빠지고, 새로 연결할 수 없다', async () => {
    const list = await api(`/laws/${lawId}/articles`, { token: platform.token });
    expect(list.body.some((a: any) => a.id === ghostId)).toBe(false);
    expect((await api(`/laws/${lawId}`, { token: platform.token })).body.articleCount).toBe(countAfter);

    const again = await api('/law-links', {
      method: 'POST',
      token: platform.token,
      json: { lawArticleId: ghostId, articleId: otherArticleId, relationType: 'citation' },
    });
    expect(again.status).toBe(409);
  });

  it('다음 판에서 "삭제됨" 이벤트를 되풀이하지 않는다', async () => {
    law.seedAll([A, B, C]);
    const run = await sync();
    expect(run.status).toBe('succeeded');
    expect(run.results[0]).toMatchObject({ outcome: 'updated', toMst: C.mst, events: 1 }); // 제1조 하나뿐
    expect(sql(`SELECT count(*) FROM law_change_events WHERE law_article_id='${ghostId}';`)).toBe('1');
    expect(sql(`SELECT (deleted_at IS NOT NULL)::text FROM law_articles WHERE id='${ghostId}';`)).toBe('true');
  }, 120_000);
});
