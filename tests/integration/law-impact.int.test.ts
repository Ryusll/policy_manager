import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execSync } from 'child_process';
import { randomUUID } from 'crypto';
import { api, createTenant, createPolicyWithArticle, login, waitForApi } from './helpers';

/**
 * 법령 개정 영향 분석 (T-105).
 *
 * 법제처 없이 돈다 — 법령·조항·변경 이벤트를 DB 에 직접 심는다. 그래야 CI 에서도 테넌트 격리를 검증한다.
 *
 * 막고 싶은 사고:
 * 1. **다른 회사의 연결이 보인다** — 법령·변경 이벤트는 모든 회사가 함께 쓰므로, 법령조항에서 출발하는
 *    조회는 연결(LawLink)의 회사 조건이 유일한 경계다.
 * 2. **자동 추천(확정 안 된) 연결로 영향을 잡는다** — 틀린 연결이 그럴듯한 개정안을 만든다.
 * 3. **엉뚱한 본문을 "제1 조문"으로 잡는다** — 기준일에 시행 중인 발행본이어야 한다.
 * 4. **영향을 못 찾았는데 "영향 없음"으로 보인다** — 시행 전 조문, 사라진 법령 조문.
 */

function sql(query: string): string {
  return execSync(
    `docker compose exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -t -A -v ON_ERROR_STOP=1 -f -'`,
    { encoding: 'utf8', input: query },
  ).trim();
}

const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
const PW = 'IntegrationTest!234';

