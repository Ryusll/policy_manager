import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'crypto';
import { readFileSync } from 'fs';
import { join } from 'path';
import { api, createTenant, createPolicyWithArticle, waitForApi } from './helpers';
import { requireRedis, type FakeLaw } from './lawgokr-seed';
import { sql } from './race';
import { EXT2, IDEO, NBSP, dropLaws, hangulName, quote, registerFakeLaw, seedVersions } from './evidence-seed';
import { pickEvidenceVersion, type VersionForEvidence } from '../../apps/api/src/law-links/evidence-version';
import { todayDateOnly } from '../../apps/api/src/common/date-only';

/**
 * T-177 (PAT-08 — 특허 도 3 S320) 법령 관계 정보에 근거 문구의 원천 조문 판을 남긴다 — 연결 쪽 통합(개정 후보 근거는
 * law-link-evidence-candidate.int.test.ts).
 *
 * 막고 싶은 사고:
 * 1. 근거 문구가 어느 판 본문에서 나왔는지 남지 않아, 조문이 개정된 뒤 근거가 지금 본문과 맞는지 알 수 없다
 * 2. 요청이 보낸 판 id 를 믿어 다른 조문·다른 회사의 판을 원천으로 남긴다 — 서버가 찾고, 요청으로 받지 않는다
 * 3. 확정·관계 유형만 고쳤는데 원천이 바뀌거나, 근거 문구를 고쳤는데 옛 원천이 남거나, 동시에 고쳐 문구와 원천이 엇갈린다
 * 4. 원천 판이 지워지면(재파싱 반려) 연결까지 지워진다 — 원천만 비운다
 * 5. 마이그레이션이 채운 원천과 새로 만든 연결의 원천이 다른 규칙을 쓴다
 */
