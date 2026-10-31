import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'child_process';
import { randomUUID } from 'crypto';
import { api, createTenant, createPolicyWithArticle, login, waitForApi, BASE } from './helpers';
import { sql } from './race';
import { lockOf, seedReviewCandidate } from './amendment-seed';

const day = (offset: number) => new Date(Date.now() + 9 * 3_600_000 + offset * 86_400_000).toISOString().slice(0, 10);
const PW = 'DocPass!2345';

/** PDF 의 글자와 밑줄 수를 API 컨테이너의 PyMuPDF 로 읽는다 — 렌더러가 태그를 지우면 글자는 남고 밑줄이 사라진다 */
const READ_PDF = [
  'import sys, json',
  'try:',
  '    import pymupdf as fitz',
  'except ImportError:',
  '    import fitz',
  "doc = fitz.open('pdf', sys.stdin.buffer.read())",
  "text = ''.join(p.get_text() for p in doc)",
  "lines = sum(1 for p in doc for d in p.get_drawings() if d['rect'].height < 0.5 and d['rect'].width > 1)",
  "print(json.dumps({'text': text, 'underlines': lines}))",
].join('\n');
function readPdf(bytes: Uint8Array): { text: string; underlines: number } {
  const out = execFileSync('docker', ['compose', 'exec', '-T', 'api', 'python3', '-c', READ_PDF], { input: Buffer.from(bytes) });
  return JSON.parse(out.toString('utf8'));
}

/**
 * T-162 (SRS LAW-22) 개정안 문서 PDF — 같은 규정의 개정 후보를 신구조문대비표·개정 이유·법령 근거로 낸다.
 *
 * 막고 싶은 사고:
 * 1. 열람자나 다른 회사가 확정 전 내부 문서(개정 초안)를 뽑는다
 * 2. 다른 규정의 후보나 반려된 후보가 한 안건 자료에 섞인다
 * 3. 규정 내보내기와 같은 감사 기록으로 남아 무엇을 뽑았는지 가려지지 않는다
 * 4. 바뀐 곳 표시(밑줄)가 PDF 에서 사라진다
 */
