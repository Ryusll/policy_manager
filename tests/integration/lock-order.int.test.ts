import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { api, createTenant, createPolicyWithArticle, waitForApi } from './helpers';
import { brief, expect409, sleepTrigger, sql, stillSleeping, waitForBlockedBy, waitForSleep } from './race';

/**
 * 잠금 순서·세기·기다림 (T-131 — T-110 재파싱 묶음 뒤 보강).
 *
 * 쓰기 경로는 **규정 → 조문(id 순) → 재파싱 검토 행** 순서로, `FOR NO KEY UPDATE` 로, 트랜잭션 제한보다 짧게 기다리며 잠근다.
 * HTTP 두 개를 그냥 보내면 거의 늘 차례로 처리돼 겹치지 않으므로, 한쪽 트랜잭션 안에서 잠시 멈추는 시험용 트리거(pg_sleep)를 걸고
 * 그 트리거가 실제로 멈춘 것을 확인한 뒤 다른 쪽을 보낸다. 기다려야 하는 쪽은 실제로 막혔는지(pg_blocking_pids)도 확인한다.
 * 트리거는 이 시험의 행에만 걸리고 끝나면 지운다(통합 시험 파일은 차례로 돈다).
 *
 * 막고 싶은 사고:
 * 1. **교착(40P01 → 500)** — 조문을 잡은 채 규정을 기다리는 경로(첫 시행이면 규정 시행일을 채우는 한꺼번에 시행·시행일 보정)와
 *    규정을 잡고 조문을 기다리는 경로(조 재정렬), 다시 비교와 반영.
 * 2. **반영이 바뀌는 중인 결정으로 만들어진다** — 반영이 검토 행을 잠그지 않고 결정을 읽었다(어느 쪽이 먼저든 결과가 맞아야 한다).
 * 3. **다시 비교가 방금 반영한 검토를 "지나감"으로 덮거나, 동시에 두 번 비교해 열린 검토가 둘이 된다.**
 * 4. **FK 확인까지 막힌다** — 묶음 승인 동안 같은 규정·조문에 의견·즐겨찾기·개정 후보를 넣는 일이 승인이 끝날 때까지 기다린다.
 * 5. **기다리다 500** — 긴 묶음 승인 뒤에 선 짧은 쓰기는 트랜잭션 제한(5초)에 걸리기 전에 409(잠시 뒤 다시)로 끝나야 한다.
 * 6. **원문에 없는 조문 폐지가 반만 된다** — 폐지만 커밋되고 항목 결과가 빠지거나, 함께 누른 유지가 폐지를 덮는다.
 */

const FIXTURE = join(__dirname, '..', 'fixtures', 'regulation-sample.pdf');
const BUSY = '다른 작업이 같은 규정을 고치는 중입니다';

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

async function parseSession(token: string, roots: any[]) {
  const form = new FormData();
  form.append('file', new Blob([readFileSync(FIXTURE)], { type: 'application/pdf' }), '잠금 규정.pdf');
  // 새 연결로 올린다(helpers.api — T-140, 막힌 이벤트 루프 뒤 끊긴 keep-alive 연결을 다시 쓰지 않게)
  let s = (await api('/regulation-parse/upload', { method: 'POST', token, body: form })).body;
  for (let i = 0; i < 30 && s.status === 'processing'; i += 1) {
    await new Promise((r) => setTimeout(r, 500));
    s = (await api(`/regulation-parse/${s.id}`, { token })).body;
  }
  expect(s.status).toBe('ready');
  expect((await api(`/regulation-parse/${s.id}/tree`, { method: 'PATCH', token, json: { roots } })).status).toBe(200);
  return s.id as string;
}

