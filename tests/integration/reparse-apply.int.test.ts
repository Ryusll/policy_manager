import { describe, it, expect, beforeAll } from 'vitest';
import { execSync } from 'child_process';
import { readFileSync } from 'fs';
import { join } from 'path';
import { BASE, api, createTenant, login, waitForApi } from './helpers';

/**
 * 재파싱 반영·묶음 승인 (T-110 ②, 특허 청구항 2·도 6 S650~S652) + 버전별 계층(PAT-04 최소안).
 *
 * 반영은 검토 대상 만들기다 — 기존 조문의 초안(본문·제안 계층)만 만들고 지금 본문·계층은 그대로 둔다. 새 조문·새 장은 승인 때 만든다.
 * 묶음 승인은 같은 시행일로 전부 되거나 전부 안 되고, 계층이 바뀌는 조문은 발행 이력을 얼려 그 전 날짜의 조회가 옛 계층으로 나온다.
 */
const FIXTURE = join(__dirname, '..', 'fixtures', 'regulation-sample.pdf');
const PW = 'Reparse!2345';
const kstDay = (offset = 0) => new Date(Date.now() + 9 * 3600_000 + offset * 86_400_000).toISOString().slice(0, 10);

function sql(statement: string): string {
  return execSync(`docker compose exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -t -A -f -'`, {
    encoding: 'utf8',
    input: statement,
  }).trim();
}

let seq = 0;
const node = (articleNumber: string, articleTitle: string, content: string, children: any[] = []) => ({
  id: `n${(seq += 1)}`,
  articleNumber,
  articleTitle,
  content,
  parentId: null,
  depth: 0,
  pageNumber: null,
  sortOrder: seq,
  children,
});

async function session(token: string, roots: any[]) {
  const form = new FormData();
  form.append('file', new Blob([readFileSync(FIXTURE)], { type: 'application/pdf' }), '휴가 규정.pdf');
  const res = await fetch(`${BASE}/regulation-parse/upload`, { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: form });
  let s = await res.json();
  for (let i = 0; i < 30 && s.status === 'processing'; i += 1) {
    await new Promise((r) => setTimeout(r, 500));
    s = (await api(`/regulation-parse/${s.id}`, { token })).body;
  }
  expect(s.status).toBe('ready');
  expect((await api(`/regulation-parse/${s.id}/tree`, { method: 'PATCH', token, json: { roots } })).status).toBe(200);
  return s.id as string;
}

async function commitPolicy(token: string, roots: any[], effectiveDate = '2024-01-01') {
  const sid = await session(token, roots);
  const commit = await api(`/regulation-parse/${sid}/commit`, {
    method: 'POST',
    token,
    json: { code: `RA-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`, title: '휴가 규정', effectiveDate },
  });
  expect(commit.status).toBe(201);
  const policyId = commit.body.policyId as string;
  const p = (await api(`/policies/${policyId}`, { token })).body;
  const ids: Record<string, string> = {};
  for (const a of p.chapters.flatMap((c: any) => c.articles)) ids[`${a.number}${a.clauseNumber ? `-${a.clauseNumber}` : ''}`] = a.id;
  return { policyId, ids };
}

const parsedItem = (r: any, label: string) => r.items.find((i: any) => i.parsed?.label === label);
const missingItem = (r: any, label: string) => r.items.find((i: any) => i.kind === 'missing' && i.stored?.label === label);
const versionsOf = async (token: string, articleId: string) => (await api(`/articles/${articleId}/versions`, { token })).body as any[];
const articlesOf = (p: any) => p.chapters.flatMap((c: any) => c.articles.map((a: any) => ({ ...a, chapterNumber: c.number, chapterTitle: c.title })));