describe('T-105 영향 조문 식별', () => {
  const sourceId = randomUUID();
  const lawId = randomUUID();
  const artA = randomUUID(); // 제60조제1항 — 우리가 걸어 둔 조항
  const artB = randomUUID(); // 제61조 — 아무도 안 건 조항
  const evA = randomUUID();
  const evB = randomUUID();
  const evGone = randomUUID(); // 법령에서 통째로 사라진 조문
  const lawEffective = day(30);

  let t1: Awaited<ReturnType<typeof createTenant>>;
  let t2: Awaited<ReturnType<typeof createTenant>>;
  let viewerToken = '';
  let policyId = '';
  const art: Record<'x' | 'y' | 'z' | 'r' | 'w', string> = { x: '', y: '', z: '', r: '', w: '' };
  const v: Record<'x1' | 'x2', string> = { x1: randomUUID(), x2: randomUUID() };

  beforeAll(async () => {
    await waitForApi();
    t1 = await createTenant('impact-1');
    t2 = await createTenant('impact-2');

    const viewerEmail = `viewer-${t1.slug}@example.test`;
    await api('/users', { method: 'POST', token: t1.token, json: { email: viewerEmail, password: PW, name: '열람', role: 'viewer' } });
    viewerToken = (await login(viewerEmail, PW, t1.slug)).body.accessToken;

    // 공용 법령 데이터 — 테스트 전용 법령원으로 심어 다른 테스트와 섞이지 않게 한다
    sql(`
      INSERT INTO law_sources (id, code, name, base_url, updated_at) VALUES ('${sourceId}', 'it-${sourceId.slice(0, 8)}', '통합테스트', 'http://example.test', now());
      INSERT INTO laws (id, source_id, external_id, external_law_id, law_name, effective_date, updated_at)
        VALUES ('${lawId}', '${sourceId}', '900001', '990001', '통합테스트법', '${lawEffective}', now());
      INSERT INTO law_articles (id, law_id, node_key, article_no, clause_no, label, content, version_key, sort_order, updated_at) VALUES
        ('${artA}', '${lawId}', '60/1/', 60, 1, '제60조제1항', '① 사용자는 16일의 유급휴가를 주어야 한다.', 'v1:a', 1, now()),
        ('${artB}', '${lawId}', '61//', 61, NULL, '제61조', '제61조(휴가) 바뀐 문구', 'v1:b', 2, now());
      INSERT INTO law_change_events (id, law_id, law_article_id, node_key, change_type, before_content, after_content, promulgated_date, law_effective_date, received_via) VALUES
        ('${evA}', '${lawId}', '${artA}', '60/1/', 'modified', '① 사용자는 15일의 유급휴가를 주어야 한다.', '① 사용자는 16일의 유급휴가를 주어야 한다.', '${day(-5)}', '${lawEffective}', 'poll'),
        ('${evB}', '${lawId}', '${artB}', '61//', 'modified', '옛 문구', '바뀐 문구', NULL, NULL, 'poll'),
        ('${evGone}', '${lawId}', NULL, '62//', 'deleted', '제62조(대체휴가) 옛 본문', NULL, NULL, NULL, 'poll');
    `);

    // 회사 1: 규정 하나에 조문 넷
    const { policy, chapter, article } = await createPolicyWithArticle(t1.token, `IMP-${Date.now().toString(36)}`, '취업규칙');
    policyId = policy.id;
    art.x = article.id;
    const addArticle = async (number: number, title: string) =>
      (await api(`/policies/${policy.id}/chapters/${chapter.id}/articles`, {
        method: 'POST', token: t1.token, json: { number, title, content: `${title} 본문` },
      })).body.id as string;
    art.y = await addArticle(2, '아직 시행 전');
    art.z = await addArticle(3, '추천만 된 연결');
    art.r = await addArticle(4, '반려된 연결');

    // X: 과거 시행본(v1) + 법령 시행일 전에 시행될 개정본(v2). Y 는 초안뿐(시행된 적 없음)
    sql(`
      DELETE FROM article_versions WHERE article_id = '${art.x}';
      INSERT INTO article_versions (id, article_id, version_num, content, status, effective_date, updated_at) VALUES
        ('${v.x1}', '${art.x}', 1, '연차휴가는 15일로 한다.', 'archived', '2020-01-01', now()),
        ('${v.x2}', '${art.x}', 2, '연차휴가는 15일로 하되 근속 가산을 둔다.', 'published', '${day(10)}', now());
    `);

    // 연결: X·Y 확정(사람이 직접 만든 연결), Z 는 추천 상태, R 은 반려
    const link = async (token: string, articleId: string) => {
      const res = await api('/law-links', { method: 'POST', token, json: { lawArticleId: artA, articleId, relationType: 'delegation', evidenceText: '연차휴가 일수' } });
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      return res.body.id as string;
    };
    await link(t1.token, art.x);
    await link(t1.token, art.y);
    const rejected = await link(t1.token, art.r);
    await api(`/law-links/${rejected}`, { method: 'PATCH', token: t1.token, json: { confirmState: 'rejected' } });
    sql(`INSERT INTO law_links (id, tenant_id, law_article_id, article_id, relation_type, confirm_state, updated_at)
         VALUES ('${randomUUID()}', '${t1.user.tenantId}', '${artA}', '${art.z}', 'citation', 'suggested', now());`);

    // 회사 2: 같은 법령조항에 자기 조문 하나를 걸어 둔다
    const other = await createPolicyWithArticle(t2.token, `IMP2-${Date.now().toString(36)}`, '다른 회사 규정');
    art.w = other.article.id;
    await link(t2.token, art.w);
  }, 120_000);

  afterAll(() => {
    // 법령원을 지우면 법령 → 조항 → 연결·변경 이벤트가 함께 지워진다
    sql(`DELETE FROM laws WHERE id='${lawId}'; DELETE FROM law_sources WHERE id='${sourceId}';`);
  });

  describe('권한', () => {
    it('토큰이 없으면 401, 열람자는 403 — 어느 조문이 어느 법에 걸렸는지는 내부 정보다', async () => {
      expect((await api('/law-changes')).status).toBe(401);
      expect((await api('/law-changes', { token: viewerToken })).status).toBe(403);
      expect((await api(`/law-changes/${evA}/impact`, { token: viewerToken })).status).toBe(403);
    });

    it('없는 이벤트는 404, 형식이 틀린 기준일은 400', async () => {
      expect((await api(`/law-changes/${randomUUID()}/impact`, { token: t1.token })).status).toBe(404);
      expect((await api(`/law-changes/${evA}/impact?asOf=2026/01/01`, { token: t1.token })).status).toBe(400);
      expect((await api(`/law-changes/${evA}/impact?asOf=2026-02-31`, { token: t1.token })).status).toBe(400);
    });
  });

  describe('영향 조문', () => {
    it('우리 회사의 **확정된** 연결만 영향으로 본다 — 추천·반려·다른 회사 연결은 빠진다', async () => {
      const { status, body } = await api(`/law-changes/${evA}/impact`, { token: t1.token });
      expect(status, JSON.stringify(body)).toBe(200);
      const ids = body.impacted.map((i: any) => i.article.id).sort();
      expect(ids).toEqual([art.x, art.y].sort());
      expect(ids).not.toContain(art.w); // 다른 회사
      expect(ids).not.toContain(art.z); // 추천만 된 연결
      expect(ids).not.toContain(art.r); // 반려
      expect(body.suggestedCount).toBe(1); // 추천은 "확인이 필요한 연결"로만 알린다
      expect(body.impacted[0].policy).toMatchObject({ id: policyId, title: '취업규칙' });
      expect(body.impacted[0].relationType).toBe('delegation');
      expect(body.impacted[0].evidenceText).toBe('연차휴가 일수');
    });

    it('다른 회사는 같은 변경에서 자기 조문만 본다', async () => {
      const { body } = await api(`/law-changes/${evA}/impact`, { token: t2.token });
      expect(body.impacted.map((i: any) => i.article.id)).toEqual([art.w]);
      expect(body.suggestedCount).toBe(0); // 회사 1의 추천 연결 수도 새지 않는다
    });

    it('기준일 기본값은 법령 시행일(아직 시행 전) — 그날 시행될 우리 개정본이 제1 조문이다', async () => {
      const { body } = await api(`/law-changes/${evA}/impact`, { token: t1.token });
      expect(body.asOf).toBe(lawEffective);
      const x = body.impacted.find((i: any) => i.article.id === art.x);
      expect(x.baseVersion).toMatchObject({ id: v.x2, versionNum: 2, effectiveDate: day(10) });
      expect(x.skipReason).toBeNull();
    });

    it('기준일을 오늘로 주면 오늘 시행 중인 본문(옛 판, 지금은 폐지 상태)이 제1 조문이다', async () => {
      const { body } = await api(`/law-changes/${evA}/impact?asOf=${day(0)}`, { token: t1.token });
      const x = body.impacted.find((i: any) => i.article.id === art.x);
      expect(x.baseVersion).toMatchObject({ id: v.x1, status: 'archived', effectiveDate: '2020-01-01' });
    });

    it('시행된 적 없는 조문은 빼지 않고 "제1 조문 없음"으로 돌려준다 — 조용히 빠지면 영향이 없는 것으로 읽힌다', async () => {
      const { body } = await api(`/law-changes/${evA}/impact`, { token: t1.token });
      const y = body.impacted.find((i: any) => i.article.id === art.y);
      expect(y.baseVersion).toBeNull();
      expect(y.skipReason).toBe('not_in_force');
    });

    it('법령 시행일을 모르면 기준일은 오늘', async () => {
      const { body } = await api(`/law-changes/${evB}/impact`, { token: t1.token });
      expect(body.asOf).toBe(day(0));
      expect(body.impacted).toEqual([]);
    });

    it('법령에서 사라진 조문은 영향을 찾을 수 없다는 사유를 싣는다 — "영향 없음"으로 보이면 안 된다', async () => {
      const { body } = await api(`/law-changes/${evGone}/impact`, { token: t1.token });
      expect(body.impacted).toEqual([]);
      expect(body.unresolvable).toContain('사라져');
      expect(body.event.label).toBe('제62조'); // 조문 행이 없어도 표기를 되살린다
    });
  });

  describe('변경 목록', () => {
    it('이벤트마다 우리 회사 영향 수(확정·확인 필요)를 센다', async () => {
      const { status, body } = await api(`/law-changes?lawId=${lawId}`, { token: t1.token });
      expect(status).toBe(200);
      const byId = Object.fromEntries(body.map((e: any) => [e.id, e]));
      expect(byId[evA].impact).toEqual({ confirmed: 2, suggested: 1 });
      expect(byId[evB].impact).toEqual({ confirmed: 0, suggested: 0 });
      expect(byId[evGone].impact).toEqual({ confirmed: 0, suggested: 0 });
      expect(byId[evA]).toMatchObject({ lawName: '통합테스트법', label: '제60조제1항', changeType: 'modified', lawEffectiveDate: lawEffective });
    });

    it('다른 회사의 수는 섞이지 않는다', async () => {
      const { body } = await api(`/law-changes?lawId=${lawId}`, { token: t2.token });
      const a = body.find((e: any) => e.id === evA);
      expect(a.impact).toEqual({ confirmed: 1, suggested: 0 });
    });

    it('affected=true 면 우리 회사에 확정 영향이 있는 변경만, false 는 전부', async () => {
      const only = await api(`/law-changes?lawId=${lawId}&affected=true`, { token: t1.token });
      expect(only.body.map((e: any) => e.id)).toEqual([evA]);
      const all = await api(`/law-changes?lawId=${lawId}&affected=false`, { token: t1.token });
      expect(all.body).toHaveLength(3);
    });
  });
});
