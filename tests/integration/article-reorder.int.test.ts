import { describe, it, expect, beforeAll } from 'vitest';
import { api, createTenant, waitForApi } from './helpers';

/**
 * 조 순서 일괄 재정렬 (T-60).
 *
 * 가져온 규정은 조 순서가 원문과 어긋나거나 장이 잘못 잡히는 일이 잦다. 조 번호는
 * 장을 가로질러 이어지므로(제1장 제1·2조 → 제2장 제3조) 하나만 옮겨도 뒤가 전부 밀린다.
 */
describe('조 순서 재정렬 (T-60)', () => {
  let t: Awaited<ReturnType<typeof createTenant>>;
  let policyId: string;
  let ch1: string;
  let ch2: string;

  /** 제1장에 제1·2조(제2조엔 항 2개), 제2장에 제3조 */
  async function seed() {
    const policy = await api('/policies', {
      method: 'POST',
      token: t.token,
      json: { code: `RO-${Date.now().toString(36)}`, title: '재정렬 점검' },
    });
    policyId = policy.body.id;

    const c1 = await api(`/policies/${policyId}/chapters`, {
      method: 'POST',
      token: t.token,
      json: { number: 1, title: '총칙' },
    });
    const c2 = await api(`/policies/${policyId}/chapters`, {
      method: 'POST',
      token: t.token,
      json: { number: 2, title: '운영' },
    });
    ch1 = c1.body.id;
    ch2 = c2.body.id;

    const add = (chapterId: string, body: any) =>
      api(`/policies/${policyId}/chapters/${chapterId}/articles`, {
        method: 'POST',
        token: t.token,
        json: body,
      });

    await add(ch1, { number: 1, title: '목적', content: '제1조 본문' });
    await add(ch1, { number: 2, title: '적용범위', content: '제2조 본문' });
    await add(ch1, { number: 2, title: '', clauseNumber: 1, content: '제2조 제1항' });
    await add(ch1, { number: 2, title: '', clauseNumber: 2, content: '제2조 제2항' });
    await add(ch2, { number: 3, title: '운영원칙', content: '제3조 본문' });
  }

  /** 조 번호 → 장 배치를 평탄하게 훑는다 */
  async function readLayout() {
    const { body } = await api(`/policies/${policyId}`, { token: t.token });
    const rows: { jo: number; chapterId: string; clause: number | null; title: string }[] = [];
    for (const ch of body.chapters) {
      for (const a of ch.articles) {
        rows.push({ jo: a.number, chapterId: ch.id, clause: a.clauseNumber ?? null, title: a.title });
      }
    }
    return rows;
  }

  beforeAll(async () => {
    await waitForApi();
    t = await createTenant('reorder');
    await seed();
  });

  it('현재 조 차례를 돌려준다', async () => {
    const { status, body } = await api(`/policies/${policyId}/jo-order`, { token: t.token });
    expect(status).toBe(200);
    expect(body.order).toEqual([
      { chapterId: ch1, jo: 1 },
      { chapterId: ch1, jo: 2 },
      { chapterId: ch2, jo: 3 },
    ]);
  });

  it('마지막 조를 맨 앞으로 옮기면 나머지가 한 칸씩 밀린다', async () => {
    const { status, body } = await api(`/policies/${policyId}/jo-order`, {
      method: 'PUT',
      token: t.token,
      json: {
        order: [
          { chapterId: ch1, jo: 3 },
          { chapterId: ch1, jo: 1 },
          { chapterId: ch1, jo: 2 },
        ],
      },
    });
    expect(status).toBe(200);
    expect(body.changed).toBeGreaterThan(0);

    const rows = await readLayout();
    const byTitle = (title: string) => rows.find((r) => r.title === title)!;
    expect(byTitle('운영원칙').jo).toBe(1);
    expect(byTitle('목적').jo).toBe(2);
    expect(byTitle('적용범위').jo).toBe(3);
  });

  /** 조 하나는 여러 행이다 — 한 행만 움직이면 항이 엉뚱한 조에 붙는다 */
  it('조를 옮기면 그 조의 항도 함께 따라간다', async () => {
    const rows = await readLayout();
    const hangs = rows.filter((r) => r.clause != null);
    expect(hangs).toHaveLength(2);
    // '적용범위'(원래 제2조)가 제3조로 갔으므로 그 항들도 제3조여야 한다
    for (const h of hangs) expect(h.jo).toBe(3);
  });

  it('장 경계를 넘겨 옮기면 그 장으로 이동한다', async () => {
    await api(`/policies/${policyId}/jo-order`, {
      method: 'PUT',
      token: t.token,
      json: {
        order: [
          { chapterId: ch1, jo: 1 },
          { chapterId: ch2, jo: 2 },
          { chapterId: ch2, jo: 3 },
        ],
      },
    });
    const rows = await readLayout();
    const moved = rows.filter((r) => r.jo === 2);
    expect(moved.length).toBeGreaterThan(0);
    for (const r of moved) expect(r.chapterId).toBe(ch2);
  });

  it('바뀐 것이 없으면 아무것도 쓰지 않는다', async () => {
    const current = await api(`/policies/${policyId}/jo-order`, { token: t.token });
    const { body } = await api(`/policies/${policyId}/jo-order`, {
      method: 'PUT',
      token: t.token,
      json: { order: current.body.order },
    });
    expect(body.changed).toBe(0);
  });

  describe('거절해야 하는 입력', () => {
    it('조가 빠지면 400', async () => {
      // 재정렬은 순서만 바꾸는 일이다. 빠뜨린 채 저장되면 번호에 구멍이 남는다.
      const { status } = await api(`/policies/${policyId}/jo-order`, {
        method: 'PUT',
        token: t.token,
        json: { order: [{ chapterId: ch1, jo: 1 }, { chapterId: ch1, jo: 2 }] },
      });
      expect(status).toBe(400);
    });

    it('같은 조가 두 번 오면 400', async () => {
      const { status } = await api(`/policies/${policyId}/jo-order`, {
        method: 'PUT',
        token: t.token,
        json: {
          order: [
            { chapterId: ch1, jo: 1 },
            { chapterId: ch1, jo: 1 },
            { chapterId: ch1, jo: 2 },
          ],
        },
      });
      expect(status).toBe(400);
    });

    it('남의 규정 장으로는 옮길 수 없다', async () => {
      const other = await createTenant('reorder-b');
      const otherPolicy = await api('/policies', {
        method: 'POST',
        token: other.token,
        json: { code: `RO-OTHER-${Date.now().toString(36)}`, title: '남의 규정' },
      });
      const otherChapter = await api(`/policies/${otherPolicy.body.id}/chapters`, {
        method: 'POST',
        token: other.token,
        json: { number: 1, title: '남의 장' },
      });

      const { status } = await api(`/policies/${policyId}/jo-order`, {
        method: 'PUT',
        token: t.token,
        json: {
          order: [
            { chapterId: otherChapter.body.id, jo: 1 },
            { chapterId: ch1, jo: 2 },
            { chapterId: ch2, jo: 3 },
          ],
        },
      });
      expect(status).toBe(400);
    });

    it('남의 회사 규정은 재정렬할 수 없다', async () => {
      const other = await createTenant('reorder-c');
      const { status } = await api(`/policies/${policyId}/jo-order`, {
        method: 'PUT',
        token: other.token,
        json: { order: [{ chapterId: ch1, jo: 1 }] },
      });
      expect(status).toBe(404);
    });

    it('viewer 는 재정렬할 수 없다', async () => {
      const email = `viewer-${t.slug}@example.test`;
      await api('/users', {
        method: 'POST',
        token: t.token,
        json: { email, password: t.password, name: '뷰어', role: 'viewer' },
      });
      const r = await api('/auth/login', {
        method: 'POST',
        json: { email, password: t.password, tenantSlug: t.slug },
      });
      const current = await api(`/policies/${policyId}/jo-order`, { token: r.body.accessToken });
      const { status } = await api(`/policies/${policyId}/jo-order`, {
        method: 'PUT',
        token: r.body.accessToken,
        json: { order: current.body.order },
      });
      expect(status).toBe(403);
    });
  });

  it('재정렬이 감사 로그에 남는다', async () => {
    const { body } = await api('/audit-logs?limit=30', { token: t.token });
    expect(body.map((r: any) => r.action)).toContain('policy.articles.reorder');
  });
});
