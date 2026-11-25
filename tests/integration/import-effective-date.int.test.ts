import { describe, it, expect, beforeAll } from 'vitest';
import { execSync } from 'child_process';
import { readFileSync } from 'fs';
import { join } from 'path';
import { BASE, api, createTenant, waitForApi } from './helpers';

/**
 * 가져오기 시행일 (PAT-02).
 *
 * 시점 조회 규칙(common/as-of.ts)은 시행일이 있는 발행본만 고른다. 예전 가져오기는 첫 버전을
 * 시행일 없이 발행해, 가져온 규정은 시점 조회와 법령 개정 분석(T-105·T-106)에서 기준 본문이
 * 없었다. 이제 가져올 때 시행일을 받고, 이미 그렇게 들어간 데이터는 관리자가 확인한 날짜로 고친다.
 */
const FIXTURE = join(__dirname, '..', 'fixtures', 'regulation-sample.pdf');

function sql(statement: string): string {
  return execSync(`docker compose exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -t -A -f -'`, {
    encoding: 'utf8',
    input: statement,
  }).trim();
}

async function uploadSession(token: string) {
  const form = new FormData();
  form.append('file', new Blob([readFileSync(FIXTURE)], { type: 'application/pdf' }), '시행일 시험.pdf');
  const res = await fetch(`${BASE}/regulation-parse/upload`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
    body: form,
  });
  let session = await res.json();
  for (let i = 0; i < 30 && session.status === 'processing'; i += 1) {
    await new Promise((r) => setTimeout(r, 500));
    session = (await api(`/regulation-parse/${session.id}`, { token })).body;
  }
  expect(session.status).toBe('ready');
  return session;
}

const articlesOf = (policy: any) => policy.chapters.flatMap((c: any) => c.articles);
/** 본문이 없는 조 제목 행은 버전이 없다 — 시행본이 있는 조문만 */
const withVersion = (policy: any) => articlesOf(policy).filter((a: any) => a.versions?.[0]);
const day = (v: string | null | undefined) => (v ? String(v).slice(0, 10) : null);

async function asOfCount(token: string, policyId: string, date: string) {
  const res = await api(`/policies/${policyId}/as-of?date=${date}`, { token });
  expect(res.status).toBe(200);
  return articlesOf(res.body).length;
}

