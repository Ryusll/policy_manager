import { describe, it, expect, beforeAll } from 'vitest';
import { api, createTenant, createPolicyWithArticle, waitForApi } from './helpers';

/**
 * 규정 간 비교 (T-91).
 *
 * 대조표 #13·#14 와 달리 **인용 관계가 없는 두 문서**를 나란히 놓는다.
 * 공유하는 조문 식별자가 없어 조·항·목 번호로 맞대므로, 그 한계가 응답에
 * 드러나야 한다(`summary.suspect`).
 *
 * 여기서 가장 중요한 건 **두 규정 모두 테넌트 소속인지 확인하는가** 다.
 * 기준 규정만 보고 대상 id 를 그대로 쓰면 남의 회사 규정 본문이 표에 실려 나간다.
 */
describe('규정 간 비교 (T-91)', () => {
  let t: Awaited<ReturnType<typeof createTenant>>;
  let leftId: string;
  let rightId: string;

  /**
   * 비교는 **게시된 본문**을 대상으로 한다(전문 보기와 같은 기준).
   * 조문만 만들면 draft 라 비교표에 잡히지 않으므로 여기서 시행까지 시킨다.
   */
  const addPublishedArticle = async (policyId: string, chapterId: string, body: any) => {
    const created = await api(`/policies/${policyId}/chapters/${chapterId}/articles`, {
      method: 'POST',
      token: t.token,
      json: body,
    });
    const versions = await api(`/articles/${created.body.id}/versions`, { token: t.token });
    const draft = versions.body[0];
    await api(`/versions/${draft.id}/submit`, { method: 'POST', token: t.token });
    await api(`/versions/${draft.id}/approve`, {
      method: 'POST',
      token: t.token,
      json: { changeNote: '최초 시행' },
    });
    return created.body;
  };

  beforeAll(async () => {
    await waitForApi();
    t = await createTenant('xcmp');
    const tag = Date.now().toString(36);

    const a = await createPolicyWithArticle(t.token, `XA-${tag}`, '본사 인사규정');
    leftId = a.policy.id;
    await addPublishedArticle(leftId, a.chapter.id, { number: 2, title: '적용범위', content: '본사에 적용한다.' });
    await addPublishedArticle(leftId, a.chapter.id, { number: 3, title: '휴가', content: '연차는 15일이다.' });

    const b = await createPolicyWithArticle(t.token, `XB-${tag}`, '지사 인사규정');
    rightId = b.policy.id;
    await addPublishedArticle(rightId, b.chapter.id, { number: 2, title: '적용범위', content: '지사에 적용한다.' });
    await addPublishedArticle(rightId, b.chapter.id, { number: 3, title: '징계', content: '징계는 3종이다.' });
    await addPublishedArticle(rightId, b.chapter.id, { number: 4, title: '보칙', content: '세부사항은 따로 정한다.' });
  }, 90_000);

  const compare = (policyId: string, targetId: string, token = t.token) =>
    api(`/policies/${policyId}/compare-with?targetId=${targetId}`, { token });

  it('두 규정을 조문 위치로 맞대어 돌려준다', async () => {
    const { status, body } = await compare(leftId, rightId);
    expect(status).toBe(200);
    expect(body.left.title).toBe('본사 인사규정');
    expect(body.right.title).toBe('지사 인사규정');
    expect(body.rows.length).toBeGreaterThan(0);
  });

  it('같은 번호·다른 본문은 다름으로 표시하고 낱말 diff 를 준다', async () => {
    const { body } = await compare(leftId, rightId);
    const row = body.rows.find((r: any) => r.number === 2 && r.clauseNumber == null);
    expect(row.kind).toBe('different');
    expect(row.diff).not.toBeNull();
  });

  /** 번호로 맞춘 짝이 실제로는 다른 조문일 수 있다는 신호가 나와야 한다 */
  it('번호는 같은데 제목이 다르면 의심 표시를 남긴다', async () => {
    const { body } = await compare(leftId, rightId);
    const row = body.rows.find((r: any) => r.number === 3 && r.clauseNumber == null);
    expect(row.titleDiffers).toBe(true);
    expect(body.summary.suspect).toBeGreaterThan(0);
  });

  it('한쪽에만 있는 조문을 구분한다', async () => {
    const { body } = await compare(leftId, rightId);
    const row = body.rows.find((r: any) => r.number === 4 && r.clauseNumber == null);
    expect(row.kind).toBe('right-only');
    expect(row.left).toBeNull();
  });

  it('같은 규정끼리는 400', async () => {
    const { status } = await compare(leftId, leftId);
    expect(status).toBe(400);
  });

  it('없는 규정은 404', async () => {
    const { status } = await compare(leftId, '00000000-0000-0000-0000-000000000000');
    expect(status).toBe(404);
  });

  describe('테넌트 격리', () => {
    /** 기준 규정만 확인하고 대상 id 를 그대로 쓰면 남의 회사 본문이 새어 나간다 */
    it('대상이 남의 회사 규정이면 404 이고 본문이 새지 않는다', async () => {
      const other = await createTenant('xcmp-b');
      const victim = await createPolicyWithArticle(
        other.token,
        `XV-${Date.now().toString(36)}`,
        '남의 회사 규정',
      );
      const res = await compare(leftId, victim.policy.id);
      expect(res.status).toBe(404);
      expect(JSON.stringify(res.body)).not.toContain('남의 회사');
    });

    it('기준 규정이 남의 것이어도 404', async () => {
      const other = await createTenant('xcmp-c');
      const { status } = await compare(leftId, rightId, other.token);
      expect(status).toBe(404);
    });
  });
});
