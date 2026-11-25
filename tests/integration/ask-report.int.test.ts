import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'crypto';
import { api, createTenant, createPolicyWithArticle, enableAsk, waitForApi } from './helpers';
import { sql } from './race';

/**
 * T-207 규정 질문 답 모양(검토 보고서형)과 T-209 법령 근거.
 *
 * 모의 AI(`AI_QA_PROVIDER=mock`, `apps/api/src/ask/ask-mock-provider.ts`)로 본다 — 실제 AI 의 품질이 아니라 서버가 지키는 것:
 * 블록이 늘 같은 순서·모양으로 나간다, 칸을 못 채운 답은 안내로 끝나고 한도에 센다, 법령 근거는 **확정** 연결의 오늘 시행 중
 * 문구만(추천 연결·다른 회사 이름의 잘못된 연결은 들어가지 않는다), 준 적 없는 법령 번호는 버린다.
 * 심은 법령은 끝나면 지운다(남은 법령이 법령 동기화 시험의 순서를 바꾼다).
 */
describe('규정 질문 답 모양·법령 근거 (T-207·T-209)', () => {
  let t: Awaited<ReturnType<typeof createTenant>>;
  let mock = false;
  let policyId = '';
  let articleId = '';
  const lawIds: string[] = [];
  const sourceId = randomUUID();
  const ask = (question: string) => api('/ask', { method: 'POST', token: t.token, json: { question } });

  /** 법령 하나와 조항들을 SQL 로 심는다(법제처 없이). 조항: [nodeKey, articleNo, clauseNo, label, content] */
  const seedLaw = (name: string, rows: [string, number, number | null, string, string][]) => {
    const lawId = randomUUID();
    lawIds.push(lawId);
    const ext = String(Math.floor(Math.random() * 1e8));
    const ids = rows.map(() => randomUUID());
    sql(`
      INSERT INTO laws (id, source_id, external_id, external_law_id, law_name, effective_date, updated_at)
        VALUES ('${lawId}', '${sourceId}', '8${ext}', '88${ext}', '${name}', '2020-01-01', now());
      ${rows
        .map(
          ([nodeKey, no, clause, label, content], i) =>
            `INSERT INTO law_articles (id, law_id, node_key, article_no, clause_no, label, title, content, version_key, sort_order, updated_at)
               VALUES ('${ids[i]}', '${lawId}', '${nodeKey}', ${no}, ${clause ?? 'NULL'}, '${label}', ${clause ? 'NULL' : "'안전조치의무'"}, '${content}', 'v1', ${i}, now());`,
        )
        .join('\n')}
    `);
    return ids;
  };

  beforeAll(async () => {
    await waitForApi();
    t = await createTenant('ask-report');
    mock = (await api('/ask/status', { token: t.token })).body.provider === 'mock';
    if (!mock) return;
    await enableAsk(t.token);
    const set = await createPolicyWithArticle(t.token, `ASKR-${Date.now().toString(36)}`, '정보보안규정');
    policyId = set.policy.id;
    const added = await api(`/policies/${policyId}/chapters/${set.chapter.id}/articles`, {
      method: 'POST',
      token: t.token,
      json: { number: 2, title: '안전조치', content: '회사는 개인정보 안전조치를 한다.' },
    });
    articleId = added.body.id;
    const pub = await api(`/policies/${policyId}/publish-drafts`, {
      method: 'POST',
      token: t.token,
      json: { changeNote: '제정', effectiveDate: '2024-01-01' },
    });
    expect(pub.status, JSON.stringify(pub.body)).toBeLessThan(300);
    sql(`INSERT INTO law_sources (id, code, name, base_url, updated_at) VALUES ('${sourceId}', 'it-${sourceId.slice(0, 8)}', '통합테스트', 'http://example.test', now());`);
  });

  afterAll(() => {
    if (!lawIds.length) return;
    const ids = lawIds.map((id) => `'${id}'`).join(',');
    sql(`
      DELETE FROM law_links WHERE law_article_id IN (SELECT id FROM law_articles WHERE law_id IN (${ids}));
      DELETE FROM laws WHERE id IN (${ids});
      DELETE FROM law_sources WHERE id = '${sourceId}';
    `);
  });

  it('답은 늘 직답 → 검토 표 → 우선 권고 → 종합 의견 → 근거 요약 순서이고 판단은 여섯 값 중 하나다 (T-207)', async (ctx) => {
    if (!mock) ctx.skip();
    const { status, body } = await ask('안전조치 개인정보');
    expect(status).toBe(200);
    expect(body.answerable).toBe(true);
    expect(body.blocks.map((b: any) => b.type)).toEqual(['paragraph', 'review', 'priorities', 'paragraph', 'paragraph']);
    expect(body.blocks[0].text).toMatch(/^모의 답변/);
    expect(body.blocks[0].text).toContain('**대체로 부합**');
    expect(body.blocks[0].text).not.toMatch(/\[R\d+\]/);
    const review = body.blocks[1];
    expect(review.rows.length).toBeGreaterThan(0);
    for (const r of review.rows) {
      expect(['부합', '대체로 부합', '부분 부합', '보완 필요', '추가 확인 필요', '해당 없음']).toContain(r.verdict);
      expect(Object.keys(r).sort()).toEqual(['advice', 'area', 'current', 'law', 'verdict']);
    }
    expect(body.blocks[2]).toMatchObject({ type: 'priorities', kind: 'summary' });
    expect(body.lawCitations).toEqual([]); // 아직 연결이 없다
  });

  it('칸을 못 채운 답은 "한 번 더 물어 달라" 안내로 끝나고 한도에 센다 — 비용은 나간다 (T-207)', async (ctx) => {
    if (!mock) ctx.skip();
    const before = (await api('/ask/status', { token: t.token })).body;
    const res = await ask('안전조치 [형식]');
    expect(res.status).toBe(502);
    expect(res.body.message).toContain('정해진 모양');
    const after = (await api('/ask/status', { token: t.token })).body;
    expect(after.used).toBe(before.used + 1);
  });

  it('확정 연결의 법령 조문을 근거로 준다 — 조 머리면 아래 항까지, 준 적 없는 법령 번호는 버린다 (T-209)', async (ctx) => {
    if (!mock) ctx.skip();
    const [head] = seedLaw('통합시험보호법', [
      ['29//', 29, null, '제29조', ''],
      ['29/1/', 29, 1, '제29조제1항', '① 개인정보처리자는 안전성 확보에 필요한 조치를 하여야 한다.'],
    ]);
    const link = await api('/law-links', {
      method: 'POST',
      token: t.token,
      json: { lawArticleId: head, articleId, relationType: 'obligation', evidenceText: '안전조치' },
    });
    expect(link.status, JSON.stringify(link.body)).toBe(201);
    const { body } = await ask('안전조치 개인정보');
    expect(body.answerable).toBe(true);
    // 모의 AI 는 첫 L 번호와 준 적 없는 L999 를 댄다 — L999 는 버려진다
    expect(body.lawCitations.map((l: any) => l.ref)).toEqual(['L1']);
    expect(body.lawCitations[0]).toMatchObject({ lawName: '통합시험보호법', label: '제29조', scheduledOn: null });
    expect(body.lawCitations[0].content).toContain('안전성 확보');
    expect(body.blocks[1].rows[0].law).toContain('제29조');
  });

  it('추천 연결과 다른 회사 이름의 잘못된 연결은 근거가 되지 않는다 (T-209)', async (ctx) => {
    if (!mock) ctx.skip();
    const other = await createTenant('ask-report-other');
    const otherTenant = sql(`SELECT tenant_id FROM users WHERE email = '${other.email}' LIMIT 1;`);
    const [suggested] = seedLaw('추천만된법', [['7//', 7, null, '제7조', '추천 연결 문구는 근거가 아니다.']]);
    const [foreign] = seedLaw('남의회사법', [['8//', 8, null, '제8조', '다른 회사 이름의 연결 문구.']]);
    sql(`
      INSERT INTO law_links (id, tenant_id, law_article_id, article_id, relation_type, confirm_state, updated_at)
        SELECT '${randomUUID()}', p.tenant_id, '${suggested}', '${articleId}', 'reference', 'suggested', now() FROM policies p WHERE p.id = '${policyId}';
      INSERT INTO law_links (id, tenant_id, law_article_id, article_id, relation_type, confirm_state, updated_at)
        VALUES ('${randomUUID()}', '${otherTenant}', '${foreign}', '${articleId}', 'reference', 'confirmed', now());
    `);
    const { body } = await ask('안전조치 개인정보');
    const names = body.lawCitations.map((l: any) => l.lawName);
    expect(names).not.toContain('추천만된법');
    expect(names).not.toContain('남의회사법');
    expect(JSON.stringify(body)).not.toContain('다른 회사 이름의 연결 문구');
  });
});