describe('T-131 잠금 순서·세기·기다림', () => {
  let t: Awaited<ReturnType<typeof createTenant>>;
  const today = new Date(Date.now() + 9 * 3_600_000).toISOString().slice(0, 10);
  // 개정 후보(FK 시험)용 법령 — 법제처 없이 DB 에 직접 심는다
  const sourceId = randomUUID();
  const lawId = randomUUID();
  const lawArt = randomUUID();
  const ev = randomUUID();

  beforeAll(async () => {
    await waitForApi();
    t = await createTenant('lock-order');
    sql(`UPDATE tenants SET plan='enterprise' WHERE slug='${t.slug}';`);
    sql(`
      INSERT INTO law_sources (id, code, name, base_url, updated_at) VALUES ('${sourceId}', 'it-${sourceId.slice(0, 8)}', '통합테스트', 'http://example.test', now());
      INSERT INTO laws (id, source_id, external_id, external_law_id, law_name, effective_date, updated_at)
        VALUES ('${lawId}', '${sourceId}', '900131', '990131', '잠금시험법', '${today}', now());
      INSERT INTO law_articles (id, law_id, node_key, article_no, clause_no, label, content, version_key, sort_order, updated_at)
        VALUES ('${lawArt}', '${lawId}', '9//', 9, NULL, '제9조', '목적은 잠금 순서를 시험하는 데 있다.', 'v1:k2', 1, now());
      INSERT INTO law_change_events (id, law_id, law_article_id, node_key, change_type, before_content, after_content, before_version_key, after_version_key, law_effective_date, received_via, amendments_processed_at)
        VALUES ('${ev}', '${lawId}', '${lawArt}', '9//', 'modified', '목적은 잠금 순서를 확인하는 데 있다.', '목적은 잠금 순서를 시험하는 데 있다.', 'v1:k1', 'v1:k2', '${today}', 'poll', now());
    `);
  }, 60_000);

  afterAll(() => {
    sql(`
      DELETE FROM amendment_candidates WHERE change_event_id = '${ev}';
      UPDATE article_versions SET change_event_id = NULL WHERE change_event_id = '${ev}';
      DELETE FROM laws WHERE id='${lawId}'; DELETE FROM law_sources WHERE id='${sourceId}';
    `);
  });

  /** 장 하나에 조문 둘(제1조·제2조) — 조 재정렬로 맞바꿀 수 있게 */
  async function twoArticles(title: string) {
    const { policy, chapter, article } = await createPolicyWithArticle(t.token, `LK-${Date.now().toString(36)}${(seq += 1)}`, title);
    const second = await api(`/policies/${policy.id}/chapters/${chapter.id}/articles`, {
      method: 'POST',
      token: t.token,
      json: { number: 2, title: '둘째', content: '둘째 조문의 본문이다.' },
    });
    expect(second.status).toBe(201);
    return { policyId: policy.id as string, chapterId: chapter.id as string, a1: article.id as string, a2: second.body.id as string };
  }
  const swap = (policyId: string, chapterId: string) =>
    api(`/policies/${policyId}/jo-order`, { method: 'PUT', token: t.token, json: { order: [{ chapterId, jo: 2 }, { chapterId, jo: 1 }] } });
  const numbersOf = (ids: string[]) => sql(`SELECT string_agg(number::text, ',' ORDER BY id) FROM articles WHERE id IN (${ids.map((i) => `'${i}'`).join(',')});`);

  describe('규정을 먼저 잠근다 — 규정 행을 고칠 수 있는 경로', () => {
    it('첫 시행(한꺼번에 시행)과 조 재정렬이 겹쳐도 둘 다 끝난다', async () => {
      const { policyId, chapterId, a1, a2 } = await twoArticles('첫 시행 규정');
      expect(sql(`SELECT effective_date IS NULL FROM policies WHERE id='${policyId}';`)).toBe('t');
      const before = numbersOf([a1, a2]);
      // 시행본으로 바꾸는 그 순간 멈춘다 — 예전에는 이때 조문만 잡고 있다가 끝에 규정 시행일을 채우려 규정을 기다렸다
      const drop = sleepTrigger('publish', 'article_versions', 'BEFORE', 'UPDATE',
        `NEW.article_id IN ('${a1}', '${a2}') AND NEW.status = 'published' AND OLD.status <> 'published'`, 2);
      try {
        const publish = api(`/policies/${policyId}/publish-drafts`, { method: 'POST', token: t.token, json: { changeNote: '제정', effectiveDate: '2024-01-01' } });
        await waitForSleep('publish');
        const reorder = swap(policyId, chapterId);
        await waitForBlockedBy('publish');
        const [p, r] = await Promise.all([publish, reorder]);
        expect(p.status, brief(p)).toBe(200);
        expect(r.status, brief(r)).toBe(200);
      } finally {
        drop();
      }
      expect(sql(`SELECT count(*) FROM article_versions WHERE article_id IN ('${a1}', '${a2}') AND status = 'published';`)).toBe('2');
      expect(sql(`SELECT effective_date::text FROM policies WHERE id='${policyId}';`)).toBe('2024-01-01');
      expect(numbersOf([a1, a2])).toBe(before.split(',').reverse().join(','));
    });

    it('시행일 보정과 조 재정렬이 겹쳐도 둘 다 끝난다', async () => {
      const { policyId, chapterId, a1, a2 } = await twoArticles('시행일 보정 규정');
      // 예전 가져오기처럼 시행일 없이 발행된 시행본, 규정 시행일도 비어 있다
      sql(`
        UPDATE article_versions SET status = 'published', effective_date = NULL, approved_at = now(), published_at = now() WHERE article_id IN ('${a1}', '${a2}');
        UPDATE policies SET effective_date = NULL WHERE id = '${policyId}';
      `);
      const before = numbersOf([a1, a2]);
      const drop = sleepTrigger('fill', 'article_versions', 'BEFORE', 'UPDATE',
        `NEW.article_id IN ('${a1}', '${a2}') AND OLD.effective_date IS NULL AND NEW.effective_date IS NOT NULL`, 2);
      try {
        const fill = api(`/policies/${policyId}/fill-effective-date`, { method: 'POST', token: t.token, json: { effectiveDate: '2019-03-01', reason: '이사회 의결록' } });
        await waitForSleep('fill');
        const reorder = swap(policyId, chapterId);
        await waitForBlockedBy('fill');
        const [f, r] = await Promise.all([fill, reorder]);
        expect(f.status, brief(f)).toBe(200);
        expect(f.body.updated).toBe(2);
        expect(r.status, brief(r)).toBe(200);
      } finally {
        drop();
      }
      expect(sql(`SELECT effective_date::text FROM policies WHERE id='${policyId}';`)).toBe('2019-03-01');
      expect(numbersOf([a1, a2])).toBe(before.split(',').reverse().join(','));
    });
  });

  describe('규정 시행일은 잠근 뒤 다시 읽는다', () => {
    for (const path of ['publish-drafts', 'fill-effective-date'] as const) {
      it(`규정 시행일을 고치는 사이 ${path === 'publish-drafts' ? '한꺼번에 시행' : '시행일 보정'}이 그 값을 덮지 않는다`, async () => {
        const { policyId, a1, a2 } = await twoArticles(`시행일 다툼 규정 ${path}`);
        if (path === 'fill-effective-date') {
          sql(`UPDATE article_versions SET status = 'published', effective_date = NULL, approved_at = now(), published_at = now() WHERE article_id IN ('${a1}', '${a2}');`);
        }
        sql(`UPDATE policies SET effective_date = NULL WHERE id = '${policyId}';`);
        // 규정 시행일을 직접 고치는 저장이 쓰는 순간 멈춘다 — 그동안 들어온 한꺼번에 시행·보정은 그 값을 모른 채 판단하면 덮어쓴다
        const drop = sleepTrigger(`pol_${path.slice(0, 4)}`, 'policies', 'BEFORE', 'UPDATE', `NEW.id = '${policyId}' AND NEW.effective_date = '2023-05-01'`, 2);
        try {
          const edit = api(`/policies/${policyId}`, { method: 'PUT', token: t.token, json: { effectiveDate: '2023-05-01' } });
          await waitForSleep(`pol_${path.slice(0, 4)}`);
          const bulk =
            path === 'publish-drafts'
              ? api(`/policies/${policyId}/publish-drafts`, { method: 'POST', token: t.token, json: { changeNote: '제정', effectiveDate: '2024-01-01' } })
              : api(`/policies/${policyId}/fill-effective-date`, { method: 'POST', token: t.token, json: { effectiveDate: '2024-01-01', reason: '의결록' } });
          await waitForBlockedBy(`pol_${path.slice(0, 4)}`);
          const [pa, b] = await Promise.all([edit, bulk]);
          expect(pa.status, brief(pa)).toBe(200);
          expect(b.status, brief(b)).toBe(200);
        } finally {
          drop();
        }
        // 먼저 커밋된 사람의 값이 남는다 — 뒤에 온 일괄 처리는 잠근 뒤 다시 읽어 이미 정해진 규정 시행일을 건드리지 않는다
        expect(sql(`SELECT effective_date::text FROM policies WHERE id='${policyId}';`)).toBe('2023-05-01');
        expect(sql(`SELECT count(*) FROM article_versions WHERE article_id IN ('${a1}', '${a2}') AND effective_date = '2024-01-01';`)).toBe('2');
      });
    }
  });

  describe('규정 정보·변수 연결', () => {
    it('규정 정보(부서·분류)를 동시에 고쳐도 서로 고친 값을 지우지 않는다 — 잠근 뒤 다시 읽어 고쳐 쓴다', async () => {
      const { policyId } = await twoArticles('정보 동시 고침 규정');
      const drop = sleepTrigger('meta', 'policies', 'BEFORE', 'UPDATE', `NEW.id = '${policyId}' AND NEW.metadata ? 'department'`, 2);
      try {
        const first = api(`/policies/${policyId}`, { method: 'PUT', token: t.token, json: { department: '인사팀' } });
        await waitForSleep('meta');
        const second = api(`/policies/${policyId}`, { method: 'PUT', token: t.token, json: { category: '복무' } });
        await waitForBlockedBy('meta');
        const [a, b] = await Promise.all([first, second]);
        expect(a.status, brief(a)).toBe(200);
        expect(b.status, brief(b)).toBe(200);
      } finally {
        drop();
      }
      expect(JSON.parse(sql(`SELECT metadata::text FROM policies WHERE id='${policyId}';`))).toMatchObject({ department: '인사팀', category: '복무' });
    });

    it('새 버전이 발행된 뒤 옛 버전의 변수 연결을 풀려 하면 409 — 새 버전으로 옮겨진 연결만 남는 일이 없게', async () => {
      const { a1 } = await twoArticles('옛 버전 연결 규정');
      sql(`UPDATE article_versions SET status = 'published', effective_date = '2024-01-01', approved_at = now(), published_at = now() WHERE article_id = '${a1}';`);
      const v1 = ((await api(`/articles/${a1}/versions`, { token: t.token })).body as any[])[0];
      const variable = await api('/variables', { method: 'POST', token: t.token, json: { key: `REL_${(seq += 1)}`, label: '연결 변수' } });
      const binding = await api(`/versions/${v1.id}/variable-bindings`, { method: 'POST', token: t.token, json: { variableId: variable.body.id, start: 6, end: 11, text: '통합테스트' } });
      expect(binding.status, brief(binding)).toBe(201);
      const v2 = await api(`/articles/${a1}/versions`, { method: 'POST', token: t.token, json: { content: v1.content } });
      expect((await api(`/versions/${v2.body.id}/submit`, { method: 'POST', token: t.token })).status).toBe(200);
      const ok = await api(`/versions/${v2.body.id}/approve`, { method: 'POST', token: t.token, json: { changeNote: '개정', effectiveDate: today } });
      expect(ok.status, brief(ok)).toBe(200);
      // 오늘 새 버전이 시행돼 옛 버전은 시행 중도 시행 예정도 아니다(문구는 T-132 ⑥)
      expect409(await api(`/variable-bindings/${binding.body.id}`, { method: 'DELETE', token: t.token }), '새 버전이 시행됐습니다');
      expect(sql(`SELECT count(*) FROM variable_bindings WHERE version_id = '${v2.body.id}' AND state <> 'released';`)).toBe('1');
    });
  });

  describe('지우는 규정을 기다린 쓰기', () => {
    it('규정을 지우는 동안 기다린 장·조문 만들기와 조 재정렬은 404 — 지워진 규정에 쓰다 500 이 나지 않는다', async () => {
      const { policyId, chapterId } = await twoArticles('지우는 규정');
      // 규정을 지우는 트랜잭션이 장을 지우는 순간 멈춘다(규정 행은 이미 지우기 잠금)
      const drop = sleepTrigger('del', 'chapters', 'BEFORE', 'DELETE', `OLD.policy_id = '${policyId}'`, 2);
      try {
        const removing = api(`/policies/${policyId}`, { method: 'DELETE', token: t.token });
        await waitForSleep('del');
        const waiting = Promise.all([
          api(`/policies/${policyId}/chapters`, { method: 'POST', token: t.token, json: { number: 2, title: '새 장' } }),
          api(`/policies/${policyId}/chapters/${chapterId}/articles`, { method: 'POST', token: t.token, json: { number: 3, title: '셋째', content: '셋째 본문' } }),
          swap(policyId, chapterId),
        ]);
        // 지우기 전에 확인을 통과해 잠금에서 기다린다 — 지운 뒤에 들어와 미리 확인에서 404 가 난 것과 가른다
        await waitForBlockedBy('del');
        const [ch, ar, ro] = await waiting;
        const del = await removing;
        expect([200, 204]).toContain(del.status);
        for (const res of [ch, ar, ro]) {
          expect(res.status, brief(res)).toBe(404);
          expect(String(res.body?.message), brief(res)).toContain('not found');
        }
      } finally {
        drop();
      }
      expect(sql(`SELECT count(*) FROM policies WHERE id='${policyId}';`)).toBe('0');
    });
  });

  describe('재파싱 — 규정 → 조문 → 검토 행', () => {
    /**
     * 조문 셋인 규정을 가져오고, 둘째를 바꾸고 셋째를 뺀 원문과 비교한 검토. `decide` 면 바뀐 조문을 "개정"으로 정해 둔다
     * (원문에 없는 셋째는 정하지 않아도 반영할 수 있다)
     */
    async function openReview(title: string, opts: { compare?: boolean; decide?: boolean } = {}) {
      const roots = [
        node('L1', '목적', '이 규정은 잠금 순서를 시험한다.'),
        node('L2', '대상', '이 규정은 모든 직원에게 적용한다.'),
        node('L3', '경과', '이 조는 다음 개정에서 빠진다.'),
      ];
      const sid0 = await parseSession(t.token, roots);
      const commit = await api(`/regulation-parse/${sid0}/commit`, {
        method: 'POST',
        token: t.token,
        json: { code: `LR-${Date.now().toString(36)}${(seq += 1)}`, title, effectiveDate: '2024-01-01' },
      });
      expect(commit.status).toBe(201);
      const policyId = commit.body.policyId as string;
      const articles = (await api(`/policies/${policyId}`, { token: t.token })).body.chapters.flatMap((c: any) => c.articles);
      const idOf = (n: number) => articles.find((a: any) => a.number === n).id as string;
      const sid = await parseSession(t.token, [roots[0], node('L2', '대상', '이 규정은 모든 직원과 파견 근로자에게 적용한다.')]);
      const out = { policyId, sid, a1: idOf(1), a2: idOf(2), a3: idOf(3), reviewId: '', changedId: '', missingId: '' };
      if (opts.compare === false) return out;
      const compared = await api(`/regulation-parse/${sid}/reparse`, { method: 'POST', token: t.token, json: { policyId } });
      expect(compared.status, brief(compared)).toBe(201);
      const changed = compared.body.items.find((i: any) => i.kind === 'changed');
      const missing = compared.body.items.find((i: any) => i.kind === 'missing');
      expect(changed?.articleId).toBe(out.a2);
      expect(missing?.articleId).toBe(out.a3);
      Object.assign(out, { reviewId: compared.body.id, changedId: changed.id, missingId: missing.id });
      if (opts.decide !== false) {
        const decided = await api(`/reparse-reviews/${out.reviewId}/decisions`, { method: 'PATCH', token: t.token, json: { items: [{ id: changed.id, decision: 'amend' }] } });
        expect(decided.status, brief(decided)).toBe(200);
      }
      return out;
    }
    const reviewRow = (id: string) => sql(`SELECT status FROM reparse_reviews WHERE id='${id}';`);
    const bundleDrafts = (reviewId: string, articleId?: string) =>
      sql(`SELECT count(*) FROM article_versions v JOIN reparse_review_items i ON i.id = v.reparse_item_id WHERE i.review_id='${reviewId}'${articleId ? ` AND v.article_id='${articleId}'` : ''};`);
    const apply = (id: string) => api(`/reparse-reviews/${id}/apply`, { method: 'POST', token: t.token });
    const compareAgain = (r: { sid: string; policyId: string }) => api(`/regulation-parse/${r.sid}/reparse`, { method: 'POST', token: t.token, json: { policyId: r.policyId } });
    const openReviews = (r: { sid: string; policyId: string }) => sql(`SELECT count(*) FROM reparse_reviews WHERE session_id='${r.sid}' AND policy_id='${r.policyId}' AND status='open';`);

    describe('결정과 반영', () => {
      it('반영이 먼저면 결정은 반영이 끝날 때까지 기다렸다가 409 — 반영은 읽은 결정 그대로', async () => {
        const r = await openReview('반영 먼저 규정');
        // 묶음 초안을 만드는 순간 멈춘다 — 결정은 이미 읽었다
        const drop = sleepTrigger('apply', 'article_versions', 'BEFORE', 'INSERT', `NEW.reparse_item_id IS NOT NULL AND NEW.article_id = '${r.a2}'`, 2);
        try {
          const applying = apply(r.reviewId);
          await waitForSleep('apply');
          const decide = api(`/reparse-reviews/${r.reviewId}/decisions`, { method: 'PATCH', token: t.token, json: { items: [{ id: r.changedId, decision: 'hold' }] } });
          await waitForBlockedBy('apply');
          const [a, d] = await Promise.all([applying, decide]);
          expect(a.status, brief(a)).toBe(201);
          expect409(d, '지나간 검토');
        } finally {
          drop();
        }
        expect(reviewRow(r.reviewId)).toBe('applied');
        expect(sql(`SELECT decision FROM reparse_review_items WHERE id='${r.changedId}';`)).toBe('amend');
        expect(bundleDrafts(r.reviewId, r.a2)).toBe('1');
      });

      it('결정이 먼저면 반영은 그 결정이 끝나길 기다렸다가 바뀐 결정대로 만든다', async () => {
        const r = await openReview('결정 먼저 규정');
        // 결정을 저장하는 순간 멈춘다 — "새 조문으로"로 바꾸면 그 조문의 개정 초안은 없어야 한다
        const drop = sleepTrigger('decide', 'reparse_review_items', 'BEFORE', 'UPDATE', `NEW.id = '${r.changedId}' AND NEW.decision = 'new'`, 2);
        try {
          const decide = api(`/reparse-reviews/${r.reviewId}/decisions`, { method: 'PATCH', token: t.token, json: { items: [{ id: r.changedId, decision: 'new' }] } });
          await waitForSleep('decide');
          const applying = apply(r.reviewId);
          await waitForBlockedBy('decide');
          const [d, a] = await Promise.all([decide, applying]);
          expect(d.status, brief(d)).toBe(200);
          expect(a.status, brief(a)).toBe(201);
        } finally {
          drop();
        }
        expect(reviewRow(r.reviewId)).toBe('applied');
        expect(bundleDrafts(r.reviewId, r.a2)).toBe('0');
        expect(sql(`SELECT jsonb_array_length(plan->'newArticles') FROM reparse_reviews WHERE id='${r.reviewId}';`)).toBe('1');
      });

      it('결정 중에 그 조문을 지워도 둘 다 끝난다 — 결정이 규정을 먼저 잡아 지우기와 엇갈리지 않는다', async () => {
        const r = await openReview('결정 중 지우기 규정');
        // "새 조문으로" 결정을 저장한 뒤(그 조문을 가리키는 짝 항목을 넣기 전) 멈춘다
        const drop = sleepTrigger('dec_del', 'reparse_review_items', 'AFTER', 'UPDATE', `NEW.id = '${r.changedId}' AND NEW.decision = 'new'`, 2);
        try {
          const decide = api(`/reparse-reviews/${r.reviewId}/decisions`, { method: 'PATCH', token: t.token, json: { items: [{ id: r.changedId, decision: 'new' }] } });
          await waitForSleep('dec_del');
          const chapterId = sql(`SELECT chapter_id FROM articles WHERE id='${r.a2}';`);
          const removing = api(`/policies/${r.policyId}/chapters/${chapterId}/articles/${r.a2}`, { method: 'DELETE', token: t.token });
          await waitForBlockedBy('dec_del');
          const [d, del] = await Promise.all([decide, removing]);
          expect(d.status, brief(d)).toBe(200);
          expect([200, 204]).toContain(del.status);
        } finally {
          drop();
        }
        expect(sql(`SELECT count(*) FROM articles WHERE id='${r.a2}';`)).toBe('0');
      });

      it('반영하는 동안 원문 미리보기를 고치면 기다렸다가 409 — 반영에 쓴 원문은 그대로', async () => {
        const r = await openReview('반영 중 원문 고침 규정');
        const drop = sleepTrigger('apply3', 'article_versions', 'BEFORE', 'INSERT', `NEW.reparse_item_id IS NOT NULL AND NEW.article_id = '${r.a2}'`, 2);
        try {
          const applying = apply(r.reviewId);
          await waitForSleep('apply3');
          const tree = api(`/regulation-parse/${r.sid}/tree`, { method: 'PATCH', token: t.token, json: { roots: [node('L1', '목적', '반영 중에 바꾼 본문')] } });
          await waitForBlockedBy('apply3');
          const [a, tr] = await Promise.all([applying, tree]);
          expect(a.status, brief(a)).toBe(201);
          expect409(tr, '원문을 다시 가져오세요');
        } finally {
          drop();
        }
        expect(sql(`SELECT parse_tree::text LIKE '%반영 중에 바꾼 본문%' FROM regulation_parse_sessions WHERE id='${r.sid}';`)).toBe('f');
      });

      it('반영을 동시에 두 번 눌러도 묶음은 하나 — 뒤는 409', async () => {
        const r = await openReview('두 번 반영 규정');
        const drop = sleepTrigger('apply2', 'article_versions', 'BEFORE', 'INSERT', `NEW.reparse_item_id IS NOT NULL AND NEW.article_id = '${r.a2}'`, 2);
        try {
          const first = apply(r.reviewId);
          await waitForSleep('apply2');
          const second = apply(r.reviewId);
          await waitForBlockedBy('apply2');
          const [a, b] = await Promise.all([first, second]);
          expect(a.status, brief(a)).toBe(201);
          expect409(b, '이미 반영했거나 지나간');
        } finally {
          drop();
        }
        expect(bundleDrafts(r.reviewId)).toBe('1');
      });
    });

    describe('다시 비교와 반영', () => {
      it('반영이 먼저면 다시 비교는 기다렸다가 "원문을 다시 가져와" 안내 — 반영한 검토는 "반영함" 그대로', async () => {
        const r = await openReview('반영 뒤 비교 규정');
        // 검토를 "반영함"으로 바꾼 뒤 커밋 전에 멈춘다 — 예전 다시 비교는 이 행을 지나감으로 덮었다
        const drop = sleepTrigger('applied', 'reparse_reviews', 'AFTER', 'UPDATE', `NEW.id = '${r.reviewId}' AND NEW.status = 'applied'`, 2);
        try {
          const applying = apply(r.reviewId);
          await waitForSleep('applied');
          const again = compareAgain(r);
          await waitForBlockedBy('applied');
          const [a, c] = await Promise.all([applying, again]);
          expect(a.status, brief(a)).toBe(201);
          // 반영은 원문을 한 번만 쓴다 — 기다린 비교는 그 사이 원문이 쓰였다고 알린다
          expect409(c, '원문을 다시 가져와');
        } finally {
          drop();
        }
        expect(reviewRow(r.reviewId)).toBe('applied');
        // 다시 보내면 미리 확인에서 막힌다(이미 쓴 원문) — 반영한 검토는 그대로, 묶음으로 검토 요청할 수 있다
        expect((await compareAgain(r)).status).toBe(400);
        expect(reviewRow(r.reviewId)).toBe('applied');
        expect(openReviews(r)).toBe('0');
        expect((await api(`/reparse-reviews/${r.reviewId}/submit`, { method: 'POST', token: t.token })).status).toBe(201);
      });

      it('다시 비교가 먼저면 앞 검토의 반영은 기다렸다가 409 — 열린 검토는 새 것 하나', async () => {
        const r = await openReview('비교 먼저 규정');
        // 새 검토를 넣는 순간 멈춘다(앞 검토는 이미 지나감으로 바꿨다)
        const drop = sleepTrigger('compare', 'reparse_reviews', 'BEFORE', 'INSERT', `NEW.session_id = '${r.sid}' AND NEW.policy_id = '${r.policyId}'`, 2);
        try {
          const again = compareAgain(r);
          await waitForSleep('compare');
          const applying = apply(r.reviewId);
          await waitForBlockedBy('compare');
          const [c, a] = await Promise.all([again, applying]);
          expect(c.status, brief(c)).toBe(201);
          expect409(a, '이미 반영했거나 지나간');
        } finally {
          drop();
        }
        expect(reviewRow(r.reviewId)).toBe('superseded');
        expect(bundleDrafts(r.reviewId)).toBe('0');
        expect(openReviews(r)).toBe('1');
      });

      it('다시 비교는 잠근 뒤 규정 상태를 다시 본다 — 비교하는 사이 장이 생기면 "다시 비교" 안내', async () => {
        const r = await openReview('비교 중 장 생김 규정', { compare: false });
        // 장을 넣는 트랜잭션이 규정을 잡은 채 멈춘다 — 비교는 잠그기 전에 계산을 마치고 그 뒤에 줄 선다
        const drop = sleepTrigger('chap', 'chapters', 'BEFORE', 'INSERT', `NEW.policy_id = '${r.policyId}'`, 2);
        try {
          const adding = api(`/policies/${r.policyId}/chapters`, { method: 'POST', token: t.token, json: { number: 2, title: '새 장' } });
          await waitForSleep('chap');
          const comparing = compareAgain(r);
          await waitForBlockedBy('chap');
          const [ch, c] = await Promise.all([adding, comparing]);
          expect(ch.status, brief(ch)).toBe(201);
          expect409(c, '다시 비교');
        } finally {
          drop();
        }
        expect(openReviews(r)).toBe('0');
        // 다시 보내면 새 장까지 본 비교가 열린다
        const retry = await compareAgain(r);
        expect(retry.status, brief(retry)).toBe(201);
        expect((await api(`/reparse-reviews/${retry.body.id}`, { token: t.token })).body.stale).toBe(false);
      });

      it('같은 원문을 동시에 두 번 비교해도 열린 검토는 하나 — 앞 것은 지나감', async () => {
        const r = await openReview('두 번 비교 규정', { compare: false });
        const drop = sleepTrigger('compare2', 'reparse_reviews', 'BEFORE', 'INSERT', `NEW.session_id = '${r.sid}' AND NEW.policy_id = '${r.policyId}'`, 2);
        try {
          const first = compareAgain(r);
          await waitForSleep('compare2');
          const second = compareAgain(r);
          await waitForBlockedBy('compare2');
          const [a, b] = await Promise.all([first, second]);
          expect(a.status, brief(a)).toBe(201);
          expect(b.status, brief(b)).toBe(201);
        } finally {
          drop();
        }
        expect(openReviews(r)).toBe('1');
        expect(sql(`SELECT count(*) FROM reparse_reviews WHERE session_id='${r.sid}' AND policy_id='${r.policyId}';`)).toBe('2');
      });
    });

    describe('묶음 승인 동안', () => {
      /** 반영·검토 요청까지 마친 묶음 */
      async function submitted(title: string) {
        const r = await openReview(title);
        expect((await apply(r.reviewId)).status).toBe(201);
        expect((await api(`/reparse-reviews/${r.reviewId}/submit`, { method: 'POST', token: t.token })).status).toBe(201);
        return r;
      }
      const approve = (id: string) =>
        api(`/reparse-reviews/${id}/approve`, { method: 'POST', token: t.token, json: { effectiveDate: today, changeNote: '원문 개정 반영' } });

      it('같은 규정·조문에 의견·즐겨찾기·개정 후보를 넣는 일은 기다리지 않고, 승인이 끝나기 전에 커밋된다', async () => {
        const r = await submitted('승인 중 FK 규정');
        expect((await api('/law-links', { method: 'POST', token: t.token, json: { lawArticleId: lawArt, articleId: r.a1, relationType: 'delegation', evidenceText: '목적' } })).status).toBe(201);
        const drop = sleepTrigger('approve', 'reparse_reviews', 'BEFORE', 'UPDATE', `NEW.id = '${r.reviewId}' AND NEW.status = 'approved'`, 2.5);
        try {
          const approving = approve(r.reviewId);
          await waitForSleep('approve');
          const started = Date.now();
          // 승인이 규정·모든 조문을 잡고 있는 동안 — 바뀌는 조문과 그대로인 조문, 규정 단위 즐겨찾기, 그대로인 조문의 개정 후보
          const [c1, c2, fav, gen] = await Promise.all([
            api(`/articles/${r.a2}/comments`, { method: 'POST', token: t.token, json: { content: '승인 중에 단 의견' } }),
            api(`/articles/${r.a1}/comments`, { method: 'POST', token: t.token, json: { content: '다른 조문 의견' } }),
            api('/favorites', { method: 'POST', token: t.token, json: { policyId: r.policyId, articleId: r.a1 } }),
            api('/amendments/generate', { method: 'POST', token: t.token, json: { changeEventId: ev } }),
          ]);
          const waited = Date.now() - started;
          expect(c1.status, brief(c1)).toBe(201);
          expect(c2.status, brief(c2)).toBe(201);
          expect([200, 201]).toContain(fav.status);
          expect(gen.status, brief(gen)).toBe(200);
          expect(waited).toBeLessThan(2000);
          // 승인 트랜잭션은 아직 멈춰 있는데 넣은 행은 이미 커밋돼 보인다
          expect(stillSleeping('approve')).toBe(true);
          expect(sql(`SELECT count(*) FROM article_comments WHERE article_id IN ('${r.a1}', '${r.a2}');`)).toBe('2');
          expect(sql(`SELECT count(*) FROM favorites WHERE policy_id='${r.policyId}';`)).toBe('1');
          expect(sql(`SELECT count(*) FROM amendment_candidates WHERE change_event_id='${ev}' AND article_id='${r.a1}';`)).toBe('1');
          const a = await approving;
          expect(a.status, brief(a)).toBe(201);
        } finally {
          drop();
        }
        expect(reviewRow(r.reviewId)).toBe('approved');
      });

      // 한 번에 기다리는 요청은 셋까지 — 기다리는 동안 커넥션을 하나씩 쥐어서, 코어가 둘인 CI 의 기본 풀(5)을 넘기지 않게
      it('긴 승인 뒤에 선 짧은 조문 쓰기(초안 쓰기·폐지·변수 연결)는 오래 기다리지 않고 409(잠시 뒤 다시)로 끝난다', async () => {
        const r = await submitted('승인 중 조문 쓰기 규정');
        // 승인 전에 준비 — 그대로인 조문(제1조)의 시행본과 이을 변수
        const a1v = ((await api(`/articles/${r.a1}/versions`, { token: t.token })).body as any[]).find((v) => v.status === 'published');
        const variable = await api('/variables', { method: 'POST', token: t.token, json: { key: `LOCK_${(seq += 1)}`, label: '잠금 변수' } });
        expect(variable.status, brief(variable)).toBe(201);
        // 승인이 기다림 한도(3초)보다 오래 규정·조문을 잡고 있다
        const drop = sleepTrigger('approve2', 'reparse_reviews', 'BEFORE', 'UPDATE', `NEW.id = '${r.reviewId}' AND NEW.status = 'approved'`, 4.5);
        try {
          const approving = approve(r.reviewId);
          await waitForSleep('approve2');
          const started = Date.now();
          const results = await Promise.all([
            api(`/articles/${r.a1}/versions`, { method: 'POST', token: t.token, json: { content: '승인 중에 쓴 초안' } }),
            api(`/versions/${a1v.id}/archive`, { method: 'POST', token: t.token }),
            api(`/versions/${a1v.id}/variable-bindings`, { method: 'POST', token: t.token, json: { variableId: variable.body.id, start: 6, end: 8, text: '잠금' } }),
          ]);
          const waited = Date.now() - started;
          const labels = ['초안 쓰기', '폐지', '변수 연결'];
          results.forEach((res, i) => expect409({ ...res, body: { ...res.body, message: `${labels[i]}: ${res.body?.message}` } }, BUSY));
          expect(waited).toBeLessThan(4_500);
          const a = await approving;
          expect(a.status, brief(a)).toBe(201);
        } finally {
          drop();
        }
        // 다시 보내면 된다
        expect((await api(`/articles/${r.a1}/versions`, { method: 'POST', token: t.token, json: { content: '승인 뒤에 쓴 초안' } })).status).toBe(201);
        expect((await api(`/versions/${a1v.id}/variable-bindings`, { method: 'POST', token: t.token, json: { variableId: variable.body.id, start: 6, end: 8, text: '잠금' } })).status).toBe(201);
      });

      it('긴 승인 뒤에 선 재파싱 쓰기(다른 검토의 결정·다시 비교)도 오래 기다리지 않고 409(잠시 뒤 다시)로 끝난다', async () => {
        const r = await submitted('승인 중 재파싱 쓰기 규정');
        // 같은 규정의 다른 원문으로 연 검토 하나, 또 다른 원문 하나
        const sid2 = await parseSession(t.token, [node('L1', '목적', '이 규정은 잠금 순서를 시험한다.'), node('L2', '대상', '이 규정은 모든 직원에게 적용하고 예외를 둔다.')]);
        const r2 = (await api(`/regulation-parse/${sid2}/reparse`, { method: 'POST', token: t.token, json: { policyId: r.policyId } })).body;
        const r2changed = r2.items.find((i: any) => i.kind === 'changed');
        const sid3 = await parseSession(t.token, [node('L1', '목적', '이 규정은 잠금 순서를 시험한다.')]);
        const drop = sleepTrigger('approve6', 'reparse_reviews', 'BEFORE', 'UPDATE', `NEW.id = '${r.reviewId}' AND NEW.status = 'approved'`, 4.5);
        try {
          const approving = approve(r.reviewId);
          await waitForSleep('approve6');
          const started = Date.now();
          const results = await Promise.all([
            api(`/reparse-reviews/${r2.id}/decisions`, { method: 'PATCH', token: t.token, json: { items: [{ id: r2changed.id, decision: 'hold' }] } }),
            api(`/regulation-parse/${sid3}/reparse`, { method: 'POST', token: t.token, json: { policyId: r.policyId } }),
          ]);
          const waited = Date.now() - started;
          const labels = ['결정', '다시 비교'];
          results.forEach((res, i) => expect409({ ...res, body: { ...res.body, message: `${labels[i]}: ${res.body?.message}` } }, BUSY));
          expect(waited).toBeLessThan(4_500);
          const a = await approving;
          expect(a.status, brief(a)).toBe(201);
        } finally {
          drop();
        }
      });

      it('반영한 뒤 등록된 변수가 새 조문 본문의 표식이 되면 승인하지 않는다 — 새 조문은 고칠 수 없으니 반려하고 다시 비교', async () => {
        const key = `LATE_${(seq += 1)}`;
        const sid0 = await parseSession(t.token, [node('L1', '목적', '이 규정은 표식을 시험한다.')]);
        const commit = await api(`/regulation-parse/${sid0}/commit`, {
          method: 'POST',
          token: t.token,
          json: { code: `LM-${Date.now().toString(36)}${(seq += 1)}`, title: '늦은 변수 규정', effectiveDate: '2024-01-01' },
        });
        const policyId = commit.body.policyId as string;
        const sid = await parseSession(t.token, [node('L1', '목적', '이 규정은 표식을 시험한다.'), node('L2', '근무', `근무시간은 {{${key}}}로 한다.`)]);
        const review = (await api(`/regulation-parse/${sid}/reparse`, { method: 'POST', token: t.token, json: { policyId } })).body;
        const items = review.items.filter((i: any) => i.kind === 'new' && !i.decision).map((i: any) => ({ id: i.id, decision: 'new' }));
        if (items.length) expect((await api(`/reparse-reviews/${review.id}/decisions`, { method: 'PATCH', token: t.token, json: { items } })).status).toBe(200);
        expect((await apply(review.id)).status).toBe(201);
        expect((await api(`/reparse-reviews/${review.id}/submit`, { method: 'POST', token: t.token })).status).toBe(201);
        // 반영 뒤에 변수를 등록하면 그 문구가 표식이 된다
        expect((await api('/variables', { method: 'POST', token: t.token, json: { key, label: '늦은 변수' } })).status).toBe(201);
        const a = await approve(review.id);
        expect(a.status, brief(a)).toBe(400);
        expect(String(a.body.message)).toContain('새 조문은 고칠 수 없으니 묶음을 반려');
        expect(reviewRow(review.id)).toBe('submitted');
      });

      it('승인과 반려가 겹치면 하나만 된다 — 뒤는 409, 반쯤 된 상태가 없다', async () => {
        const r = await submitted('승인 반려 겹침 규정');
        const drop = sleepTrigger('approve3', 'reparse_reviews', 'BEFORE', 'UPDATE', `NEW.id = '${r.reviewId}' AND NEW.status = 'approved'`, 2);
        try {
          const approving = approve(r.reviewId);
          await waitForSleep('approve3');
          const rejecting = api(`/reparse-reviews/${r.reviewId}/reject`, { method: 'POST', token: t.token, json: { reason: '겹친 반려' } });
          await waitForBlockedBy('approve3');
          const [a, j] = await Promise.all([approving, rejecting]);
          expect(a.status, brief(a)).toBe(201);
          expect409(j, '반영했거나 검토 요청한 묶음만');
        } finally {
          drop();
        }
        expect(reviewRow(r.reviewId)).toBe('approved');
        expect(sql(`SELECT count(*) FROM article_versions WHERE article_id='${r.a2}' AND status='published';`)).toBe('1');
        expect(sql(`SELECT count(*) FROM article_versions WHERE article_id='${r.a2}' AND status IN ('draft','review');`)).toBe('0');
      });
    });

    describe('계층 바로잡기와 묶음 승인', () => {
      it('승인이 조를 옮기는 동안 그 전 목록으로 보낸 조 재정렬은 400 — 승인한 자리를 되돌리지 않는다', async () => {
        // 가·나 → 가·신설·나 — 나는 제2조에서 제3조로 밀리고 새 제2조가 생긴다
        const sid0 = await parseSession(t.token, [node('L1', '가', '가 본문'), node('L2', '나', '나 본문')]);
        const commit = await api(`/regulation-parse/${sid0}/commit`, {
          method: 'POST',
          token: t.token,
          json: { code: `LJ-${Date.now().toString(36)}${(seq += 1)}`, title: '재정렬 겹침 규정', effectiveDate: '2024-01-01' },
        });
        expect(commit.status).toBe(201);
        const policyId = commit.body.policyId as string;
        const before = (await api(`/policies/${policyId}`, { token: t.token })).body;
        const chapterId = before.chapters[0].id as string;
        const ga = before.chapters[0].articles.find((a: any) => a.number === 1).id as string;
        const na = before.chapters[0].articles.find((a: any) => a.number === 2).id as string;
        const sid = await parseSession(t.token, [node('L1', '가', '가 본문'), node('L2', '신설', '신설 본문'), node('L3', '나', '나 본문')]);
        const review = (await api(`/regulation-parse/${sid}/reparse`, { method: 'POST', token: t.token, json: { policyId } })).body;
        const pick: Record<string, string> = { moved: 'accept', new: 'new', changed: 'amend' };
        const items = review.items.filter((i: any) => pick[i.kind] && !i.decision).map((i: any) => ({ id: i.id, decision: pick[i.kind] }));
        if (items.length) expect((await api(`/reparse-reviews/${review.id}/decisions`, { method: 'PATCH', token: t.token, json: { items } })).status).toBe(200);
        expect((await apply(review.id)).status).toBe(201);
        expect((await api(`/reparse-reviews/${review.id}/submit`, { method: 'POST', token: t.token })).status).toBe(201);
        const drop = sleepTrigger('approve4', 'reparse_reviews', 'BEFORE', 'UPDATE', `NEW.id = '${review.id}' AND NEW.status = 'approved'`, 2);
        try {
          const approving = api(`/reparse-reviews/${review.id}/approve`, { method: 'POST', token: t.token, json: { effectiveDate: today, changeNote: '원문 개정 반영' } });
          await waitForSleep('approve4');
          // 승인 전 목록(가·나)으로 만든 재정렬 — 나를 앞으로
          const reorder = api(`/policies/${policyId}/jo-order`, { method: 'PUT', token: t.token, json: { order: [{ chapterId, jo: 2 }, { chapterId, jo: 1 }] } });
          await waitForBlockedBy('approve4');
          const [a, ro] = await Promise.all([approving, reorder]);
          expect(a.status, brief(a)).toBe(201);
          expect(ro.status, brief(ro)).toBe(400);
        } finally {
          drop();
        }
        const after = (await api(`/policies/${policyId}`, { token: t.token })).body.chapters.flatMap((c: any) => c.articles);
        const numbers = after.map((x: any) => x.number).sort();
        expect(numbers).toEqual([1, 2, 3]);
        expect(after.find((x: any) => x.id === ga).number).toBe(1);
        expect(after.find((x: any) => x.id === na).number).toBe(3);
      });
      it('승인이 조를 더하는 동안 그 전 목록으로 보낸 조 재정렬도 400 — 얼린 자리와 겹치지 않아도 새 조가 빠진 차례로 다시 매기지 않는다', async () => {
        // 가·나 → 가·나·다 — 옮겨지는 조 없이 끝에 새 조만 생긴다(얼린 자리 검사로는 막히지 않는 경우)
        const sid0 = await parseSession(t.token, [node('L1', '가', '가 본문'), node('L2', '나', '나 본문')]);
        const commit = await api(`/regulation-parse/${sid0}/commit`, {
          method: 'POST',
          token: t.token,
          json: { code: `LK2-${Date.now().toString(36)}${(seq += 1)}`, title: '재정렬 덧붙임 규정', effectiveDate: '2024-01-01' },
        });
        const policyId = commit.body.policyId as string;
        const before = (await api(`/policies/${policyId}`, { token: t.token })).body;
        const chapterId = before.chapters[0].id as string;
        const ga = before.chapters[0].articles.find((a: any) => a.number === 1).id as string;
        const na = before.chapters[0].articles.find((a: any) => a.number === 2).id as string;
        const sid = await parseSession(t.token, [node('L1', '가', '가 본문'), node('L2', '나', '나 본문'), node('L3', '다', '다 본문')]);
        const review = (await api(`/regulation-parse/${sid}/reparse`, { method: 'POST', token: t.token, json: { policyId } })).body;
        const items = review.items.filter((i: any) => i.kind === 'new' && !i.decision).map((i: any) => ({ id: i.id, decision: 'new' }));
        if (items.length) expect((await api(`/reparse-reviews/${review.id}/decisions`, { method: 'PATCH', token: t.token, json: { items } })).status).toBe(200);
        expect((await apply(review.id)).status).toBe(201);
        expect((await api(`/reparse-reviews/${review.id}/submit`, { method: 'POST', token: t.token })).status).toBe(201);
        const drop = sleepTrigger('approve5', 'reparse_reviews', 'BEFORE', 'UPDATE', `NEW.id = '${review.id}' AND NEW.status = 'approved'`, 2);
        try {
          const approving = api(`/reparse-reviews/${review.id}/approve`, { method: 'POST', token: t.token, json: { effectiveDate: today, changeNote: '원문 개정 반영' } });
          await waitForSleep('approve5');
          const reorder = api(`/policies/${policyId}/jo-order`, { method: 'PUT', token: t.token, json: { order: [{ chapterId, jo: 2 }, { chapterId, jo: 1 }] } });
          await waitForBlockedBy('approve5');
          const [a, ro] = await Promise.all([approving, reorder]);
          expect(a.status, brief(a)).toBe(201);
          expect(ro.status, brief(ro)).toBe(400);
        } finally {
          drop();
        }
        const after = (await api(`/policies/${policyId}`, { token: t.token })).body.chapters.flatMap((c: any) => c.articles);
        expect(after.find((x: any) => x.id === ga).number).toBe(1);
        expect(after.find((x: any) => x.id === na).number).toBe(2);
        expect(after.map((x: any) => x.number).sort()).toEqual([1, 2, 3]);
      });
    });

    describe('승인 뒤 원문에 없는 조문', () => {
      async function approved(title: string) {
        const r = await openReview(title);
        expect((await apply(r.reviewId)).status).toBe(201);
        expect((await api(`/reparse-reviews/${r.reviewId}/submit`, { method: 'POST', token: t.token })).status).toBe(201);
        const a = await api(`/reparse-reviews/${r.reviewId}/approve`, { method: 'POST', token: t.token, json: { effectiveDate: today, changeNote: '원문 개정 반영' } });
        expect(a.status, brief(a)).toBe(201);
        return r;
      }
      const resolve = (r: { reviewId: string; missingId: string }, decision: 'keep' | 'repeal') =>
        api(`/reparse-reviews/${r.reviewId}/items/${r.missingId}/resolve`, { method: 'POST', token: t.token, json: { decision } });
      const outcomeOf = (itemId: string) => sql(`SELECT coalesce(outcome->>'action', '-') || ':' || coalesce(outcome->>'status', '-') FROM reparse_review_items WHERE id='${itemId}';`);

      it('폐지와 유지를 함께 누르면 폐지가 먼저 끝나고 유지는 409 — 폐지 결과를 덮지 않는다', async () => {
        const r = await approved('폐지 유지 겹침 규정');
        const drop = sleepTrigger('repeal', 'article_versions', 'BEFORE', 'UPDATE', `NEW.article_id = '${r.a3}' AND NEW.status = 'archived' AND OLD.status = 'published'`, 2);
        try {
          const repeal = resolve(r, 'repeal');
          await waitForSleep('repeal');
          const keep = resolve(r, 'keep');
          await waitForBlockedBy('repeal');
          const [p, k] = await Promise.all([repeal, keep]);
          expect(p.status, brief(p)).toBe(201);
          expect409(k, '이미 폐지한');
        } finally {
          drop();
        }
        expect(outcomeOf(r.missingId)).toBe('repeal:done');
        expect(sql(`SELECT count(*) FROM article_versions WHERE article_id='${r.a3}' AND status='archived' AND repealed_on IS NOT NULL;`)).toBe('1');
      });

      it('폐지 도중 항목 결과를 남기다 실패하면 폐지도 되돌린다 — 반만 된 폐지가 없다', async () => {
        const r = await approved('폐지 실패 규정');
        sql(`
          CREATE OR REPLACE FUNCTION t131_boom() RETURNS trigger LANGUAGE plpgsql AS $f$
          BEGIN
            IF NEW.id = '${r.missingId}' AND NEW.outcome->>'action' = 'repeal' THEN RAISE EXCEPTION 't131 boom'; END IF;
            RETURN NEW;
          END $f$;
          DROP TRIGGER IF EXISTS t131_boom ON reparse_review_items;
          CREATE TRIGGER t131_boom BEFORE UPDATE ON reparse_review_items FOR EACH ROW EXECUTE FUNCTION t131_boom();
        `);
        try {
          const p = await resolve(r, 'repeal');
          expect(p.status, brief(p)).toBe(500);
        } finally {
          sql(`DROP TRIGGER IF EXISTS t131_boom ON reparse_review_items; DROP FUNCTION IF EXISTS t131_boom();`);
        }
        expect(sql(`SELECT count(*) FROM article_versions WHERE article_id='${r.a3}' AND status='published' AND repealed_on IS NULL;`)).toBe('1');
        expect(outcomeOf(r.missingId)).not.toBe('repeal:done');
        // 고친 뒤 다시 누르면 된다
        expect((await resolve(r, 'repeal')).status).toBe(201);
        expect(outcomeOf(r.missingId)).toBe('repeal:done');
      });
    });
  });
});
