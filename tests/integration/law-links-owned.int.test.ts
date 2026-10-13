import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execSync } from 'child_process';
import { randomUUID } from 'crypto';
import { api, createTenant, createPolicyWithArticle, waitForApi } from './helpers';

/**
 * 법령 관계 정보의 목록·수정·삭제도 조문의 실제 소속을 본다 (T-148 ②).
 *
 * 연결은 tenantId 를 따로 들고 있어서, 회사 1 이름으로 회사 2 조문을 가리키는 잘못된 행은 연결의 회사만 보면
 * 회사 1 것으로 잡힌다(T-41 의 사고 모양). 법령조항별 목록은 조문 제목·번호를 돌려주므로 그런 행이 있으면
 * 다른 회사 조문이 우리 목록에 보인다. 정상 경로로는 생기지 않는 행이라 DB 에 직접 심는다.
 */

function sql(query: string): string {
  return execSync(
    `docker compose exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -t -A -v ON_ERROR_STOP=1 -f -'`,
    { encoding: 'utf8', input: query },
  ).trim();
}

describe('T-148 법령 관계 정보는 조문의 실제 소속까지 본다', () => {
  const sourceId = randomUUID();
  const lawId = randomUUID();
  const jo = randomUUID();
  const badId = randomUUID();
  let t1: Awaited<ReturnType<typeof createTenant>>;
  let t2: Awaited<ReturnType<typeof createTenant>>;
  let mine = { linkId: '', articleId: '' };
  let theirs = { linkId: '', articleId: '' };

  const link = async (token: string, articleId: string) => {
    const res = await api('/law-links', {
      method: 'POST',
      token,
      json: { lawArticleId: jo, articleId, relationType: 'citation', evidenceText: '연차 유급휴가' },
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return { linkId: res.body.id as string, articleId };
  };
  const badRow = () => sql(`SELECT confirm_state || '|' || relation_type FROM law_links WHERE id='${badId}';`);

  beforeAll(async () => {
    await waitForApi();
    t1 = await createTenant('owned-1');
    t2 = await createTenant('owned-2');
    // 확인 시각을 지금으로 둬 법령 동기화 시험이 이 가짜 법령을 먼저 고르지 않게 한다
    sql(`
      INSERT INTO law_sources (id, code, name, base_url, updated_at) VALUES ('${sourceId}', 'it-${sourceId.slice(0, 8)}', '통합테스트', 'http://example.test', now());
      INSERT INTO laws (id, source_id, external_id, external_law_id, law_name, last_checked_at, updated_at)
        VALUES ('${lawId}', '${sourceId}', '900248', '990248', '소속확인시험법', now(), now());
      INSERT INTO law_articles (id, law_id, node_key, article_no, clause_no, item_no, label, content, version_key, sort_order, updated_at)
        VALUES ('${jo}', '${lawId}', '60//', 60, NULL, NULL, '제60조', '연차 유급휴가', 'v1:jo60', 1, now());
    `);
    const a = await createPolicyWithArticle(t1.token, `OWN-${Date.now().toString(36)}`, '회사 1 규정');
    const w = await createPolicyWithArticle(t2.token, `OWN2-${Date.now().toString(36)}`, '회사 2 규정');
    mine = await link(t1.token, a.article.id);
    theirs = await link(t2.token, w.article.id);
    sql(`
      INSERT INTO law_links (id, tenant_id, law_article_id, article_id, relation_type, confirm_state, updated_at)
        VALUES ('${badId}', '${t1.user.tenantId}', '${jo}', '${w.article.id}', 'citation', 'confirmed', now());
    `);
  }, 120_000);

  afterAll(() => {
    // 법령을 지우면 조항과 그 조항의 연결이 함께 지워진다
    sql(`DELETE FROM laws WHERE id='${lawId}'; DELETE FROM law_sources WHERE id='${sourceId}';`);
  });

  it('법령조항별 목록에 다른 회사 조문을 가리키는 행이 보이지 않는다', async () => {
    const res = await api(`/law-links?lawArticleId=${jo}`, { token: t1.token });
    expect(res.status).toBe(200);
    expect(res.body.map((l: { id: string }) => l.id)).toEqual([mine.linkId]);
    expect(JSON.stringify(res.body)).not.toContain(theirs.articleId);
    // 회사 2 목록에는 자기 연결만 — 잘못된 행은 회사 1 이름이라 회사 2 쪽에도 잡히지 않는다
    const other = await api(`/law-links?lawArticleId=${jo}`, { token: t2.token });
    expect(other.body.map((l: { id: string }) => l.id)).toEqual([theirs.linkId]);
  });

  it('그런 행은 수정할 수 없다 — "없음"과 같은 404, 행은 그대로', async () => {
    const res = await api(`/law-links/${badId}`, { method: 'PATCH', token: t1.token, json: { confirmState: 'rejected' } });
    expect(res.status, JSON.stringify(res.body)).toBe(404);
    expect(badRow()).toBe('confirmed|citation');
    // 우리 조문에 건 연결은 그대로 고칠 수 있다
    const ok = await api(`/law-links/${mine.linkId}`, { method: 'PATCH', token: t1.token, json: { evidenceText: '연차 휴가' } });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
  });

  it('그런 행은 지울 수 없다 — 404, 행은 남는다', async () => {
    const res = await api(`/law-links/${badId}`, { method: 'DELETE', token: t1.token });
    expect(res.status, JSON.stringify(res.body)).toBe(404);
    expect(badRow()).toBe('confirmed|citation');
    // 다른 회사의 정상 연결도 지울 수 없다(기존 경계)
    expect((await api(`/law-links/${theirs.linkId}`, { method: 'DELETE', token: t1.token })).status).toBe(404);
  });
});