describe('가져오기 시행일 (PAT-02)', () => {
  let t: Awaited<ReturnType<typeof createTenant>>;
  let other: Awaited<ReturnType<typeof createTenant>>;

  beforeAll(async () => {
    await waitForApi();
    t = await createTenant('eff-a');
    other = await createTenant('eff-b');
  }, 90_000);

  describe('PDF 가져오기 확정', () => {
    let policyId: string;
    let articleCount: number;

    it('시행일이 없거나 없는 날짜면 400 — 규정이 반쪽만 만들어지지 않는다', async () => {
      const session = await uploadSession(t.token);
      const code = `EFF-${Date.now().toString(36)}`;
      const missing = await api(`/regulation-parse/${session.id}/commit`, {
        method: 'POST',
        token: t.token,
        json: { code, title: '시행일 없음' },
      });
      expect(missing.status).toBe(400);
      const invalid = await api(`/regulation-parse/${session.id}/commit`, {
        method: 'POST',
        token: t.token,
        json: { code, title: '없는 날짜', effectiveDate: '2024-02-31' },
      });
      expect(invalid.status).toBe(400);
      const list = await api('/policies', { token: t.token });
      expect(JSON.stringify(list.body)).not.toContain(code);
    }, 60_000);

    it('시행일을 넣으면 첫 버전이 그 날짜로 시행되고 규정 시행일도 채워진다', async () => {
      const session = await uploadSession(t.token);
      const commit = await api(`/regulation-parse/${session.id}/commit`, {
        method: 'POST',
        token: t.token,
        json: { code: `EFF-${Date.now().toString(36)}`, title: '시행일 시험', effectiveDate: '2024-03-01' },
      });
      expect(commit.status).toBe(201);
      policyId = commit.body.policyId;

      const { body } = await api(`/policies/${policyId}`, { token: t.token });
      expect(day(body.effectiveDate)).toBe('2024-03-01');
      const articles = withVersion(body);
      articleCount = articles.length;
      expect(articleCount).toBeGreaterThan(0);
      for (const a of articles) {
        expect(a.versions[0].status).toBe('published');
        expect(day(a.versions[0].effectiveDate)).toBe('2024-03-01');
      }
    }, 60_000);

    it('시점 조회 — 시행일 전날에는 조문이 없고 당일부터 보인다', async () => {
      expect(await asOfCount(t.token, policyId, '2024-02-29')).toBe(0);
      expect(await asOfCount(t.token, policyId, '2024-03-01')).toBe(articleCount);
    });
  });

  describe('JSON 일괄 등록', () => {
    const payload = (code: string, effectiveDate?: string) => ({
      policies: [
        {
          code,
          title: '일괄 시행일',
          ...(effectiveDate ? { effectiveDate } : {}),
          articles: [{ number: 1, title: '목적', content: '본문', publish: true }],
        },
      ],
    });

    it('바로 시행할 조문이 있는데 시행일이 없으면 사전 검사와 저장 모두 거절', async () => {
      const code = `BEF-${Date.now().toString(36)}`;
      const check = await api('/admin/import/policies/validate', { method: 'POST', token: t.token, json: payload(code) });
      expect(check.status).toBe(200);
      expect(check.body.canImport).toBe(false);
      expect(JSON.stringify(check.body.issues)).toContain('effectiveDate');
      const save = await api('/admin/import/policies', { method: 'POST', token: t.token, json: payload(code) });
      expect(save.status).toBe(400);
    });

    it('시행일을 넣으면 그 날짜로 시행되어 시점 조회에 잡힌다', async () => {
      const save = await api('/admin/import/policies', {
        method: 'POST',
        token: t.token,
        json: payload(`BEF-${Date.now().toString(36)}`, '2024-03-01'),
      });
      expect(save.status).toBe(201);
      const policyId = save.body.policyIds[0];
      expect(await asOfCount(t.token, policyId, '2024-02-29')).toBe(0);
      expect(await asOfCount(t.token, policyId, '2024-03-01')).toBe(1);
    });
  });

  describe('예전 데이터 시행일 보정', () => {
    let policyId: string;
    let articleIds: string[];

    const clearDates = () =>
      sql(
        `UPDATE article_versions SET effective_date = NULL WHERE version_num = 1 AND article_id IN (SELECT a.id FROM articles a JOIN chapters c ON c.id = a.chapter_id WHERE c.policy_id = '${policyId}');`,
      );
    const fill = (token: string, effectiveDate: string, reason = '이사회 의결록 확인') =>
      api(`/policies/${policyId}/fill-effective-date`, { method: 'POST', token, json: { effectiveDate, reason } });

    beforeAll(async () => {
      const session = await uploadSession(t.token);
      const commit = await api(`/regulation-parse/${session.id}/commit`, {
        method: 'POST',
        token: t.token,
        json: { code: `FIX-${Date.now().toString(36)}`, title: '보정 시험', effectiveDate: '2024-03-01' },
      });
      policyId = commit.body.policyId;
      const { body } = await api(`/policies/${policyId}`, { token: t.token });
      articleIds = withVersion(body).map((a: any) => a.id);
      clearDates(); // 예전 가져오기가 남긴 상태를 재현한다
    }, 90_000);

    it('시행일 없는 시행본은 시점 조회에서 빠진다 (보정 전)', async () => {
      expect(await asOfCount(t.token, policyId, '2026-01-01')).toBe(0);
    });

    it('다른 회사 관리자는 고칠 수 없다(404), 근거가 없으면 400', async () => {
      expect((await fill(other.token, '2024-03-01')).status).toBe(404);
      expect((await fill(t.token, '2024-03-01', '  ')).status).toBe(400);
      expect(await asOfCount(t.token, policyId, '2026-01-01')).toBe(0);
    });

    it('확인한 시행일을 넣으면 시점 조회에 다시 잡히고 감사 로그에 남는다', async () => {
      const res = await fill(t.token, '2024-03-01');
      expect(res.status).toBe(200);
      expect(res.body.updated).toBe(articleIds.length);
      expect(await asOfCount(t.token, policyId, '2024-03-01')).toBe(articleIds.length);
      const logs = await api('/audit-logs?action=version.', { token: t.token });
      expect(JSON.stringify(logs.body)).toContain('version.effective_date_fill');
      // 다시 하면 넣을 것이 없다
      expect((await fill(t.token, '2024-03-01')).status).toBe(400);
    });

    it('뒤 버전 시행일보다 늦은 날짜는 거부하고 아무것도 바꾸지 않는다', async () => {
      // 첫 조문에 2025-01-01 시행 개정본(v2)을 만든 뒤 v1 시행일을 다시 비운다
      const target = articleIds[0];
      const created = await api(`/articles/${target}/versions`, {
        method: 'POST',
        token: t.token,
        json: { content: '개정된 본문', changeNote: '개정' },
      });
      expect(created.status).toBe(201);
      expect((await api(`/versions/${created.body.id}/submit`, { method: 'POST', token: t.token })).status).toBeLessThan(300);
      const approved = await api(`/versions/${created.body.id}/approve`, {
        method: 'POST',
        token: t.token,
        json: { changeNote: '개정', effectiveDate: '2025-01-01' },
      });
      expect(approved.status).toBeLessThan(300);
      clearDates();

      const late = await fill(t.token, '2025-06-01');
      expect(late.status).toBe(409);
      expect(JSON.stringify(late.body)).toContain('2025-01-01');
      // 충돌이 있으면 다른 조문도 바꾸지 않는다
      expect(await asOfCount(t.token, policyId, '2026-01-01')).toBe(1); // v2 하나만 시행일이 있다

      const ok = await fill(t.token, '2024-03-01');
      expect(ok.status).toBe(200);
      expect(await asOfCount(t.token, policyId, '2024-06-01')).toBe(articleIds.length);
    });
  });
});
