import { describe, it, expect, beforeAll } from 'vitest';
import { execSync } from 'child_process';
import { api, createTenant, waitForApi } from './helpers';

function sql(query: string): string {
  return execSync(`docker compose exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -t -A -v ON_ERROR_STOP=1 -f -'`, {
    encoding: 'utf8',
    input: query,
  }).trim();
}
const kstToday = () => new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);

/**
 * T-132 ⑦ 미래 시행 구조 변경(재파싱 묶음)을 기다리는 동안의 구조 편집.
 *
 * T-127 ② 는 이 동안 목차 구조 편집을 화면에서 통째로 막았다 — 목차는 오늘 자리(얼린 계층)로 보이는데 편집은 지금 행(그날부터의
 * 자리)을 고쳐 엉뚱한 자리가 바뀌었다. 이제 편집은 지금 행을 고치고(화면도 지금 행 값으로 채운다), 서버는 자리가 바뀌는 중인 조
 * (오늘 조·그날부터의 조)에 조문을 넣거나 옮겨 넣는 것만 막는다 — 새 행에는 얼린 오늘 자리가 없어 그날 전까지의 시점 조회에서
 * 한 조가 두 자리로 갈리거나 남의 조와 겹친다.
 *
 * 묶음 승인은 원문 PDF 가 있어야 해서(호스트 실행 API 는 추출기가 없다) 묶음이 남기는 상태를 SQL 로 만든다: 오늘 버전에 옛 자리를
 * 얼리고, 조문 행을 새 자리로 옮기고, 미래 시행일 버전을 승인한다(reparse-apply 의 미래 시행 묶음과 같은 모양).
 */