describe('T-162 개정안 문서 PDF', () => {
  let t: Awaited<ReturnType<typeof createTenant>>;
  let other: Awaited<ReturnType<typeof createTenant>>;
  let editorToken = '';
  let viewerToken = '';
  let policyId = '';
  let c1 = '';
  let c2 = '';
  let elsewhere = '';
  let rejected = '';
  let theirs = '';
  let stale = '';
  let staleArticle = '';
  let approved = '';
  const cleanups: (() => void)[] = [];
  const E = day(30);

  const documentPdf = (token: string, candidateIds: unknown) =>
    fetch(`${BASE}/amendments/document/pdf`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ candidateIds }),
    });
  const userToken = async (role: 'editor' | 'viewer') => {
    const email = `${role}-${t.slug}@example.test`;
    const made = await api('/users', { method: 'POST', token: t.token, json: { email, password: PW, name: role, role } });
    expect(made.status, JSON.stringify(made.body)).toBe(201);
    return (await login(email, PW, t.slug)).body.accessToken as string;
  };

  beforeAll(async () => {
    await waitForApi();
    t = await createTenant('amend-doc');
    other = await createTenant('amend-doc-o');
    editorToken = await userToken('editor');
    viewerToken = await userToken('viewer');
    const set = await createPolicyWithArticle(t.token, `AD-${Date.now().toString(36)}`, '문서시험규정');
    policyId = set.policy.id;
    const seedFull = async (pId: string, chapterId: string, number: number, tag: string, token = t.token) => {
      const s = await seedReviewCandidate(token, pId, chapterId, { number, lawEffective: E, tag });
      cleanups.push(s.cleanup);
      return s;
    };
    const seed = async (pId: string, chapterId: string, number: number, tag: string) => (await seedFull(pId, chapterId, number, tag)).candidateId;
    c2 = await seed(policyId, set.chapter.id, 21, '문서B');
    c1 = await seed(policyId, set.chapter.id, 20, '문서A');
    rejected = await seed(policyId, set.chapter.id, 22, '문서R');
    const r = await api(`/amendments/${rejected}/reject`, { method: 'POST', token: t.token, json: { reason: '시험 반려', ...(await lockOf(t.token, rejected)) } });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const set2 = await createPolicyWithArticle(t.token, `AD2-${Date.now().toString(36)}`, '다른규정');
    elsewhere = await seed(set2.policy.id, set2.chapter.id, 30, '문서X');
    const s = await seedFull(policyId, set.chapter.id, 23, '문서S');
    stale = s.candidateId;
    staleArticle = s.articleId;
    approved = await seed(policyId, set.chapter.id, 24, '문서P');
    const oset = await createPolicyWithArticle(other.token, `ADO-${Date.now().toString(36)}`, '남의규정');
    theirs = (await seedFull(oset.policy.id, oset.chapter.id, 40, '문서O', other.token)).candidateId;
  }, 180_000);

  afterAll(() => {
    for (const c of cleanups) c();
  });

  it('같은 규정의 후보 둘을 PDF 한 부로 — 신구조문대비표·개정 이유·법령 근거, 바뀐 곳은 밑줄 (T-162)', async () => {
    const res = await documentPdf(t.token, [c2, c1]);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/pdf');
    expect(res.headers.get('content-disposition')).toContain("filename*=UTF-8''");
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect(String.fromCharCode(...bytes.slice(0, 4))).toBe('%PDF');

    const { text, underlines } = readPdf(bytes);
    for (const word of ['문서시험규정 개정안', '개정 이유', '신구조문대비표', '현행', '개정안', '비고', '법령 근거', '정정시험법문서A', '정정시험법문서B', '검토 중']) {
      expect(text, word).toContain(word);
    }
    // 조문 차례 — 제20조가 제21조보다 앞(요청 순서와 상관없이)
    expect(text.indexOf('제20조를 바꿈')).toBeGreaterThan(-1);
    expect(text.indexOf('제20조를 바꿈')).toBeLessThan(text.indexOf('제21조를 바꿈'));
    expect(text).toContain('승인되지 않은 조문 2개');
    expect(underlines).toBeGreaterThan(0);
  });

  it('편집자도 낸다 (T-162)', async () => {
    const res = await documentPdf(editorToken, [c1]);
    expect(res.status).toBe(200);
  });

  it('열람자는 403 — 확정 전 내부 문서다 (T-162)', async () => {
    const res = await documentPdf(viewerToken, [c1]);
    expect(res.status).toBe(403);
  });

  it('다른 회사는 404 — 후보가 있는지도 드러내지 않는다 (T-162)', async () => {
    expect((await documentPdf(other.token, [c1])).status).toBe(404);
    // 섞어 보내도 전체 404 — 있는 것만 골라 문서를 만들지 않는다
    expect((await documentPdf(other.token, [theirs, c1])).status).toBe(404);
    expect((await documentPdf(t.token, [c1, theirs])).status).toBe(404);
    expect((await documentPdf(t.token, [c1, randomUUID()])).status).toBe(404);
    // 남의 후보만이면 그 회사에서는 낸다(시험 자료가 제대로 심겼는지)
    expect((await documentPdf(other.token, [theirs])).status).toBe(200);
  });

  it('같은 조문의 후보가 둘이면 400 — 대비표에 한 조문이 두 번 나오지 않게 (T-162)', async () => {
    const copy = randomUUID();
    sql(`CREATE TEMP TABLE dup AS SELECT * FROM amendment_candidates WHERE id = '${c1}';
         UPDATE dup SET id = '${copy}', variant = 'it-copy', candidate_content = candidate_content || ' (다른 안)'; -- 규칙 세트가 바뀌어 같은 조문에 새 후보가 생긴 것처럼(variant 가 다르다)
         INSERT INTO amendment_candidates SELECT * FROM dup;`);
    try {
      const res = await documentPdf(t.token, [c1, copy]);
      expect(res.status).toBe(400);
      expect((await res.json()).code).toBe('AMENDMENT_DOC_DUPLICATE_ARTICLE');
    } finally {
      sql(`DELETE FROM amendment_candidates WHERE id = '${copy}';`);
    }
  });

  it('기준 본문이 지금과 달라진(낡은) 후보는 400 — 현행 칸이 틀린 문서를 내지 않는다 (T-162)', async () => {
    expect((await documentPdf(t.token, [stale])).status).toBe(200);
    sql(`INSERT INTO article_versions (id, article_id, version_num, content, status, effective_date, updated_at)
         VALUES ('${randomUUID()}', '${staleArticle}', 2, '더 이른 시행일로 발행된 다른 본문', 'archived', '2019-01-01', now());`);
    expect((await api(`/amendments/${stale}`, { token: t.token })).body.staleReason).toBe('history_changed');
    const res = await documentPdf(t.token, [c1, stale]);
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: 'AMENDMENT_DOC_STALE', article: '제23조', staleReason: 'history_changed' });
  });

  it('승인된 후보는 승인 사유와 승인 때 정한 사내 시행일을 적는다 (T-162)', async () => {
    const effective = day(45);
    const ok = await api(`/amendments/${approved}/approve`, {
      method: 'POST',
      token: t.token,
      json: { ...(await lockOf(t.token, approved)), effectiveDate: effective, changeNote: '이사회 의결 반영' },
    });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    const res = await documentPdf(t.token, [approved, c1]);
    expect(res.status).toBe(200);
    const { text } = readPdf(new Uint8Array(await res.arrayBuffer()));
    const [y, m, d] = effective.split('-').map(Number);
    expect(text).toContain('승인 사유: 이사회 의결 반영');
    expect(text.replace(/\s+/g, ' ')).toContain(`사내 시행 ${y}. ${m}. ${d}.`);
    expect(text).toContain('승인되지 않은 조문 1개');
  });

  it('다른 규정의 후보가 섞이면 400 (T-162)', async () => {
    const res = await documentPdf(t.token, [c1, elsewhere]);
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe('AMENDMENT_DOC_MIXED_POLICY');
  });

  it('반려된 후보는 400 (T-162)', async () => {
    const res = await documentPdf(t.token, [c1, rejected]);
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe('AMENDMENT_DOC_REJECTED');
  });

  it('입력 거부 — 빈 목록·id 가 아닌 값·51개는 400, 없는 id 는 404 (T-162)', async () => {
    expect((await documentPdf(t.token, [])).status).toBe(400);
    expect((await documentPdf(t.token, ['nope'])).status).toBe(400);
    expect((await documentPdf(t.token, 'x')).status).toBe(400);
    const many = Array.from({ length: 51 }, () => crypto.randomUUID());
    expect((await documentPdf(t.token, many)).status).toBe(400);
    expect((await documentPdf(t.token, [crypto.randomUUID()])).status).toBe(404);
  });

  it('감사는 규정 내보내기와 따로 — amendment.export.pdf 에 규정과 낸 후보의 판을 남긴다 (T-162)', async () => {
    const tenantId = sql(`SELECT id FROM tenants WHERE slug = '${t.slug}';`);
    const before = Number(sql(`SELECT count(*) FROM audit_logs WHERE tenant_id = '${tenantId}' AND action = 'amendment.export.pdf';`));
    const res = await documentPdf(t.token, [c1]);
    expect(res.status).toBe(200);
    const row = sql(
      `SELECT entity_type || '|' || entity_id || '|' || (details->'candidates'->0->>'id') || '|' || (details->'candidates'->0->>'revision') FROM audit_logs WHERE tenant_id = '${tenantId}' AND action = 'amendment.export.pdf' ORDER BY created_at DESC LIMIT 1;`,
    );
    expect(row).toBe(`Policy|${policyId}|${c1}|1`);
    expect(Number(sql(`SELECT count(*) FROM audit_logs WHERE tenant_id = '${tenantId}' AND action = 'amendment.export.pdf';`))).toBe(before + 1);
    expect(sql(`SELECT count(*) FROM audit_logs WHERE tenant_id = '${tenantId}' AND action = 'policy.export.pdf';`)).toBe('0');
    // 거부된 요청은 남기지 않는다
    await documentPdf(t.token, [c1, rejected]);
    expect(Number(sql(`SELECT count(*) FROM audit_logs WHERE tenant_id = '${tenantId}' AND action = 'amendment.export.pdf';`))).toBe(before + 1);
  });
});