describe('재파싱 반영·묶음 승인 (T-110 ②)', () => {
  let t: Awaited<ReturnType<typeof createTenant>>;
  let editorToken: string;

  beforeAll(async () => {
    await waitForApi();
    t = await createTenant('reparse-apply');
    // 시나리오마다 규정을 하나씩 만든다 — 기본 플랜의 규정 개수 상한에 걸리지 않게
    sql(`UPDATE tenants SET plan='enterprise' WHERE slug='${t.slug}';`);
    const email = `editor-${t.slug}@example.test`;
    await api('/users', { method: 'POST', token: t.token, json: { email, password: PW, name: '편집자', role: 'editor' } });
    editorToken = (await login(email, PW, t.slug)).body.accessToken;
  }, 120_000);

  describe('장이 끼어들고 조가 밀린 개정 — 반영 → 묶음 검토 요청 → 승인', () => {
    let policyId: string;
    let ids: Record<string, string>;
    let review: any;
    const today = kstDay();

    beforeAll(async () => {
      ({ policyId, ids } = await commitPolicy(t.token, [
        node('CH1', '총칙', '', [
          node('L1', '목적', '이 규정은 회사의 휴가 운영을 정한다.'),
          node('L2', '정의', '', [
            node('C1', '①', '"직원"이란 회사와 근로계약을 맺은 사람을 말한다.'),
            node('C2', '②', '"휴가"란 유급휴가를 말한다.'),
          ]),
        ]),
        node('CH2', '휴가', '', [
          node('L3', '연차휴가', '직원에게는 매년 15일의 연차휴가를 준다.'),
          node('L4', '신청', '휴가는 3일 전까지 운영팀에 신청한다.'),
          node('L5', '경과 조치', '이 조는 다음 개정에서 빠진다.'),
        ]),
      ]));
      // 새 제2조, 정의 ②를 고침, 새 장 "근무"와 제4조, 휴가 장이 제3장으로, 경과 조치는 빠짐
      const sid = await session(t.token, [
        node('CH1', '총칙', '', [
          node('L1', '목적', '이 규정은 회사의 휴가 운영을 정한다.'),
          node('L2', '적용 범위', '이 규정은 모든 직원에게 적용한다.'),
          node('L3', '정의', '', [
            node('C1', '①', '"직원"이란 회사와 근로계약을 맺은 사람을 말한다.'),
            node('C2', '②', '"휴가"란 유급휴가와 특별휴가를 말한다.'),
          ]),
        ]),
        node('CH2', '근무', '', [node('L4', '근무시간', '근무시간은 하루 8시간으로 한다.')]),
        node('CH3', '휴가', '', [
          node('L5', '연차휴가', '직원에게는 매년 15일의 연차휴가를 준다.'),
          node('L6', '신청', '휴가는 3일 전까지 운영팀에 신청한다.'),
        ]),
      ]);
      review = (await api(`/regulation-parse/${sid}/reparse`, { method: 'POST', token: editorToken, json: { policyId } })).body;
      expect(review.summary.counts).toMatchObject({ same: 1, moved: 4, changed: 1, new: 2, missing: 1 });
      expect(review.summary.chapters.map((c: any) => c.change)).toEqual(['same', 'new', 'renumbered']);
    }, 120_000);

    it('결정이 남으면 반영하지 않는다(400)', async () => {
      const res = await api(`/reparse-reviews/${review.id}/apply`, { method: 'POST', token: editorToken });
      expect(res.status).toBe(400);
      expect(String(res.body.message)).toContain('결정이 남은 항목');
    });

    it('반영 — 기존 조문의 묶음 초안(본문·제안 계층)만 만들고 지금 규정은 그대로', async () => {
      const decided = await api(`/reparse-reviews/${review.id}/decisions`, {
        method: 'PATCH',
        token: t.token,
        json: { items: [{ id: parsedItem(review, '제3조제2항').id, decision: 'amend' }, { id: missingItem(review, '제5조').id, decision: 'repeal' }] },
      });
      expect(decided.status).toBe(200);
      const before = (await api(`/policies/${policyId}`, { token: t.token })).body;
      const applied = await api(`/reparse-reviews/${review.id}/apply`, { method: 'POST', token: editorToken });
      expect(applied.status).toBe(201);
      review = applied.body;
      expect(review).toMatchObject({ status: 'applied', stale: false });
      expect(review.plan.chapters.create).toEqual([{ key: 'c1', number: 2, title: '근무', hidden: false }]);
      expect(review.plan.chapters.update).toEqual([expect.objectContaining({ number: 3, title: '휴가' })]);
      expect(review.plan.newArticles.map((n: any) => n.number)).toEqual([2, 4]);
      // 지금 규정: 장·조문·본문 그대로(새 장·새 조문 행도 없다)
      const now = (await api(`/policies/${policyId}`, { token: t.token })).body;
      expect(now.chapters.map((c: any) => [c.number, c.title])).toEqual(before.chapters.map((c: any) => [c.number, c.title]));
      expect(articlesOf(now).map((a: any) => [a.id, a.number])).toEqual(articlesOf(before).map((a: any) => [a.id, a.number]));
      // 연차휴가(옛 제3조): 본문 그대로, 제5조로 옮기는 제안 계층을 가진 묶음 초안
      const leave = await versionsOf(t.token, ids['3']);
      expect(leave[0]).toMatchObject({ status: 'draft', content: '직원에게는 매년 15일의 연차휴가를 준다.', reparseItemId: expect.any(String) });
      expect(leave[0].structure).toMatchObject({ kind: 'proposal', number: 5, base: { number: 3, chapter: { number: 2 } } });
      // 정의 ②: 원문 본문 + 제3조로 옮김
      const def2 = await versionsOf(t.token, ids['2-2']);
      expect(def2[0]).toMatchObject({ status: 'draft', content: '"휴가"란 유급휴가와 특별휴가를 말한다.' });
      expect(def2[0].structure).toMatchObject({ number: 3, clauseNumber: 2 });
      // 목적(그대로·장도 그대로): 초안 없음
      expect((await versionsOf(t.token, ids['1'])).length).toBe(1);
      expect(parsedItem(review, '제3조제2항').outcome).toMatchObject({ action: 'amend' });
      expect(parsedItem(review, '제2조').outcome).toMatchObject({ action: 'create' });
      expect(missingItem(review, '제5조').outcome).toMatchObject({ action: 'repeal', status: 'planned' });
      // 반영 뒤에는 결정을 바꾸지 않는다
      expect((await api(`/reparse-reviews/${review.id}/decisions`, { method: 'PATCH', token: t.token, json: { items: [] } })).status).toBe(409);
    });

    it('묶음 버전은 하나씩 검토 요청·승인·반려하지 못하고, 한꺼번에 시행에서도 빠진다', async () => {
      const draft = (await versionsOf(t.token, ids['3']))[0];
      expect((await api(`/versions/${draft.id}/submit`, { method: 'POST', token: editorToken })).status).toBe(409);
      const bulk = await api(`/policies/${policyId}/publish-drafts`, { method: 'POST', token: t.token, json: { changeNote: '시험', effectiveDate: today } });
      expect(bulk.body).toMatchObject({ published: 0 });
      expect((await versionsOf(t.token, ids['3']))[0].status).toBe('draft');
    });

    it('묶음 검토 요청 → 검토 중, 편집자는 승인할 수 없고 하나씩 승인·반려도 409', async () => {
      const submitted = await api(`/reparse-reviews/${review.id}/submit`, { method: 'POST', token: editorToken });
      expect(submitted.status).toBe(201);
      expect(submitted.body.status).toBe('submitted');
      const v = (await versionsOf(t.token, ids['3']))[0];
      expect(v.status).toBe('review');
      expect((await api(`/versions/${v.id}/approve`, { method: 'POST', token: t.token, json: { changeNote: 'x', effectiveDate: today } })).status).toBe(409);
      expect((await api(`/versions/${v.id}/reject`, { method: 'POST', token: t.token, json: { reason: 'x' } })).status).toBe(409);
      expect((await api(`/reparse-reviews/${review.id}/approve`, { method: 'POST', token: editorToken, json: { effectiveDate: today, changeNote: 'x' } })).status).toBe(403);
    });

    it('묶음 승인 — 같은 시행일로 후속 버전·새 조문·새 장·장 번호·폐지, 조문 식별자는 그대로', async () => {
      const approved = await api(`/reparse-reviews/${review.id}/approve`, {
        method: 'POST',
        token: t.token,
        json: { effectiveDate: today, changeNote: '취업규칙 개정 반영' },
      });
      expect(approved.status).toBe(201);
      expect(approved.body).toMatchObject({ status: 'approved', changeNote: '취업규칙 개정 반영' });
      const p = (await api(`/policies/${policyId}`, { token: t.token })).body;
      expect(p.chapters.map((c: any) => [c.number, c.title])).toEqual([
        [1, '총칙'],
        [2, '근무'],
        [3, '휴가'],
      ]);
      const placed = articlesOf(p).filter((a: any) => a.versions?.[0]);
      const at = (n: number, clause: number | null = null) => placed.find((a: any) => a.number === n && (a.clauseNumber ?? null) === clause);
      expect(at(5)).toMatchObject({ id: ids['3'], chapterNumber: 3 }); // 연차휴가 — 같은 조문 식별자
      expect(at(6)).toMatchObject({ id: ids['4'] });
      expect(at(3, 2)).toMatchObject({ id: ids['2-2'] });
      expect(at(3, 2).versions[0].content).toBe('"휴가"란 유급휴가와 특별휴가를 말한다.');
      expect(at(2)?.versions[0]).toMatchObject({ content: '이 규정은 모든 직원에게 적용한다.', status: 'published' });
      expect(at(4)).toMatchObject({ chapterNumber: 2 });
      // 본문 없는 조 머리 행(정의)은 버전 없이 행만 옮겼다
      expect(articlesOf(p).find((a: any) => a.id === ids['2'])).toMatchObject({ number: 3, title: '정의' });
      // 경과 조치는 오늘로 폐지
      const gone = await versionsOf(t.token, ids['5']);
      expect(gone[0]).toMatchObject({ status: 'archived', repealedOn: expect.stringContaining(today) });
      // 연차휴가: 새 버전(같은 본문) 시행, 옛 버전은 그때의 계층으로 얼림
      const leave = await versionsOf(t.token, ids['3']);
      expect(leave[0]).toMatchObject({ status: 'published', changeNote: '취업규칙 개정 반영', structure: null });
      expect(leave[1].structure).toMatchObject({ number: 3, chapter: { number: 2, title: '휴가' } });
      // 목적은 계층이 그대로라 얼리지 않는다
      expect((await versionsOf(t.token, ids['1']))[0].structure).toBeNull();
      expect(parsedItem(approved.body, '제2조').outcome).toMatchObject({ action: 'create', articleId: expect.any(String) });
      expect(missingItem(approved.body, '제5조').outcome).toMatchObject({ action: 'repeal', status: 'done', repealedOn: today });
      const audit = sql(`SELECT details->>'effectiveDate' FROM audit_logs WHERE action = 'reparse.approve' AND entity_id = '${policyId}'`);
      expect(audit).toBe(today);
    });

    it('시점 조회 — 승인 전 날짜는 그때의 장·조 번호로, 승인한 날부터는 새 계층으로', async () => {
      const yesterday = kstDay(-1);
      const old = (await api(`/policies/${policyId}/as-of?date=${yesterday}`, { token: t.token })).body;
      const oldArticles = articlesOf(old);
      expect(oldArticles.find((a: any) => a.id === ids['3'])).toMatchObject({ number: 3, chapterNumber: 2, chapterTitle: '휴가' });
      expect(oldArticles.find((a: any) => a.id === ids['4'])).toMatchObject({ number: 4 });
      expect(oldArticles.find((a: any) => a.id === ids['5'])).toMatchObject({ number: 5 });
      expect(oldArticles.find((a: any) => a.id === ids['2-1'])).toMatchObject({ number: 2, clauseNumber: 1 });
      expect(old.chapters.filter((c: any) => c.articles.length).map((c: any) => [c.number, c.title])).toEqual([
        [1, '총칙'],
        [2, '휴가'],
      ]);
      const now = (await api(`/policies/${policyId}/as-of?date=${today}`, { token: t.token })).body;
      expect(articlesOf(now).find((a: any) => a.id === ids['3'])).toMatchObject({ number: 5, chapterNumber: 3 });
      expect(now.asOf.repealedArticles.map((a: any) => [a.id, a.number])).toEqual([[ids['5'], 5]]);
      // 신구조문대비표도 그날의 번호로 맞댄다
      const cmp = (await api(`/policies/${policyId}/compare?from=${yesterday}&to=${today}`, { token: t.token })).body;
      expect(cmp.rows.find((r: any) => r.articleId === ids['3'])).toMatchObject({ kind: 'same', number: 5 });
    });

    it('바로잡기는 다른 조문의 얼린 자리로 옮기지 못한다', async () => {
      const p = (await api(`/policies/${policyId}`, { token: t.token })).body;
      const purpose = articlesOf(p).find((a: any) => a.id === ids['1']);
      const chapterId = p.chapters.find((c: any) => c.articles.some((a: any) => a.id === ids['1'])).id;
      const clash = await api(`/policies/${policyId}/chapters/${chapterId}/articles/${ids['1']}`, { method: 'PUT', token: t.token, json: { number: 4 } });
      expect(clash.status).toBe(400);
      expect(String(clash.body.message)).toContain('지난 계층 기록');
      const free = await api(`/policies/${policyId}/chapters/${chapterId}/articles/${ids['1']}`, { method: 'PUT', token: t.token, json: { number: 9 } });
      expect(free.status).toBe(200);
      expect((await api(`/policies/${policyId}/chapters/${chapterId}/articles/${ids['1']}`, { method: 'PUT', token: t.token, json: { number: purpose.number } })).status).toBe(200);
    });

    it('옮긴 조문을 뒤에 폐지하면 신구조문대비표의 삭제 행은 그때 번호(옛 제3조)로', async () => {
      const current = (await versionsOf(t.token, ids['3']))[0];
      expect((await api(`/versions/${current.id}/archive`, { method: 'POST', token: t.token })).status).toBe(200);
      const cmp = (await api(`/policies/${policyId}/compare?from=${kstDay(-1)}&to=${today}`, { token: t.token })).body;
      expect(cmp.rows.find((r: any) => r.articleId === ids['3'])).toMatchObject({ kind: 'removed', number: 3 });
    });
  });

  describe('반영 충돌·묶음 지문·반려', () => {
    it('묶음이 아닌 초안이 남은 조문은 반영하지 못하고(보류면 된다), 반영 뒤 규정이 바뀌면 검토 요청 409, 반려하면 초안을 거두고 다시 비교할 수 있다', async () => {
      const { policyId, ids } = await commitPolicy(t.token, [node('L1', '가', '하나 본문'), node('L2', '나', '둘 본문'), node('L3', '다', '셋 본문')]);
      expect((await api(`/articles/${ids['2']}/versions`, { method: 'POST', token: t.token, json: { content: '둘 본문 손질', changeNote: '작업 중' } })).status).toBe(201);
      const sid = await session(t.token, [node('L1', '가', '하나 본문 고침'), node('L2', '나', '둘 본문 고침'), node('L3', '다', '셋 본문')]);
      let review = (await api(`/regulation-parse/${sid}/reparse`, { method: 'POST', token: editorToken, json: { policyId } })).body;
      await api(`/reparse-reviews/${review.id}/decisions`, {
        method: 'PATCH',
        token: editorToken,
        json: { items: [{ id: parsedItem(review, '제1조').id, decision: 'amend' }, { id: parsedItem(review, '제2조').id, decision: 'amend' }] },
      });
      const blocked = await api(`/reparse-reviews/${review.id}/apply`, { method: 'POST', token: editorToken });
      expect(blocked.status).toBe(409);
      expect(String(blocked.body.message)).toContain('제2조(초안)');
      await api(`/reparse-reviews/${review.id}/decisions`, { method: 'PATCH', token: editorToken, json: { items: [{ id: parsedItem(review, '제2조').id, decision: 'hold' }] } });
      review = (await api(`/reparse-reviews/${review.id}/apply`, { method: 'POST', token: editorToken })).body;
      expect(review.status).toBe('applied');
      expect(parsedItem(review, '제2조').outcome).toMatchObject({ action: 'hold' });
      // 같은 원문은 다 썼다
      expect((await api(`/regulation-parse/${sid}/reparse`, { method: 'POST', token: editorToken, json: { policyId } })).status).toBe(400);

      // 반영 뒤 다른 초안이 생기면 묶음이 낡는다
      expect((await api(`/articles/${ids['3']}/versions`, { method: 'POST', token: t.token, json: { content: '셋 손질', changeNote: '작업' } })).status).toBe(201);
      expect((await api(`/reparse-reviews/${review.id}`, { token: editorToken })).body.stale).toBe(true);
      const late = await api(`/reparse-reviews/${review.id}/submit`, { method: 'POST', token: editorToken });
      expect(late.status).toBe(409);

      // 반려 — 편집자는 못 하고, 관리자는 사유와 함께. 묶음 초안은 거두고 원문은 다시 비교할 수 있다
      expect((await api(`/reparse-reviews/${review.id}/reject`, { method: 'POST', token: editorToken, json: { reason: 'x' } })).status).toBe(403);
      const rejected = await api(`/reparse-reviews/${review.id}/reject`, { method: 'POST', token: t.token, json: { reason: '규정이 그 사이 바뀜' } });
      expect(rejected.status).toBe(201);
      expect(rejected.body).toMatchObject({ status: 'rejected', rejectReason: '규정이 그 사이 바뀜' });
      expect((await versionsOf(t.token, ids['1'])).map((v) => v.status)).toEqual(['published']);
      expect((await api(`/regulation-parse/${sid}/reparse`, { method: 'POST', token: editorToken, json: { policyId } })).status).toBe(201);
    });
  });

  describe('새 조문으로 돌린 짝과 자리 겹침', () => {
    it('같은 자리를 새 조문으로 돌리면 기존 조문은 원문에 없음 항목이 된다 — 유지한 채 승인하면 같은 자리 둘이라 409, 폐지하면 된다', async () => {
      const { policyId, ids } = await commitPolicy(t.token, [node('L1', '가', '하나 본문'), node('L2', '나', '둘 본문'), node('L3', '다', '셋 본문')]);
      const sid = await session(t.token, [node('L1', '가', '하나 본문'), node('L2', '새', '전혀 다른 둘째 조'), node('L3', '다', '셋 본문')]);
      let review = (await api(`/regulation-parse/${sid}/reparse`, { method: 'POST', token: editorToken, json: { policyId } })).body;
      const second = parsedItem(review, '제2조');
      expect(second.kind).toBe('changed');
      review = (await api(`/reparse-reviews/${review.id}/decisions`, { method: 'PATCH', token: editorToken, json: { items: [{ id: second.id, decision: 'new' }] } })).body;
      const companion = missingItem(review, '제2조');
      expect(companion).toMatchObject({ articleId: ids['2'], decision: null, reasons: ['released'] });
      // 다시 개정으로 돌리면 그 항목을 거둔다
      review = (await api(`/reparse-reviews/${review.id}/decisions`, { method: 'PATCH', token: editorToken, json: { items: [{ id: second.id, decision: 'amend' }] } })).body;
      expect(missingItem(review, '제2조')).toBeUndefined();
      review = (await api(`/reparse-reviews/${review.id}/decisions`, { method: 'PATCH', token: editorToken, json: { items: [{ id: second.id, decision: 'new' }] } })).body;
      // 유지한 채 반영·검토 요청·승인 → 같은 자리 둘
      review = (await api(`/reparse-reviews/${review.id}/apply`, { method: 'POST', token: editorToken })).body;
      expect(review.plan.newArticles).toHaveLength(1);
      review = (await api(`/reparse-reviews/${review.id}/submit`, { method: 'POST', token: editorToken })).body;
      const clash = await api(`/reparse-reviews/${review.id}/approve`, { method: 'POST', token: t.token, json: { effectiveDate: kstDay(), changeNote: '개정' } });
      expect(clash.status).toBe(409);
      expect(String(clash.body.message)).toContain('같은 자리');
      // 반려하고 다시 비교 — 결정(새 조문)과 원문에 없음 항목의 폐지를 정해 다시
      await api(`/reparse-reviews/${review.id}/reject`, { method: 'POST', token: t.token, json: { reason: '폐지를 함께' } });
      review = (await api(`/regulation-parse/${sid}/reparse`, { method: 'POST', token: editorToken, json: { policyId } })).body;
      expect(parsedItem(review, '제2조').decision).toBe('new');
      const again = missingItem(review, '제2조');
      expect(again).toMatchObject({ articleId: ids['2'], reasons: ['released'] });
      review = (await api(`/reparse-reviews/${review.id}/decisions`, { method: 'PATCH', token: t.token, json: { items: [{ id: again.id, decision: 'repeal' }] } })).body;
      review = (await api(`/reparse-reviews/${review.id}/apply`, { method: 'POST', token: editorToken })).body;
      review = (await api(`/reparse-reviews/${review.id}/submit`, { method: 'POST', token: editorToken })).body;
      const ok = await api(`/reparse-reviews/${review.id}/approve`, { method: 'POST', token: t.token, json: { effectiveDate: kstDay(), changeNote: '개정' } });
      expect(ok.status).toBe(201);
      const p = (await api(`/policies/${policyId}`, { token: t.token })).body;
      const two = articlesOf(p).filter((a: any) => a.number === 2 && a.versions?.[0]);
      expect(two.map((a: any) => a.versions[0].content)).toEqual(['전혀 다른 둘째 조']);
      expect((await versionsOf(t.token, ids['2']))[0]).toMatchObject({ status: 'archived', repealedOn: expect.stringContaining(kstDay()) });
    });

    it('폐지로 정한 조문을 미래 시행일로 남기면 밀려온 조문과 같은 자리라 409 — 오늘로 승인하면 폐지까지 함께', async () => {
      const { policyId, ids } = await commitPolicy(t.token, [node('L1', '가', '하나 본문'), node('L2', '나', '둘 본문'), node('L3', '다', '셋 본문'), node('L4', '라', '넷 본문')]);
      // 새 제2조가 끼어들어 나·다가 밀리고, 라는 빠짐
      const sid = await session(t.token, [node('L1', '가', '하나 본문'), node('L2', '끼어든 조', '새 둘째 조 본문'), node('L3', '나', '둘 본문'), node('L4', '다', '셋 본문')]);
      let review = (await api(`/regulation-parse/${sid}/reparse`, { method: 'POST', token: editorToken, json: { policyId } })).body;
      review = (await api(`/reparse-reviews/${review.id}/decisions`, { method: 'PATCH', token: t.token, json: { items: [{ id: missingItem(review, '제4조').id, decision: 'repeal' }] } })).body;
      review = (await api(`/reparse-reviews/${review.id}/apply`, { method: 'POST', token: editorToken })).body;
      review = (await api(`/reparse-reviews/${review.id}/submit`, { method: 'POST', token: editorToken })).body;
      // 라(제4조)를 미래에 폐지로 남기면 다(옛 제3조)가 제4조로 오는 날 같은 자리 둘
      const future = kstDay(30);
      const clash = await api(`/reparse-reviews/${review.id}/approve`, { method: 'POST', token: t.token, json: { effectiveDate: future, changeNote: '개정' } });
      expect(clash.status).toBe(409);
      expect(String(clash.body.message)).toContain('같은 자리');
      expect((await api(`/reparse-reviews/${review.id}`, { token: t.token })).body.status).toBe('submitted');
      // 오늘로 승인하면 폐지까지 함께 된다
      const ok = await api(`/reparse-reviews/${review.id}/approve`, { method: 'POST', token: t.token, json: { effectiveDate: kstDay(), changeNote: '개정' } });
      expect(ok.status).toBe(201);
      expect(missingItem(ok.body, '제4조').outcome).toMatchObject({ status: 'done' });
      expect((await api(`/reparse-reviews/${review.id}/items/${missingItem(ok.body, '제4조').id}/resolve`, { method: 'POST', token: t.token, json: { decision: 'repeal' } })).status).toBe(409);
      void ids;
    });

    it('원문에 없는 조문을 미결(유지)로 두면 밀려온 조문과 같은 자리라 미래 시행일로도 409', async () => {
      const { policyId, ids } = await commitPolicy(t.token, [node('L1', '가', '하나 본문'), node('L2', '나', '둘 본문'), node('L3', '다', '셋 본문')]);
      // 다(제3조)가 빠지고, 나가 제3조로 밀리고 새 제2조
      const sid = await session(t.token, [node('L1', '가', '하나 본문'), node('L2', '끼어든 조', '새 둘째 조 본문'), node('L3', '나', '둘 본문')]);
      let review = (await api(`/regulation-parse/${sid}/reparse`, { method: 'POST', token: editorToken, json: { policyId } })).body;
      expect(missingItem(review, '제3조')).toBeTruthy();
      // 나(옛 제2조 → 제3조)는 뒤에 이웃이 없어 미리 고르지 않았다 — 사람이 옮김으로
      expect(parsedItem(review, '제3조')).toMatchObject({ kind: 'moved', recommended: false, decision: null });
      await api(`/reparse-reviews/${review.id}/decisions`, { method: 'PATCH', token: editorToken, json: { items: [{ id: parsedItem(review, '제3조').id, decision: 'accept' }] } });
      review = (await api(`/reparse-reviews/${review.id}/apply`, { method: 'POST', token: editorToken })).body;
      expect(review.status).toBe('applied');
      review = (await api(`/reparse-reviews/${review.id}/submit`, { method: 'POST', token: editorToken })).body;
      // 다(제3조)를 미결(유지)로 두면 나가 제3조로 오는 날 겹친다
      const future = kstDay(30);
      expect((await api(`/reparse-reviews/${review.id}/approve`, { method: 'POST', token: t.token, json: { effectiveDate: future, changeNote: '개정' } })).status).toBe(409);
      await api(`/reparse-reviews/${review.id}/reject`, { method: 'POST', token: t.token, json: { reason: '다를 다른 번호로' } });
      void ids;
    });
  });

  describe('미래 시행일 승인과 승인 뒤 원문에 없는 조문', () => {
    it('미래 시행일로 승인하면 지금 화면도 오늘의 시점 조회처럼 옛 계층(새 조문은 시행 예정으로), 그 날부터 새 계층', async () => {
      const { policyId, ids } = await commitPolicy(t.token, [node('L1', '가', '하나 본문'), node('L2', '나', '둘 본문'), node('L3', '다', '셋 본문')]);
      const sid = await session(t.token, [node('L1', '가', '하나 본문'), node('L2', '끼어든 조', '새 둘째 조 본문'), node('L3', '나', '둘 본문'), node('L4', '다', '셋 본문')]);
      let review = (await api(`/regulation-parse/${sid}/reparse`, { method: 'POST', token: editorToken, json: { policyId } })).body;
      expect(review.undecided).toBe(0);
      review = (await api(`/reparse-reviews/${review.id}/apply`, { method: 'POST', token: editorToken })).body;
      review = (await api(`/reparse-reviews/${review.id}/submit`, { method: 'POST', token: editorToken })).body;
      const future = kstDay(30);
      const ok = await api(`/reparse-reviews/${review.id}/approve`, { method: 'POST', token: t.token, json: { effectiveDate: future, changeNote: '다음 달 시행' } });
      expect(ok.status).toBe(201);
      // 지금 화면 = 오늘 시행 중인 본문과 오늘의 계층(T-127). 예전에는 published 를 그대로 보여 줘 시행일 전부터 새 계층이었다
      // — 그 기대는 T-127 이전 동작을 적어 둔 것이라 T-110 ② 담당 세션 확인 뒤 바꿨다(10/10)
      const detail = (await api(`/policies/${policyId}`, { token: t.token })).body;
      const current = articlesOf(detail).filter((a: any) => a.versions?.[0]);
      expect(current.map((a: any) => [a.id, a.number, a.versions[0].content])).toEqual([
        [ids['1'], 1, '하나 본문'],
        [ids['2'], 2, '둘 본문'],
        [ids['3'], 3, '셋 본문'],
      ]);
      // 끼어든 새 조문은 오늘 본문의 자리(제2조)를 차지하지 않고 시행 예정 목록에 있다
      expect(detail.current.scheduledArticles).toEqual([
        // 제정·개정이유 창이 쓰는 사유도 싣는다(T-132 ⑧ — 본문 목록에 없는 조문)
        expect.objectContaining({ number: 2, title: '끼어든 조', effectiveDate: future, changeNote: '다음 달 시행', versionId: expect.any(String) }),
      ]);
      // 옮겨질 조문은 오늘 자리로 보이고, 편집은 지금 행(새 자리)의 장으로 한다
      expect(articlesOf(detail).find((a: any) => a.id === ids['2'])).toMatchObject({
        number: 2,
        liveNumber: 3,
        displaced: true,
        liveChapterId: expect.any(String),
      });
      // 시행일 전까지 화면 자리와 지금 행이 달라 구조 편집을 막는다(T-127)
      expect(detail.current.structureChanges).toBeGreaterThan(0);
      const todayView = articlesOf((await api(`/policies/${policyId}/as-of?date=${kstDay()}`, { token: t.token })).body);
      expect(todayView.map((a: any) => [a.id, a.number])).toEqual([
        [ids['1'], 1],
        [ids['2'], 2],
        [ids['3'], 3],
      ]);
      const futureView = articlesOf((await api(`/policies/${policyId}/as-of?date=${future}`, { token: t.token })).body);
      expect(futureView.map((a: any) => a.number)).toEqual([1, 2, 3, 4]);
      expect(futureView.find((a: any) => a.id === ids['2'])).toMatchObject({ number: 3 });
    });

    it('시행일 전에도 구조를 고칠 수 있다 — 지금 행(그날부터의 자리)을 고치고, 자리가 바뀌는 중인 조에 넣는 것만 막는다(T-132 ⑦)', async () => {
      const { policyId, ids } = await commitPolicy(t.token, [node('L1', '가', '하나 본문'), node('L2', '나', '둘 본문'), node('L3', '다', '셋 본문')]);
      const sid = await session(t.token, [node('L1', '가', '하나 본문'), node('L2', '끼어든 조', '새 둘째 조 본문'), node('L3', '나', '둘 본문'), node('L4', '다', '셋 본문')]);
      let review = (await api(`/regulation-parse/${sid}/reparse`, { method: 'POST', token: editorToken, json: { policyId } })).body;
      review = (await api(`/reparse-reviews/${review.id}/apply`, { method: 'POST', token: editorToken })).body;
      review = (await api(`/reparse-reviews/${review.id}/submit`, { method: 'POST', token: editorToken })).body;
      const future = kstDay(30);
      expect((await api(`/reparse-reviews/${review.id}/approve`, { method: 'POST', token: t.token, json: { effectiveDate: future, changeNote: '다음 달 시행' } })).status).toBe(201);
      const chapterId = articlesOf((await api(`/policies/${policyId}`, { token: t.token })).body).find((a: any) => a.id === ids['1']).liveChapterId;
      const add = (json: Record<string, unknown>) =>
        api(`/policies/${policyId}/chapters/${chapterId}/articles`, { method: 'POST', token: t.token, json: { title: '', content: '새 본문', ...json } });
      // 나: 오늘 제2조 → 그날 제3조, 다: 오늘 제3조 → 그날 제4조 — 제2·3·4조에는 넣지 못한다
      for (const number of [2, 3, 4]) {
        const r = await add({ number, clauseNumber: 1 });
        expect(r.status, `제${number}조`).toBe(400);
        expect(String(r.body.message)).toContain(`${future}에 시행되는 구조 변경`);
      }
      expect((await add({ number: 5, title: '새 조' })).status).toBe(201);
      // 나의 제목 고치기 — 그날부터의 제목만 바뀌고 오늘은 그대로
      const put = await api(`/policies/${policyId}/chapters/${chapterId}/articles/${ids['2']}`, { method: 'PUT', token: t.token, json: { title: '나 고침' } });
      expect(put.status).toBe(200);
      const detail = (await api(`/policies/${policyId}`, { token: t.token })).body;
      expect(articlesOf(detail).find((a: any) => a.id === ids['2'])).toMatchObject({ number: 2, title: '나', liveNumber: 3, liveTitle: '나 고침' });
      const futureView = articlesOf((await api(`/policies/${policyId}/as-of?date=${future}`, { token: t.token })).body);
      expect(futureView.find((a: any) => a.id === ids['2'])).toMatchObject({ number: 3, title: '나 고침' });
    });

    it('승인 뒤 원문에 없는 조문 — 유지로 닫거나 관리자가 오늘 폐지, 승인 전에는 따로 정하지 않는다', async () => {
      const { policyId, ids } = await commitPolicy(t.token, [node('L1', '가', '하나 본문'), node('L2', '나', '둘 본문'), node('L3', '다', '셋 본문'), node('L4', '라', '넷 본문')]);
      const sid = await session(t.token, [node('L1', '가', '하나 본문 고침'), node('L2', '나', '둘 본문')]);
      let review = (await api(`/regulation-parse/${sid}/reparse`, { method: 'POST', token: editorToken, json: { policyId } })).body;
      await api(`/reparse-reviews/${review.id}/decisions`, { method: 'PATCH', token: editorToken, json: { items: [{ id: parsedItem(review, '제1조').id, decision: 'amend' }] } });
      review = (await api(`/reparse-reviews/${review.id}/apply`, { method: 'POST', token: editorToken })).body;
      const third = missingItem(review, '제3조');
      const fourth = missingItem(review, '제4조');
      expect((await api(`/reparse-reviews/${review.id}/items/${third.id}/resolve`, { method: 'POST', token: editorToken, json: { decision: 'keep' } })).status).toBe(409);
      review = (await api(`/reparse-reviews/${review.id}/submit`, { method: 'POST', token: editorToken })).body;
      review = (await api(`/reparse-reviews/${review.id}/approve`, { method: 'POST', token: t.token, json: { effectiveDate: kstDay(), changeNote: '개정' } })).body;
      expect(review.status).toBe('approved');
      const kept = await api(`/reparse-reviews/${review.id}/items/${third.id}/resolve`, { method: 'POST', token: editorToken, json: { decision: 'keep' } });
      expect(kept.status).toBe(201);
      expect(missingItem(kept.body, '제3조')).toMatchObject({ decision: 'keep', outcome: { action: 'keep' } });
      expect((await api(`/reparse-reviews/${review.id}/items/${fourth.id}/resolve`, { method: 'POST', token: editorToken, json: { decision: 'repeal' } })).status).toBe(403);
      const repealed = await api(`/reparse-reviews/${review.id}/items/${fourth.id}/resolve`, { method: 'POST', token: t.token, json: { decision: 'repeal' } });
      expect(repealed.status).toBe(201);
      expect(missingItem(repealed.body, '제4조').outcome).toMatchObject({ action: 'repeal', status: 'done', repealedOn: kstDay() });
      expect((await versionsOf(t.token, ids['4']))[0]).toMatchObject({ status: 'archived', repealedOn: expect.stringContaining(kstDay()) });
      expect((await api(`/reparse-reviews/${review.id}/items/${fourth.id}/resolve`, { method: 'POST', token: t.token, json: { decision: 'repeal' } })).status).toBe(409);
      expect((await api(`/reparse-reviews/${review.id}/items/${parsedItem(review, '제1조').id}/resolve`, { method: 'POST', token: t.token, json: { decision: 'keep' } })).status).toBe(400);
      expect((await api(`/policies/${policyId}/reparse-reviews`, { token: editorToken })).body[0]).toMatchObject({ status: 'approved', deletionUndecided: 0 });
    });
  });

  describe('단계마다 다시 확인', () => {
    it('비교한 뒤 규정이 바뀌거나 원문 트리를 고치면 반영하지 못한다', async () => {
      const { policyId, ids } = await commitPolicy(t.token, [node('L1', '가', '하나 본문'), node('L2', '나', '둘 본문')]);
      const sid = await session(t.token, [node('L1', '가', '하나 본문 고침'), node('L2', '나', '둘 본문')]);
      let review = (await api(`/regulation-parse/${sid}/reparse`, { method: 'POST', token: editorToken, json: { policyId } })).body;
      await api(`/reparse-reviews/${review.id}/decisions`, { method: 'PATCH', token: editorToken, json: { items: [{ id: parsedItem(review, '제1조').id, decision: 'amend' }] } });
      expect((await api(`/articles/${ids['2']}/versions`, { method: 'POST', token: t.token, json: { content: '둘 손질', changeNote: '작업' } })).status).toBe(201);
      const stale = await api(`/reparse-reviews/${review.id}/apply`, { method: 'POST', token: editorToken });
      expect(stale.status).toBe(409);
      expect(String(stale.body.message)).toContain('비교한 뒤 이 규정이 바뀌었습니다');
      review = (await api(`/regulation-parse/${sid}/reparse`, { method: 'POST', token: editorToken, json: { policyId } })).body;
      expect(parsedItem(review, '제1조').decision).toBe('amend');
      expect((await api(`/regulation-parse/${sid}/tree`, { method: 'PATCH', token: editorToken, json: { roots: [node('L1', '가', '하나 본문 또 고침'), node('L2', '나', '둘 본문')] } })).status).toBe(200);
      const edited = await api(`/reparse-reviews/${review.id}/apply`, { method: 'POST', token: editorToken });
      expect(edited.status).toBe(409);
      expect(String(edited.body.message)).toContain('원문 미리보기를 고쳤습니다');
    });

    it('검토 요청한 뒤 규정이 바뀌거나 묶음 본문이 몰래 바뀌면 승인 409', async () => {
      const one = await commitPolicy(t.token, [node('L1', '가', '하나 본문'), node('L2', '나', '둘 본문')]);
      const two = await commitPolicy(t.token, [node('L1', '가', '하나 본문'), node('L2', '나', '둘 본문')]);
      const submitted = async (policyId: string) => {
        const sid = await session(t.token, [node('L1', '가', '하나 본문 고침'), node('L2', '나', '둘 본문')]);
        let review = (await api(`/regulation-parse/${sid}/reparse`, { method: 'POST', token: editorToken, json: { policyId } })).body;
        await api(`/reparse-reviews/${review.id}/decisions`, { method: 'PATCH', token: editorToken, json: { items: [{ id: parsedItem(review, '제1조').id, decision: 'amend' }] } });
        review = (await api(`/reparse-reviews/${review.id}/apply`, { method: 'POST', token: editorToken })).body;
        review = (await api(`/reparse-reviews/${review.id}/submit`, { method: 'POST', token: editorToken })).body;
        expect(review.status).toBe('submitted');
        return review;
      };
      const r1 = await submitted(one.policyId);
      expect((await api(`/articles/${one.ids['2']}/versions`, { method: 'POST', token: t.token, json: { content: '둘 손질', changeNote: '작업' } })).status).toBe(201);
      const late = await api(`/reparse-reviews/${r1.id}/approve`, { method: 'POST', token: t.token, json: { effectiveDate: kstDay(), changeNote: '개정' } });
      expect(late.status).toBe(409);
      expect(String(late.body.message)).toContain('검토 요청한 뒤');
      const r2 = await submitted(two.policyId);
      sql(`UPDATE article_versions SET content = content || ' 몰래' WHERE article_id = '${two.ids['1']}' AND reparse_item_id IS NOT NULL;`);
      expect((await api(`/reparse-reviews/${r2.id}/approve`, { method: 'POST', token: t.token, json: { effectiveDate: kstDay(), changeNote: '개정' } })).status).toBe(409);
    });

    it('그 조문에 더 늦은 시행본이 있으면 그보다 이른 날로 승인하지 못하고, 그 날이면 된다', async () => {
      const { policyId, ids } = await commitPolicy(t.token, [node('L1', '가', '하나 본문'), node('L2', '나', '둘 본문')]);
      const later = kstDay(60);
      const draft = (await api(`/articles/${ids['1']}/versions`, { method: 'POST', token: t.token, json: { content: '하나 본문(예정)', changeNote: '예정' } })).body;
      await api(`/versions/${draft.id}/submit`, { method: 'POST', token: t.token });
      expect((await api(`/versions/${draft.id}/approve`, { method: 'POST', token: t.token, json: { changeNote: '예정 개정', effectiveDate: later } })).status).toBe(200);
      const sid = await session(t.token, [node('L1', '가', '하나 본문(재파싱)'), node('L2', '나', '둘 본문')]);
      let review = (await api(`/regulation-parse/${sid}/reparse`, { method: 'POST', token: editorToken, json: { policyId } })).body;
      await api(`/reparse-reviews/${review.id}/decisions`, { method: 'PATCH', token: editorToken, json: { items: [{ id: parsedItem(review, '제1조').id, decision: 'amend' }] } });
      review = (await api(`/reparse-reviews/${review.id}/apply`, { method: 'POST', token: editorToken })).body;
      review = (await api(`/reparse-reviews/${review.id}/submit`, { method: 'POST', token: editorToken })).body;
      const early = await api(`/reparse-reviews/${review.id}/approve`, { method: 'POST', token: t.token, json: { effectiveDate: kstDay(), changeNote: '개정' } });
      expect(early.status).toBe(409);
      expect(String(early.body.message)).toContain(`${later} 시행본`);
      const ok = await api(`/reparse-reviews/${review.id}/approve`, { method: 'POST', token: t.token, json: { effectiveDate: later, changeNote: '개정' } });
      expect(ok.status).toBe(201);
      const asOf = (await api(`/policies/${policyId}/as-of?date=${later}`, { token: t.token })).body;
      expect(articlesOf(asOf).find((a: any) => a.id === ids['1']).versions[0].content).toBe('하나 본문(재파싱)');
    });

    it('폐지로 정한 조문이 번호가 바뀌는 장에 있으면 미래 시행일로 승인하지 못한다', async () => {
      const { policyId } = await commitPolicy(t.token, [
        node('CH1', '총칙', '', [node('L1', '가', '하나 본문')]),
        node('CH2', '휴가', '', [node('L2', '나', '둘 본문'), node('L3', '다', '셋 본문')]),
      ]);
      const sid = await session(t.token, [
        node('CH1', '총칙', '', [node('L1', '가', '하나 본문')]),
        node('CH2', '근무', '', [node('L2', '새 조', '새 둘째 조 본문')]),
        node('CH3', '휴가', '', [node('L3', '나', '둘 본문')]),
      ]);
      let review = (await api(`/regulation-parse/${sid}/reparse`, { method: 'POST', token: editorToken, json: { policyId } })).body;
      const decisions = [{ id: missingItem(review, '제3조').id, decision: 'repeal' }];
      if (!parsedItem(review, '제3조').decision) decisions.push({ id: parsedItem(review, '제3조').id, decision: 'accept' });
      review = (await api(`/reparse-reviews/${review.id}/decisions`, { method: 'PATCH', token: t.token, json: { items: decisions } })).body;
      review = (await api(`/reparse-reviews/${review.id}/apply`, { method: 'POST', token: editorToken })).body;
      review = (await api(`/reparse-reviews/${review.id}/submit`, { method: 'POST', token: editorToken })).body;
      const res = await api(`/reparse-reviews/${review.id}/approve`, { method: 'POST', token: t.token, json: { effectiveDate: kstDay(30), changeNote: '개정' } });
      expect(res.status).toBe(409);
      expect(String(res.body.message)).toContain('장·절에 있어');
    });

    it('폐지된 조문에 다시 잇는 묶음 초안은 한꺼번에 시행에서 빠지고, 묶음 승인으로 다시 시행된다(자리를 옮겨도 폐지 기간 조회는 그때 번호)', async () => {
      const { policyId, ids } = await commitPolicy(t.token, [node('L1', '가', '하나 본문'), node('L2', '나', '둘 본문')], kstDay(-10));
      const pub = (await versionsOf(t.token, ids['2']))[0];
      expect((await api(`/versions/${pub.id}/archive`, { method: 'POST', token: t.token })).status).toBe(200);
      // 폐지는 닷새 전이었던 것으로(폐지 기간의 시점 조회를 보려고)
      sql(`UPDATE article_versions SET repealed_on = '${kstDay(-5)}' WHERE id = '${pub.id}';`);
      const sid = await session(t.token, [node('L1', '가', '하나 본문'), node('L2', '새 조', '새 둘째 조 본문'), node('L3', '나', '둘 본문')]);
      let review = (await api(`/regulation-parse/${sid}/reparse`, { method: 'POST', token: editorToken, json: { policyId } })).body;
      const again = parsedItem(review, '제3조');
      expect(again).toMatchObject({ kind: 'ambiguous', candidates: [expect.objectContaining({ articleId: ids['2'], repealed: true })] });
      review = (await api(`/reparse-reviews/${review.id}/decisions`, { method: 'PATCH', token: editorToken, json: { items: [{ id: again.id, decision: 'pick', targetArticleId: ids['2'] }] } })).body;
      review = (await api(`/reparse-reviews/${review.id}/apply`, { method: 'POST', token: editorToken })).body;
      expect(review.status).toBe('applied');
      const bulk = await api(`/policies/${policyId}/publish-drafts`, { method: 'POST', token: t.token, json: { changeNote: '시험', effectiveDate: kstDay() } });
      expect(bulk.body).toMatchObject({ published: 0 });
      expect((await versionsOf(t.token, ids['2']))[0]).toMatchObject({ status: 'draft', reparseItemId: expect.any(String) });
      review = (await api(`/reparse-reviews/${review.id}/submit`, { method: 'POST', token: editorToken })).body;
      expect((await api(`/reparse-reviews/${review.id}/approve`, { method: 'POST', token: t.token, json: { effectiveDate: kstDay(), changeNote: '다시 시행' } })).status).toBe(201);
      const now = articlesOf((await api(`/policies/${policyId}/as-of?date=${kstDay()}`, { token: t.token })).body);
      expect(now.filter((a: any) => a.id === ids['2']).map((a: any) => a.number)).toEqual([3]);
      // 폐지 기간의 조회 — 폐지돼 뺀 조문은 그때 번호(제2조)로 알린다
      const during = (await api(`/policies/${policyId}/as-of?date=${kstDay(-3)}`, { token: t.token })).body;
      expect(during.asOf.repealedArticles.map((a: any) => [a.id, a.number])).toEqual([[ids['2'], 2]]);
    });

    it('조 순서 재정렬도 다른 조문의 얼린 자리로 옮기지 못한다', async () => {
      const { policyId } = await commitPolicy(t.token, [node('L1', '가', '하나 본문'), node('L2', '나', '둘 본문'), node('L3', '다', '셋 본문')]);
      const sid = await session(t.token, [node('L1', '가', '하나 본문'), node('L2', '끼어든 조', '새 둘째 조 본문'), node('L3', '나', '둘 본문'), node('L4', '다', '셋 본문')]);
      let review = (await api(`/regulation-parse/${sid}/reparse`, { method: 'POST', token: editorToken, json: { policyId } })).body;
      review = (await api(`/reparse-reviews/${review.id}/apply`, { method: 'POST', token: editorToken })).body;
      review = (await api(`/reparse-reviews/${review.id}/submit`, { method: 'POST', token: editorToken })).body;
      expect((await api(`/reparse-reviews/${review.id}/approve`, { method: 'POST', token: t.token, json: { effectiveDate: kstDay(), changeNote: '개정' } })).status).toBe(201);
      const order = (await api(`/policies/${policyId}/jo-order`, { token: t.token })).body.order;
      const res = await api(`/policies/${policyId}/jo-order`, { method: 'PUT', token: t.token, json: { order: [...order].reverse() } });
      expect(res.status).toBe(400);
      expect(String(res.body.message)).toContain('지난 계층 기록');
    });
  });
});
