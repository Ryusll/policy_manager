import { describe, it, expect, beforeAll } from 'vitest';
import { api, createTenant, createPolicyWithArticle, waitForApi } from './helpers';

describe('규정 CRUD', () => {
  let t: Awaited<ReturnType<typeof createTenant>>;

  beforeAll(async () => {
    await waitForApi();
    t = await createTenant('crud');
  });

  it('만들고, 읽고, 고치고, 지운다', async () => {
    const created = await api('/policies', {
      method: 'POST',
      token: t.token,
      json: { code: 'CRUD-1', title: '취업규칙' },
    });
    expect(created.status).toBe(201);

    const read = await api(`/policies/${created.body.id}`, { token: t.token });
    expect(read.body.title).toBe('취업규칙');

    const updated = await api(`/policies/${created.body.id}`, {
      method: 'PUT',
      token: t.token,
      json: { title: '취업규칙(개정)' },
    });
    expect(updated.status).toBe(200);
    expect(updated.body.title).toBe('취업규칙(개정)');

    const removed = await api(`/policies/${created.body.id}`, { method: 'DELETE', token: t.token });
    expect(removed.status).toBe(204);
    const gone = await api(`/policies/${created.body.id}`, { token: t.token });
    expect(gone.status).toBe(404);
  });

  it('같은 코드를 두 번 쓸 수 없다', async () => {
    await api('/policies', { method: 'POST', token: t.token, json: { code: 'DUP-1', title: '첫번째' } });
    const second = await api('/policies', {
      method: 'POST',
      token: t.token,
      json: { code: 'DUP-1', title: '두번째' },
    });
    expect(second.status).toBeGreaterThanOrEqual(400);
  });

  it('DTO에 없는 필드를 보내면 요청을 거부한다', async () => {
    // 전역 ValidationPipe 의 forbidNonWhitelisted. 조용히 버리지 않고 400 이어야 한다.
    const { status } = await api('/policies', {
      method: 'POST',
      token: t.token,
      json: { code: 'WL-1', title: '화이트리스트', tenantId: '남의테넌트' },
    });
    expect(status).toBe(400);
  });

  it('장·조문을 붙이면 상세에 함께 나온다', async () => {
    const { policy } = await createPolicyWithArticle(t.token, 'TREE-1');
    const { body } = await api(`/policies/${policy.id}`, { token: t.token });
    expect(body.chapters).toHaveLength(1);
    expect(body.chapters[0].articles).toHaveLength(1);
    expect(body.chapters[0].articles[0].number).toBe(1);
  });
});

describe('버전 승인 워크플로', () => {
  let t: Awaited<ReturnType<typeof createTenant>>;
  let articleId: string;

  beforeAll(async () => {
    await waitForApi();
    t = await createTenant('ver');
    const made = await createPolicyWithArticle(t.token, 'VER-1');
    articleId = made.article.id;
  });

  it('draft → review → published 로 넘어간다', async () => {
    const versions = await api(`/articles/${articleId}/versions`, { token: t.token });
    expect(versions.status).toBe(200);
    const draft = versions.body.find((v: any) => v.status === 'draft');
    expect(draft, '조문 생성 시 draft 버전이 있어야 한다').toBeTruthy();

    const submitted = await api(`/versions/${draft.id}/submit`, { method: 'POST', token: t.token });
    expect(submitted.status).toBe(200);
    expect(submitted.body.status).toBe('review');

    // 사유 없이 승인하면 거부되어야 한다
    const noNote = await api(`/versions/${draft.id}/approve`, { method: 'POST', token: t.token });
    expect(noNote.status).toBe(400);

    // 승인에는 개정 사유가 필수다(이력을 남기지 않는 게시를 막는다)
    const approved = await api(`/versions/${draft.id}/approve`, {
      method: 'POST',
      token: t.token,
      json: { changeNote: '통합테스트 최초 제정', effectiveDate: '2026-01-01' },
    });
    expect(approved.status).toBe(200);
    expect(approved.body.status).toBe('published');
  });

  it('게시된 본문이 규정 상세에 나온다', async () => {
    const list = await api('/policies', { token: t.token });
    const target = list.body.find((p: any) => p.code === 'VER-1');
    const { body } = await api(`/policies/${target.id}`, { token: t.token });
    const article = body.chapters?.[0]?.articles?.[0];
    expect(article?.versions?.[0]?.content).toContain('통합테스트');
  });

  it('남의 테넌트 조문 버전은 보이지 않는다', async () => {
    const other = await createTenant('ver2');
    const { status, body } = await api(`/articles/${articleId}/versions`, { token: other.token });
    // 404 로 막히거나, 200 이라도 목록이 비어야 한다
    if (status === 200) expect(body).toHaveLength(0);
    else expect(status).toBe(404);
  });
});
