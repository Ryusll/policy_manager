import { describe, it, expect, beforeAll } from 'vitest';
import { api, createTenant, createPolicyWithArticle, waitForApi } from './helpers';

/**
 * 가지 조문("제3조의2") — 조 하나 = (조 번호, 가지 번호).
 *
 * 예전에는 가지 번호를 담을 칸이 없어 가져오기가 "제3조의2"를 제4조로 바꾸고 뒤 조를 전부
 * 한 칸씩 밀었다. 원문·법령 인용과 번호가 어긋난다.
 */
describe('가지 조문 (제3조의2)', () => {
  let t: Awaited<ReturnType<typeof createTenant>>;
  let policyId: string;
  let chapterId: string;

  const add = async (json: Record<string, unknown>) =>
    api(`/policies/${policyId}/chapters/${chapterId}/articles`, { method: 'POST', token: t.token, json });
  const positions = async () => {
    const { body } = await api(`/policies/${policyId}`, { token: t.token });
    return body.chapters.flatMap((c: any) =>
      c.articles.map((a: any) => [a.number, a.branchNumber, a.clauseNumber, a.title]),
    );
  };

  beforeAll(async () => {
    await waitForApi();
    t = await createTenant('branch');
    const set = await createPolicyWithArticle(t.token, `BR-${Date.now().toString(36)}`);
    policyId = set.policy.id;
    chapterId = set.chapter.id;
    // 일부러 순서를 섞어 넣는다 — 정렬은 서버가 한다
    await add({ number: 4, title: '구성', content: '이사회는 이사로 구성한다.' });
    await add({ number: 3, branchNumber: 2, title: '경영철학의 실행', content: '' });
    await add({ number: 3, branchNumber: 2, clauseNumber: 1, title: '', content: '실천 방법을 개발한다.' });
    await add({ number: 3, title: '권한', content: '이사회는 의결한다.' });
  });

  it('제3조 다음, 제4조 앞에 제3조의2가 온다', async () => {
    expect(await positions()).toEqual([
      [1, null, null, '목적'],
      [3, null, null, '권한'],
      [3, 2, null, '경영철학의 실행'],
      [3, 2, 1, ''],
      [4, null, null, '구성'],
    ]);
  });

  it('가지 번호는 1 이상이어야 한다', async () => {
    const { status } = await add({ number: 5, branchNumber: 0, title: '잘못된 가지', content: '본문' });
    expect(status).toBe(400);
  });

  it('조 순서 화면의 시작점에 제3조의2가 따로 들어 있다', async () => {
    const { body } = await api(`/policies/${policyId}/jo-order`, { token: t.token });
    expect(body.order.map((o: any) => [o.jo, o.branch ?? null])).toEqual([
      [1, null],
      [3, null],
      [3, 2],
      [4, null],
    ]);
  });

  it('재정렬하면 항까지 함께 움직이고 차례 번호를 받아 가지 번호가 풀린다', async () => {
    const { body: current } = await api(`/policies/${policyId}/jo-order`, { token: t.token });
    const [jo1, jo3, jo3b2, jo4] = current.order;
    const res = await api(`/policies/${policyId}/jo-order`, {
      method: 'PUT',
      token: t.token,
      json: { order: [jo1, jo3b2, jo3, jo4] },
    });
    expect(res.status).toBe(200);
    expect(await positions()).toEqual([
      [1, null, null, '목적'],
      [2, null, null, '경영철학의 실행'],
      [2, null, 1, ''],
      [3, null, null, '권한'],
      [4, null, null, '구성'],
    ]);
  });
});
