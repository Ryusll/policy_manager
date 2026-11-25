import { describe, it, expect, beforeAll } from 'vitest';
import { api, createTenant, createPolicyWithArticle, waitForApi } from './helpers';

/**
 * 테넌트 격리 (T-41과 짝을 이루는 자동 검증).
 *
 * 이 시스템은 DB Row-Level Security를 쓰지 않고 애플리케이션이 매 쿼리에 `tenantId`를
 * 거는 방식이라, 한 군데만 빠져도 남의 회사 규정이 보인다. 코드 리뷰로만 막기에는
 * 위험해서 실제 요청으로 확인한다.
 */
describe('테넌트 격리', () => {
  let a: Awaited<ReturnType<typeof createTenant>>;
  let b: Awaited<ReturnType<typeof createTenant>>;
  let aPolicy: any;

  beforeAll(async () => {
    await waitForApi();
    [a, b] = await Promise.all([createTenant('iso-a'), createTenant('iso-b')]);
    aPolicy = (await createPolicyWithArticle(a.token, 'ISO-A-1', 'A사 인사규정')).policy;
  });

  it('목록에 남의 규정이 섞이지 않는다', async () => {
    const { status, body } = await api('/policies', { token: b.token });
    expect(status).toBe(200);
    expect(body.map((p: any) => p.id)).not.toContain(aPolicy.id);
  });

  it('ID를 알아도 남의 규정을 못 연다', async () => {
    const { status } = await api(`/policies/${aPolicy.id}`, { token: b.token });
    expect(status).toBe(404);
  });

  it('남의 규정을 수정할 수 없다', async () => {
    const { status } = await api(`/policies/${aPolicy.id}`, {
      method: 'PUT',
      token: b.token,
      json: { title: '탈취 시도' },
    });
    expect(status).toBe(404);

    // 원본이 그대로인지 소유자 쪽에서 확인한다
    const owner = await api(`/policies/${aPolicy.id}`, { token: a.token });
    expect(owner.body.title).toBe('A사 인사규정');
  });

  it('남의 규정을 삭제할 수 없다', async () => {
    const { status } = await api(`/policies/${aPolicy.id}`, { method: 'DELETE', token: b.token });
    expect(status).toBe(404);
    const owner = await api(`/policies/${aPolicy.id}`, { token: a.token });
    expect(owner.status).toBe(200);
  });

  it('남의 규정에 장을 붙일 수 없다', async () => {
    const { status } = await api(`/policies/${aPolicy.id}/chapters`, {
      method: 'POST',
      token: b.token,
      json: { number: 9, title: '침입' },
    });
    expect(status).toBe(404);
  });

  it('남의 규정을 상위로 지정할 수 없다', async () => {
    // T-71 체계도 경로. 여기가 뚫리면 남의 규정 제목이 체계도에 노출된다.
    const mine = (await createPolicyWithArticle(b.token, 'ISO-B-1')).policy;
    const { status } = await api(`/policies/${mine.id}`, {
      method: 'PUT',
      token: b.token,
      json: { parentId: aPolicy.id },
    });
    expect(status).toBe(404);
  });

  it('검색 결과에 남의 규정이 나오지 않는다', async () => {
    const { status, body } = await api(`/search?q=${encodeURIComponent('통합테스트')}`, {
      token: b.token,
    });
    expect(status).toBe(200);
    const text = JSON.stringify(body);
    expect(text).not.toContain(aPolicy.id);
  });
});