describe('T-132 ⑦ 구조 변경 예정 동안의 구조 편집', () => {
  let t: Awaited<ReturnType<typeof createTenant>>;
  let policyId = '';
  let chapterId = '';
  const ids: Record<string, string> = {};
  const FUTURE = '2099-03-01';
  const post = (path: string, json?: unknown) => api(path, { method: 'POST', token: t.token, json });
  const add = (json: Record<string, unknown>) => post(`/policies/${policyId}/chapters/${chapterId}/articles`, { title: '', content: '새 본문', ...json });
  const put = (articleId: string, json: Record<string, unknown>) =>
    api(`/policies/${policyId}/chapters/${chapterId}/articles/${articleId}`, { method: 'PUT', token: t.token, json });
  const detail = async () => (await api(`/policies/${policyId}`, { token: t.token })).body;
  const rowsOf = (p: any) => p.chapters.flatMap((c: any) => c.articles);
  const rowOf = async (id: string) => rowsOf(await detail()).find((a: any) => a.id === id);

  beforeAll(async () => {
    await waitForApi();
    t = await createTenant('sched-struct');
    policyId = (await post('/policies', { code: `SST-${Date.now().toString(36)}`, title: '복무규정' })).body.id;
    chapterId = (await post(`/policies/${policyId}/chapters`, { number: 1, title: '총칙' })).body.id;
    ids.purpose = (await add({ number: 1, title: '목적', content: '이 규정은 복무를 정한다.' })).body.id;
    ids.hours = (await add({ number: 2, title: '근무시간', content: '근무시간은 9시부터 18시까지로 한다.' })).body.id;
    ids.leaveHead = (await add({ number: 3, title: '휴가', content: undefined })).body.id;
    ids.leave1 = (await add({ number: 3, clauseNumber: 1, content: '연차휴가는 15일로 한다.' })).body.id;
    ids.leave2 = (await add({ number: 3, clauseNumber: 2, content: '휴가는 미리 신청한다.' })).body.id;
    ids.misc = (await add({ number: 5, title: '기타', content: '그 밖의 사항은 따로 정한다.' })).body.id;
    ids.duty = (await add({ number: 6, title: '당직', content: '당직은 순번으로 선다.' })).body.id;
    ids.duty1 = (await add({ number: 6, clauseNumber: 1, content: '당직표는 매달 만든다.' })).body.id;
    expect((await post(`/policies/${policyId}/publish-drafts`, { changeNote: '제정', effectiveDate: '2024-01-01' })).status).toBeLessThan(300);
    // 묶음이 남기는 상태 — 오늘 버전에 옛 자리를 얼리고, 조문 행을 그날부터의 자리로 옮기고, 미래 시행 버전을 승인한다.
    // 근무시간: 제2조 → 제4조 / 휴가 ①: 같은 조 안에서 제1항 → 제9항 / 당직(조 머리와 ①): 제6조 → 제8조
    const frozen = (number: number, clauseNumber: number | null, title: string) =>
      `'{"v":1,"chapter":{"id":"${chapterId}","number":1,"title":"총칙","hidden":false},"section":null,"number":${number},"branchNumber":null,"clauseNumber":${clauseNumber ?? 'null'},"itemNumber":null,"title":"${title}"}'::jsonb`;
    sql(`UPDATE article_versions SET structure = ${frozen(2, null, '근무시간')} WHERE article_id = '${ids.hours}';
UPDATE article_versions SET structure = ${frozen(3, 1, '')} WHERE article_id = '${ids.leave1}';
UPDATE article_versions SET structure = ${frozen(6, null, '당직')} WHERE article_id = '${ids.duty}';
UPDATE article_versions SET structure = ${frozen(6, 1, '')} WHERE article_id = '${ids.duty1}';
UPDATE articles SET number = 4 WHERE id = '${ids.hours}';
UPDATE articles SET clause_number = 9 WHERE id = '${ids.leave1}';
UPDATE articles SET number = 8 WHERE id IN ('${ids.duty}', '${ids.duty1}');`);
    for (const key of ['hours', 'leave1', 'duty', 'duty1']) {
      const versions = (await api(`/articles/${ids[key]}/versions`, { token: t.token })).body as any[];
      const d = await post(`/articles/${ids[key]}/versions`, { content: versions[0].content });
      await post(`/versions/${d.body.id}/submit`);
      expect((await post(`/versions/${d.body.id}/approve`, { changeNote: '자리 옮김', effectiveDate: FUTURE })).status).toBeLessThan(300);
    }
  }, 120_000);

  it('준비 — 오늘 자리는 얼린 값, 지금 행은 그날부터의 자리', async () => {
    const p = await detail();
    expect(p.current.structureChanges).toBeGreaterThan(0);
    const rows = rowsOf(p);
    expect(rows.find((a: any) => a.id === ids.hours)).toMatchObject({ number: 2, liveNumber: 4, displaced: true });
    expect(rows.find((a: any) => a.id === ids.leave1)).toMatchObject({ number: 3, clauseNumber: 1, liveClauseNumber: 9, displaced: true });
    expect(rows.find((a: any) => a.id === ids.duty1)).toMatchObject({ number: 6, clauseNumber: 1, liveNumber: 8, displaced: true });
  });

  it('자리가 바뀌는 중인 조(오늘 조·그날부터의 조)에는 조문을 넣지 못한다', async () => {
    const cases: [Record<string, unknown>, string][] = [
      [{ number: 4, clauseNumber: 1 }, '오늘 제2조 → 그날부터 제4조'],
      [{ number: 2, title: '새 조' }, '오늘 제2조 → 그날부터 제4조'],
      [{ number: 2, clauseNumber: 1 }, '오늘 제2조 → 그날부터 제4조'],
      [{ number: 8, clauseNumber: 2 }, '오늘 제6조 → 그날부터 제8조'],
      [{ number: 6, clauseNumber: 2 }, '오늘 제6조 → 그날부터 제8조'],
    ];
    for (const [json, moved] of cases) {
      const r = await add(json);
      expect(r.status, JSON.stringify(json)).toBe(400);
      expect(String(r.body.message)).toContain(`${FUTURE}에 시행되는 구조 변경`);
      expect(String(r.body.message)).toContain(moved);
    }
    expect(rowsOf(await detail()).length).toBe(8);
  });

  it('같은 조 안에서 항 번호만 바뀌는 조문의 오늘 자리에는 넣지 못한다 — 그 조의 다른 항은 된다', async () => {
    const held = await add({ number: 3, clauseNumber: 1 });
    expect(held.status).toBe(400);
    expect(String(held.body.message)).toContain(`${FUTURE} 전까지 다른 조문이 쓰고`);
    expect((await add({ number: 3, clauseNumber: 3 })).status).toBe(201);
    expect((await add({ number: 9, title: '시행' })).status).toBe(201);
  });

  it('옮겨질 조문의 번호·제목을 고치면 그날부터의 자리만 바뀌고 오늘 자리는 그대로', async () => {
    const r = await put(ids.hours, { title: '근무 시간', number: 7 });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body).toMatchObject({ number: 7, title: '근무 시간' });
    expect(await rowOf(ids.hours)).toMatchObject({ number: 2, title: '근무시간', liveNumber: 7, liveTitle: '근무 시간', displaced: true });
    const today = rowsOf((await api(`/policies/${policyId}/as-of?date=${kstToday()}`, { token: t.token })).body);
    expect(today.find((a: any) => a.id === ids.hours)).toMatchObject({ number: 2, title: '근무시간' });
    const then = rowsOf((await api(`/policies/${policyId}/as-of?date=${FUTURE}`, { token: t.token })).body);
    expect(then.find((a: any) => a.id === ids.hours)).toMatchObject({ number: 7, title: '근무 시간' });
    // 그날 조가 바뀌었으니 제4조는 풀리고 제7조가 잠긴다
    expect((await add({ number: 4, title: '복장' })).status).toBe(201);
    const blocked = await add({ number: 7, clauseNumber: 1 });
    expect(blocked.status).toBe(400);
    expect(String(blocked.body.message)).toContain('오늘 제2조 → 그날부터 제7조');
  });

  it('다른 조문을 자리가 바뀌는 중인 조로 옮기지 못한다 — 같은 조 안에서 고치기, 오늘 조로 되돌리기는 된다', async () => {
    for (const number of [7, 8]) {
      const into = await put(ids.misc, { number });
      expect(into.status, `제${number}조`).toBe(400);
      expect(String(into.body.message)).toContain('자리가 바뀌는 중');
    }
    expect(await rowOf(ids.misc)).toMatchObject({ number: 5, liveNumber: 5 });
    // 당직 ①을 같은 조(그날 제8조) 안에서 ②로
    expect((await put(ids.duty1, { clauseNumber: 2 })).status).toBe(200);
    expect(await rowOf(ids.duty1)).toMatchObject({ number: 6, clauseNumber: 1, liveNumber: 8, liveClauseNumber: 2 });
    // 근무시간을 오늘 자리(제2조)로 되돌리면 옮기지 않게 된다
    expect((await put(ids.hours, { number: 2, title: '근무시간' })).status).toBe(200);
    expect(await rowOf(ids.hours)).toMatchObject({ number: 2, liveNumber: 2, displaced: false });
  });

  it('조 순서 재정렬은 그날 뒤에', async () => {
    const order = (await api(`/policies/${policyId}/jo-order`, { token: t.token })).body.order;
    const res = await api(`/policies/${policyId}/jo-order`, { method: 'PUT', token: t.token, json: { order: [...order].reverse() } });
    expect(res.status).toBe(400);
    expect(String(res.body.message)).toContain(`${FUTURE} 시행, 재파싱 묶음`);
    expect(String(res.body.message)).toContain('조 순서를 다시 매길 수 없습니다');
  });
});
