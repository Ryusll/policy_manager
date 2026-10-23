import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'crypto';
import { api, createTenant, createPolicyWithArticle, waitForApi } from './helpers';
import { FakeLaw, requireRedis, type FakeVersion } from './lawgokr-seed';
import { sql } from './race';
import { art, dropLaws, kstToday, seedVersions } from './evidence-seed';

/**
 * T-177 (PAT-08 — 특허 도 3 S320) 개정 후보 근거의 원천 판 — 통합(연결 쪽은 law-link-evidence-version.int.test.ts).
 *
 * 막고 싶은 사고:
 * 1. 후보 근거가 만든 뒤의 연결을 따라가 그때 무엇을 근거로 했는지 잃는다 — 원천 판과 "근거 문구가 기준 본문에 있나"는 스냅샷
 * 2. 개정을 승인할 때마다 문장이 그대로인 연결에도 알림이 떠 헛돈다 — 판 번호가 아니라 근거 문구가 지금 본문에 있는지로 알린다
 * 3. 조문이 개정되면 연결이 옛 판에 남는다 — 연결은 조문에 걸린다
 */
describe('T-177 개정 후보 근거의 원천 판', () => {
  let t: Awaited<ReturnType<typeof createTenant>>;
  const lawIds: string[] = [];
  const fakes: FakeLaw[] = [];
  const [y1, y2] = [randomUUID(), randomUUID()];

  const post = (path: string, json?: unknown) => api(path, { method: 'POST', token: t.token, json });
  const patch = (path: string, json: unknown) => api(path, { method: 'PATCH', token: t.token, json });

  beforeAll(async () => {
    await waitForApi();
    t = await createTenant('evcand');
    sql(`UPDATE users SET platform_role='global_admin' WHERE id='${t.user.id}';`); // 동기화 실행
    requireRedis();
  }, 90_000);

  afterAll(() => {
    dropLaws(lawIds);
    for (const f of fakes) f.cleanup();
  });

  it('후보 근거 — 만들 때의 원천 판과 기준 본문 포함 여부를 스냅샷으로, 개정 뒤 목록은 근거 문구가 지금 본문에 있는지로 (T-177)', async () => {
    const law = new FakeLaw('근거판후보법');
    fakes.push(law);
    const A: FakeVersion = { mst: law.mst(1), promulgated: '20260110', promulgationNo: '801', effective: '20260201', articles: [art('60', '연차휴가', '사용자는 근로자에게 15일의 유급휴가를 주어야 한다.'), art('61', '산정', '연차휴가는 입사일부터 센다.'), art('62', '보칙', '그 밖의 사항은 따로 정한다.')] };
    const B: FakeVersion = { mst: law.mst(2), promulgated: '20260310', promulgationNo: '802', effective: '20301201', articles: [art('60', '연차휴가', '사용자는 근로자에게 20일의 유급휴가를 주어야 한다.'), art('61', '산정', '연차휴가는 회계연도부터 센다.'), art('62', '보칙', '그 밖의 사항은 대통령령으로 정한다.')] };
    law.seedAll([A, B]);
    const reg = await post('/laws', { mst: A.mst });
    expect(reg.status, JSON.stringify(reg.body)).toBe(200);
    const lawId = reg.body.id as string;
    lawIds.push(lawId);
    const lawArt = (no: string) => sql(`SELECT id FROM law_articles WHERE law_id='${lawId}' AND node_key='${no}//';`);

    const { article } = await createPolicyWithArticle(t.token, `EVC-${Date.now().toString(36)}`, '취업규칙');
    const Y = article.id as string;
    seedVersions(Y, [
      [y1, 1, 'archived', '2020-01-01', '직원에게는 매년 15일의 연차휴가를 준다. 연차휴가는 입사일부터 센다.'],
      [y2, 2, 'published', '2024-01-01', '직원에게는 매년 15일의 연차휴가를 준다. 연차휴가는 회계연도부터 센다.'],
    ]);
    const link = async (no: string, evidenceText: string) => {
      const res = await post('/law-links', { lawArticleId: lawArt(no), articleId: Y, relationType: 'delegation', evidenceText });
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      return res.body as { id: string; evidenceVersionId: string | null };
    };
    const l60 = await link('60', '매년 15일의 연차휴가'); // 옛 판·시행 판 모두 — 시행 판
    const l61 = await link('61', '입사일부터 센다'); // 옛 판에만
    const l62 = await link('62', '회사 메모에 적은 설명'); // 본문 밖 문구 — 원천 없음, 본문에서 찾은 근거가 아니다
    expect([l60.evidenceVersionId, l61.evidenceVersionId, l62.evidenceVersionId]).toEqual([y2, y1, null]);

    const run = await post('/platform-admin/law-sync/run', { lawId }); // 끝에 개정 후보를 만든다
    expect(run.status, JSON.stringify(run.body)).toBe(200);
    expect(run.body.results[0]).toMatchObject({ outcome: 'updated', toMst: B.mst, events: 3 });
    const candidate = async (no: string) => {
      const id = sql(`SELECT c.id FROM amendment_candidates c JOIN law_change_events e ON e.id = c.change_event_id WHERE c.article_id='${Y}' AND e.law_article_id='${lawArt(no)}';`);
      const res = await api(`/amendments/${id}`, { token: t.token });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      return res.body;
    };
    const c60 = await candidate('60');
    expect(c60.baseVersion.id).toBe(y2);
    expect(c60.rationale.link).toMatchObject({ evidenceVersion: { id: y2, versionNum: 2, status: 'published', effectiveDate: '2024-01-01' }, evidenceInBase: true });
    const c61 = await candidate('61');
    expect(c61.baseVersion.id).toBe(y2);
    // 원천(v1)의 문구가 기준 본문(v2)에 없다 — 화면이 알린다
    expect(c61.rationale.link).toMatchObject({ evidenceVersion: { id: y1, versionNum: 1, status: 'archived', effectiveDate: '2020-01-01' }, evidenceInBase: false });

    // 본문 밖 근거는 기준 본문과 견주지 않는다(null) — 늘 "없음"이라 알림이 헛돈다
    expect((await candidate('62')).rationale.link).toMatchObject({ evidenceVersion: null, evidenceInBase: null });

    // 연결의 근거 문구를 고쳐도 후보의 근거는 만들 때 그대로
    expect((await patch(`/law-links/${l61.id}`, { evidenceText: '회계연도부터 센다' })).body.evidenceVersionId).toBe(y2);
    expect((await candidate('61')).rationale.link).toMatchObject({ evidenceVersion: { id: y1 }, evidenceInBase: false });

    // 조문이 개정돼(오늘 시행 v3) 연결은 조문에 남고 원천은 그대로. 알림은 판 번호가 아니라 근거 문구가 지금 본문에 있는지로 —
    // l60 은 v3 에 문구가 없어 알리고, l61 은 원천(v2)과 판이 달라도 v3 에 문구가 있어 알리지 않는다
    const draft = await post(`/articles/${Y}/versions`, { content: '직원에게는 매년 20일의 연차휴가를 준다. 연차휴가는 회계연도부터 센다.' });
    expect(draft.status, JSON.stringify(draft.body)).toBe(201);
    expect((await post(`/versions/${draft.body.id}/submit`)).status).toBeLessThan(300);
    const approved = await post(`/versions/${draft.body.id}/approve`, { changeNote: '개정', effectiveDate: kstToday() });
    expect(approved.status, JSON.stringify(approved.body)).toBeLessThan(300);
    const list = (await api(`/law-links?articleId=${Y}`, { token: t.token })).body;
    const now = { id: draft.body.id, versionNum: 3 };
    expect(list.find((l: any) => l.id === l60.id)).toMatchObject({
      articleId: Y,
      evidenceVersion: { id: y2, versionNum: 2, status: 'archived' },
      articleCurrentVersion: { ...now, hasEvidence: false },
    });
    expect(list.find((l: any) => l.id === l61.id)).toMatchObject({ evidenceVersion: { id: y2 }, articleCurrentVersion: { ...now, hasEvidence: true } });
  }, 90_000);

  it('원천 초안이 문구 없이 고쳐진 채 시행되면 원천이 지금 버전이어도 알린다 — 판 번호 비교로는 놓친다 (T-177)', async () => {
    const law = new FakeLaw('근거판초안법');
    fakes.push(law);
    const base: FakeVersion = { mst: law.mst(1), promulgated: '20260110', promulgationNo: '811', effective: '20260201', articles: [art('1', '목적', '본문')] };
    law.seedAll([base]);
    const reg = await post('/laws', { mst: base.mst });
    expect(reg.status, JSON.stringify(reg.body)).toBe(200);
    lawIds.push(reg.body.id);
    const lawArticleId = sql(`SELECT id FROM law_articles WHERE law_id='${reg.body.id}' AND node_key='1//';`);

    const { article } = await createPolicyWithArticle(t.token, `EVD-${Date.now().toString(36)}`, '복무규정');
    const D = article.id as string;
    seedVersions(D, [[randomUUID(), 1, 'published', '2024-01-01', '연차휴가는 15일로 한다.']]);
    const draft = await post(`/articles/${D}/versions`, { content: '연차휴가는 15일로 한다. 초안에서 새로 쓴 문장이다.' });
    expect(draft.status, JSON.stringify(draft.body)).toBe(201);
    const made = await post('/law-links', { lawArticleId, articleId: D, relationType: 'delegation', evidenceText: '초안에서 새로 쓴 문장' });
    expect(made.body.evidenceVersionId).toBe(draft.body.id); // 초안에만 있다 — 원천은 초안

    // 초안에서 그 문장을 빼고 오늘 시행 — 원천(그 초안)이 그대로 지금 버전이 된다
    expect((await api(`/versions/${draft.body.id}`, { method: 'PUT', token: t.token, json: { content: '연차휴가는 20일로 한다.' } })).status).toBeLessThan(300);
    expect((await post(`/versions/${draft.body.id}/submit`)).status).toBeLessThan(300);
    const approved = await post(`/versions/${draft.body.id}/approve`, { changeNote: '개정', effectiveDate: kstToday() });
    expect(approved.status, JSON.stringify(approved.body)).toBeLessThan(300);
    const row = (await api(`/law-links?articleId=${D}`, { token: t.token })).body[0];
    expect(row.evidenceVersion).toMatchObject({ id: draft.body.id, status: 'published' });
    expect(row.articleCurrentVersion).toEqual({ id: draft.body.id, versionNum: 2, hasEvidence: false });
  }, 60_000);
});