describe('T-177 법령 관계 근거 문구의 원천 판', () => {
  let t: Awaited<ReturnType<typeof createTenant>>;
  const lawIds: string[] = [];
  let law: FakeLaw | undefined;
  let lawName = '';
  const la: Record<string, string> = {}; // 조 번호 → 법령조항 id
  const created: Record<string, string> = {}; // 조 번호 → 연결 id
  const A = { X: '', S: '', Z: '', R: '' }; // 사내 조문
  const v = Object.fromEntries(['x1', 'x2', 'x3', 'x4', 's1', 's2', 'z1', 'z2', 'z3', 'z4', 'r1', 'r2', 'r3'].map((k) => [k, randomUUID()]));

  const post = (path: string, json?: unknown) => api(path, { method: 'POST', token: t.token, json });
  const patch = (path: string, json: unknown) => api(path, { method: 'PATCH', token: t.token, json });
  const link = async (no: string, articleId: string, evidenceText?: string) => {
    const res = await post('/law-links', { lawArticleId: la[no], articleId, relationType: 'delegation', ...(evidenceText === undefined ? {} : { evidenceText }) });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    created[no] = res.body.id;
    return res.body as { id: string; evidenceVersionId: string | null };
  };
  const sourceOf = (linkId: string) => sql(`SELECT coalesce(evidence_version_id, '-') FROM law_links WHERE id='${linkId}';`);
  const listOf = async (articleId: string) => {
    const res = await api(`/law-links?articleId=${articleId}`, { token: t.token });
    expect(res.status).toBe(200);
    return new Map<string, any>(res.body.map((l: any) => [l.id, l]));
  };

  beforeAll(async () => {
    await waitForApi();
    t = await createTenant('evver');
    requireRedis();
    const reg = await registerFakeLaw(t.token, '근거판시험법', 14);
    law = reg.law;
    lawIds.push(reg.lawId);
    Object.assign(la, reg.la);
    lawName = hangulName('근거판');
    sql(`UPDATE laws SET law_name='${lawName}' WHERE id='${reg.lawId}';`);

    const { policy, chapter, article } = await createPolicyWithArticle(t.token, `EVV-${Date.now().toString(36)}`, '취업규칙');
    A.X = article.id;
    for (const [key, number] of [['S', 2], ['Z', 3], ['R', 4]] as const) {
      const res = await post(`/policies/${policy.id}/chapters/${chapter.id}/articles`, { number, title: `조문${number}`, content: '임시' });
      expect(res.status, JSON.stringify(res.body)).toBeLessThan(300);
      A[key] = res.body.id;
    }
    // X — 옛 판·오늘 시행 판(v2)·초안·시행 예정 판(2099). 시행 판에는 NBSP·줄바꿈·확장 한자, 초안에는 전각 공백
    seedVersions(A.X, [
      [v.x1, 1, 'archived', '2020-01-01', '연차휴가는 15일로 한다. 근로자는 휴가를 쓸 수 있다. 입사일 기준으로 센다.'],
      [v.x2, 2, 'archived', '2024-01-01', `연차휴가는${NBSP}20일로 한다.\n근로자는 휴가를 쓸 수 있다. ${EXT2}`],
      [v.x3, 3, 'draft', null, `연차휴가는 25일로 한다.${IDEO}근로자는 휴가를 쓸 수 있다. 입사일 기준으로 센다.`],
      [v.x4, 4, 'published', '2099-01-01', '연차휴가는 30일로 한다. 근로자는 휴가를 쓸 수 있다.'],
    ]);
    // S — 자동 추천: 제5조는 시행 판과 초안 모두에, 제6조는 초안에만, 제7조는 관련 법령 메모에만
    seedVersions(A.S, [
      [v.s1, 1, 'published', '2024-01-01', `이 규정은 「${lawName}」 제5조에 따른다.`],
      [v.s2, 2, 'draft', null, `이 규정은 「${lawName}」 제5조에 따른다. 「${lawName}」 제6조도 본다.`],
    ]);
    sql(`UPDATE articles SET related_law_note=${quote(`「${lawName}」 제7조`)} WHERE id='${A.S}';`);
    // Z — 시행일 없는 예전 시행본(z2)과 같은 날 시행한 두 판(z3·z4): 지금 판은 z4(날짜 있는 판 먼저, 같은 날이면 번호 큰 판)
    seedVersions(A.Z, [
      [v.z1, 1, 'archived', '2024-01-01', '다른 문장이다.'],
      [v.z2, 2, 'archived', null, '공통 문장이 있다.'],
      [v.z3, 3, 'archived', '2025-01-01', '공통 문장이 있다.'],
      [v.z4, 4, 'published', '2025-01-01', '공통 문장이 있다.'],
    ]);
    // R — 2025-01-01 에 폐지된 조문: 시행 판이 없다(폐지 판 r2 를 먼저 고르지 않는다)
    seedVersions(A.R, [
      [v.r1, 1, 'archived', '2020-01-01', '폐지 전 문장이다.'],
      [v.r2, 2, 'published', '2024-01-01', '폐지 전 문장이다.', '2025-01-01'],
      [v.r3, 3, 'draft', null, '폐지 전 문장이다.'],
    ]);
  }, 90_000);

  afterAll(() => {
    dropLaws(lawIds);
    law?.cleanup();
  });

  it('만들기 — 서버가 근거 문구를 담은 판을 찾는다: 공백 차이 무시, 오늘 시행 판 먼저, 옛 판·초안에만 있으면 그 판 (T-177)', async () => {
    const cases: [string, string, string | undefined, string | null][] = [
      ['1', A.X, `연차 휴가는${IDEO}20일로`, v.x2], // 띄어쓰기·전각 공백·NBSP 만 다르다
      ['2', A.X, '15일로 한다', v.x1], // 옛 판에만
      ['3', A.X, '근로자는 휴가를 쓸 수 있다', v.x2], // 네 판 모두 — 초안·시행 예정 판이 판 번호가 커도 오늘 시행 판
      ['4', A.X, '25일로 한다', v.x3], // 초안에만
      ['9', A.X, '입사일 기준으로', v.x3], // 옛 판과 초안에 — 시행 판에 없으면 판 번호가 큰 쪽
      ['5', A.X, '회사 내규에 따른다', null], // 본문 밖 문구
      ['6', A.X, '20 일', null], // 공백 빼고 3자 — 본문에 있어도 짧으면 찾지 않는다
      ['13', A.X, EXT2, null], // 확장 한자 2자(UTF-16 으로는 4) — 글자 수는 코드 포인트
      ['7', A.X, undefined, null], // 근거 문구 없음
      ['12', A.Z, '공통 문장', v.z4], // 시행일 없는 판·같은 날 시행한 다른 판보다 오늘 시행 판
      ['11', A.R, '폐지 전 문장', v.r3], // 폐지된 조문 — 시행 판이 없어 판 번호가 큰 판
    ];
    for (const [no, articleId, evidence, want] of cases) {
      expect((await link(no, articleId, evidence)).evidenceVersionId, `제${no}조 "${evidence}"`).toBe(want);
    }
  });

  it('목록 — 원천 판 요약(본문 없음, 시행일은 날짜만)과 지금 판, 근거 문구가 지금 본문에 있나를 싣는다 (T-177)', async () => {
    const x = await listOf(A.X);
    expect(x.get(created['2']).evidenceVersion).toEqual({ id: v.x1, versionNum: 1, status: 'archived', effectiveDate: '2020-01-01' });
    expect(x.get(created['2']).articleCurrentVersion).toEqual({ id: v.x2, versionNum: 2, hasEvidence: false }); // 옛 판에만 — 화면이 알린다
    expect(x.get(created['3']).articleCurrentVersion).toEqual({ id: v.x2, versionNum: 2, hasEvidence: true });
    expect(x.get(created['6']).articleCurrentVersion).toEqual({ id: v.x2, versionNum: 2, hasEvidence: null }); // 짧은 문구는 재지 않는다
    expect(x.get(created['5']).evidenceVersion).toBeNull();
    // 본문 밖 문구는 재지 않는다 — 늘 "없음"이라 알림이 헛돈다
    expect(x.get(created['5']).articleCurrentVersion).toEqual({ id: v.x2, versionNum: 2, hasEvidence: null });
    expect((await listOf(A.R)).get(created['11']).articleCurrentVersion).toBeNull(); // 폐지된 조문은 지금 판이 없다

    const byLaw = await api(`/law-links?lawArticleId=${la['4']}`, { token: t.token });
    expect(byLaw.status).toBe(200);
    expect(byLaw.body).toHaveLength(1);
    // 초안 본문이 목록으로 새지 않는다 — 요약에 content 가 없다(toEqual 이 남는 키를 잡는다)
    expect(byLaw.body[0].evidenceVersion).toEqual({ id: v.x3, versionNum: 3, status: 'draft', effectiveDate: null });
    expect(byLaw.body[0].articleCurrentVersion).toEqual({ id: v.x2, versionNum: 2, hasEvidence: false });
  });

  it('요청으로 원천 판을 받지 않는다 — evidenceVersionId 를 보내면 만들기·고치기 모두 400 (T-177)', async () => {
    const bad = await post('/law-links', { lawArticleId: la['8'], articleId: A.X, relationType: 'delegation', evidenceText: '15일로 한다', evidenceVersionId: v.x2 });
    expect(bad.status).toBe(400);
    expect(sql(`SELECT count(*) FROM law_links WHERE law_article_id='${la['8']}';`)).toBe('0');
    expect((await patch(`/law-links/${created['2']}`, { evidenceVersionId: v.x2 })).status).toBe(400);
    expect(sourceOf(created['2'])).toBe(v.x1);
  });

  it('고치기 — 근거 문구를 보낼 때만 원천을 다시 정한다: 다른 칸만 고치면 그대로, 같은 문구면 읽어 둔 값 그대로 (T-177)', async () => {
    const made = await link('8', A.X, '15일로 한다');
    expect(made.evidenceVersionId).toBe(v.x1);
    expect((await patch(`/law-links/${made.id}`, { relationType: 'application', scope: '정규직' })).status).toBe(200);
    expect((await patch(`/law-links/${made.id}`, { confirmState: 'rejected' })).status).toBe(200);
    expect(sourceOf(made.id)).toBe(v.x1); // 확정·반려·관계 유형만 고치면 원천을 건드리지 않는다
    // 원천을 비워 두고(마이그레이션이 못 찾은 연결처럼) 같은 문구를 보내면 그대로 — 다시 찾지 않는다
    sql(`UPDATE law_links SET evidence_version_id = NULL WHERE id='${made.id}';`);
    expect((await patch(`/law-links/${made.id}`, { evidenceText: '15일로 한다' })).status).toBe(200);
    expect(sourceOf(made.id)).toBe('-');
    expect(sql(`SELECT evidence_from_body FROM law_links WHERE id='${made.id}';`)).toBe('t'); // 본문에서 찾은 근거라는 기록도 그대로
    const changed = await patch(`/law-links/${made.id}`, { evidenceText: '근로자는  휴가를 쓸 수 있다' });
    expect(changed.status).toBe(200);
    expect(changed.body.evidenceVersionId).toBe(v.x2);
    expect((await patch(`/law-links/${made.id}`, { evidenceText: '회사 메모' })).body.evidenceVersionId).toBeNull(); // 본문 밖 문구로 바꾸면 비운다
  });

  it('자동 추천 — 인용을 담은 판을 같은 규칙으로: 시행 판 먼저, 초안에만 있으면 초안, 메모에만 있으면 없음 (T-177)', async () => {
    const res = await post('/law-links/suggest', { articleId: A.S });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const got = Object.fromEntries(res.body.created.map((l: any) => [l.evidenceText, l.evidenceVersionId]));
    expect(got).toEqual({ [`「${lawName}」 제5조`]: v.s1, [`「${lawName}」 제6조`]: v.s2, [`「${lawName}」 제7조`]: null });
    expect(res.body.created.every((l: any) => l.confirmState === 'suggested')).toBe(true);
    // 법령조항 id 순으로 넣는다 — 같은 조문에 추천이 겹쳐도 같은 순서로 유일 색인을 잡는다
    const order = res.body.created.map((l: any) => l.lawArticleId);
    expect(order).toEqual([...order].sort());
    // 메모에서만 나온 인용(제7조)은 본문에서 찾은 근거가 아니라 알리지 않는다(null), 본문 인용(제5조)은 시행 판 본문에 있다(true)
    const byText = new Map<string, any>([...(await listOf(A.S)).values()].map((l) => [l.evidenceText, l]));
    expect(byText.get(`「${lawName}」 제7조`)).toMatchObject({ evidenceFromBody: false, articleCurrentVersion: { hasEvidence: null } });
    expect(byText.get(`「${lawName}」 제5조`)).toMatchObject({ evidenceFromBody: true, articleCurrentVersion: { hasEvidence: true } });
  });

  it('원천이 다른 조문의 판을 가리키는 행(있어선 안 되는 행)은 목록에 싣지 않는다 (T-177)', async () => {
    sql(`UPDATE law_links SET evidence_version_id = '${v.s1}' WHERE id='${created['5']}';`);
    try {
      expect((await listOf(A.X)).get(created['5']).evidenceVersion).toBeNull();
    } finally {
      sql(`UPDATE law_links SET evidence_version_id = NULL WHERE id='${created['5']}';`);
    }
  });

  it('마이그레이션 채우기 SQL 이 TS 규칙과 같은 판을 고른다 — 이 회사 연결만 비우고 채워 본 뒤 되돌린다 (T-177)', () => {
    const migration = readFileSync(join(__dirname, '..', '..', 'apps', 'api', 'prisma', 'migrations', '20261018120000_law_link_evidence_version', 'migration.sql'), 'utf8');
    const fill = migration.slice(migration.indexOf('-- [evidence-fill:start]'), migration.indexOf('-- [evidence-fill:end]'));
    const tenant = `'${t.user.tenantId}'`;
    // 공용 개발 DB 에서 다른 세션의 연결 행을 잡지 않게 이 회사 연결로 좁힌다(고르는 규칙은 그대로)
    const scoped = fill.replace('WHERE l.evidence_version_id IS NULL', `WHERE l.tenant_id = ${tenant} AND l.evidence_version_id IS NULL`);
    expect(scoped).not.toBe(fill);
    // 채운 뒤 "본문에서 찾았나"를 채우는 문장(채우기 구간 바로 뒤)도 이 회사로 좁혀 함께 돌린다
    const fromBody = migration.slice(migration.indexOf('UPDATE "law_links" SET "evidence_from_body"')).split(';')[0];
    expect(fromBody).toContain('WHERE "evidence_version_id" IS NOT NULL');
    const scopedFromBody = fromBody.replace('WHERE', `WHERE tenant_id = ${tenant} AND`);
    const out = sql(`BEGIN;
      UPDATE law_links SET evidence_version_id = NULL, evidence_from_body = false WHERE tenant_id=${tenant};
      ${scoped}
      ${scopedFromBody};
      SELECT id || '|' || coalesce(evidence_version_id, '-') || '|' || evidence_from_body FROM law_links WHERE tenant_id=${tenant};
      ROLLBACK;`);
    const rows = out.split('\n').filter((l) => /^[0-9a-f-]{36}\|/.test(l)).map((l) => l.split('|'));
    const filled = new Map(rows.map(([id, source]) => [id, source]));
    for (const [, source, body] of rows) expect(body).toBe(source === '-' ? 'false' : 'true'); // 원천을 채운 연결만 본문에서 찾은 근거

    // 같은 자료로 TS 규칙(pickEvidenceVersion)
    type Row = Omit<VersionForEvidence, 'effectiveDate' | 'repealedOn'> & { articleId: string; effectiveDate: string | null; repealedOn: string | null };
    const links: { id: string; articleId: string; evidence: string | null }[] = JSON.parse(
      sql(`SELECT json_agg(json_build_object('id', id, 'articleId', article_id, 'evidence', evidence_text)) FROM law_links WHERE tenant_id=${tenant};`),
    );
    const versions: Row[] = JSON.parse(
      sql(`SELECT json_agg(json_build_object('id', id, 'articleId', article_id, 'versionNum', version_num, 'status', status,
                                             'effectiveDate', effective_date, 'repealedOn', repealed_on, 'content', content))
           FROM article_versions WHERE article_id IN (SELECT article_id FROM law_links WHERE tenant_id=${tenant});`),
    );
    const date = (d: string | null) => (d ? new Date(`${d}T00:00:00Z`) : null);
    const of = (articleId: string) =>
      versions.filter((r) => r.articleId === articleId).map((r) => ({ ...r, effectiveDate: date(r.effectiveDate), repealedOn: date(r.repealedOn) }));
    const want = new Map(links.map((l) => [l.id, pickEvidenceVersion(of(l.articleId), l.evidence, todayDateOnly()) ?? '-']));
    expect(filled).toEqual(want);
    // 의미 있는 대조였는지 — 시행 판 먼저·옛 판·초안·인용·시행일 없는 판과 같은 날 판·폐지·없음이 모두 나온다
    expect([...want.values()]).toEqual(expect.arrayContaining([v.x1, v.x2, v.x3, v.s1, v.s2, v.z4, v.r3, '-']));
    expect(sourceOf(created['2'])).toBe(v.x1); // 되돌렸다
  });

  it('원천 판이 지워지면 원천만 비운다 — 연결과 조문은 그대로 (T-177)', async () => {
    sql(`DELETE FROM article_versions WHERE id='${v.x3}';`);
    expect(sql(`SELECT article_id || '|' || coalesce(evidence_version_id, '-') FROM law_links WHERE id='${created['4']}';`)).toBe(`${A.X}|-`);
    // 원천은 비었어도 본문에서 찾은 근거였다 — 지금 시행 판에 그 문구가 없으면 계속 알린다
    expect((await listOf(A.X)).get(created['4'])).toMatchObject({ evidenceVersion: null, evidenceFromBody: true, articleCurrentVersion: { hasEvidence: false } });
  });
});
