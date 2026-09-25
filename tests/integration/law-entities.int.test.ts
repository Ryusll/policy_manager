import { describe, it, expect, beforeAll } from 'vitest';
import { api, createTenant, waitForApi } from './helpers';

/**
 * T-100 법령 엔티티 — 통합.
 *
 * 다른 통합 테스트가 "테넌트끼리 못 본다"를 확인한다면, 여기는 반대다.
 * 법령은 **테넌트 공용**이어야 한다(ADR-0020). 나중에 누가 습관적으로 `tenantId`를
 * 붙이면 근로기준법이 고객사 수만큼 복제되고 이 테스트가 깨진다.
 *
 * 법제처 등록은 외부 호출이라 인증값이 없는 CI 에서는 건너뛴다. 권한·공용성 검사는
 * 외부 호출 없이 항상 돈다.
 */
describe('T-100 법령 엔티티', () => {
  let a: Awaited<ReturnType<typeof createTenant>>;
  let b: Awaited<ReturnType<typeof createTenant>>;
  let lawGoKrReady = false;

  beforeAll(async () => {
    await waitForApi();
    a = await createTenant('law-a');
    b = await createTenant('law-b');
    const status = await api('/lawgokr/status', { token: a.token });
    lawGoKrReady = status.status === 200 && status.body?.configured === true;
  }, 90_000);

  it('로그인 없이는 볼 수 없다', async () => {
    const res = await api('/laws');
    expect(res.status).toBe(401);
  });

  it('목록 조회는 로그인 사용자에게 열려 있다', async () => {
    const res = await api('/laws', { token: a.token });
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it('없는 법령 id 는 404', async () => {
    const res = await api('/laws/00000000-0000-4000-8000-000000000000', { token: a.token });
    expect(res.status).toBe(404);
  });

  it('MST 가 숫자가 아니면 400 (전역 검증 파이프)', async () => {
    const res = await api('/laws', { method: 'POST', token: a.token, json: { mst: 'abc' } });
    expect(res.status).toBe(400);
  });

  it.runIf(true)('법령원이 등록돼 있지 않으면 404', async () => {
    const res = await api('/laws', {
      method: 'POST',
      token: a.token,
      json: { mst: '1', sourceCode: '없는출처' },
    });
    expect(res.status).toBe(404);
  });

  describe('법제처 등록 (인증값이 있을 때만)', () => {
    it('등록하면 조·항·호가 저장되고, 다시 등록해도 쌓이지 않는다', async ({ skip }) => {
      if (!lawGoKrReady) return skip();

      const found = await api('/lawgokr/search?q=%EA%B7%BC%EB%A1%9C%EA%B8%B0%EC%A4%80%EB%B2%95&display=1', {
        token: a.token,
      });
      expect(found.status).toBe(200);
      const mst = found.body?.items?.[0]?.mst;
      expect(mst).toBeTruthy();

      const first = await api('/laws', { method: 'POST', token: a.token, json: { mst } });
      expect(first.status).toBe(200);
      expect(first.body.articleCount).toBeGreaterThan(0);
      expect(first.body.versionKey).toMatch(/^v\d+:[0-9a-f]{64}$/);

      const articles = await api(`/laws/${first.body.id}/articles`, { token: a.token });
      expect(articles.status).toBe(200);
      expect(articles.body.length).toBe(first.body.articleCount);
      // 법령 안에서 nodeKey 는 유일해야 한다 (제3조와 제3조의2 가 같은 칸에 들어가면 깨진다)
      const keys = articles.body.map((x: any) => x.nodeKey);
      expect(new Set(keys).size).toBe(keys.length);

      // ★ 테넌트 공용 — 다른 회사 계정으로도 같은 법령이 보여야 한다
      const fromB = await api(`/laws/${first.body.id}/articles`, { token: b.token });
      expect(fromB.status).toBe(200);
      expect(fromB.body.length).toBe(articles.body.length);

      // 재등록: 행이 쌓이지 않고 갱신된다. 내용이 같으면 지문도 같다
      const second = await api('/laws', { method: 'POST', token: a.token, json: { mst } });
      expect(second.status).toBe(200);
      expect(second.body.id).toBe(first.body.id);
      expect(second.body.articleCount).toBe(first.body.articleCount);
      expect(second.body.versionKey).toBe(first.body.versionKey);

      // ★ LawArticle.id 가 재등록 전후로 유지되어야 한다 — T-101 의 LawLink 가 이 id 를
      // 참조하므로, 재등록마다 id 가 바뀌면 만들어 둔 연결이 전부 끊긴다.
      const articlesAfter = await api(`/laws/${first.body.id}/articles`, { token: a.token });
      const idsBefore = articles.body.map((x: any) => x.id).sort();
      const idsAfter = articlesAfter.body.map((x: any) => x.id).sort();
      expect(idsAfter).toEqual(idsBefore);

      const removed = await api(`/laws/${first.body.id}`, { method: 'DELETE', token: a.token });
      expect(removed.status).toBe(200);
      const gone = await api(`/laws/${first.body.id}`, { token: a.token });
      expect(gone.status).toBe(404);
    }, 120_000);
  });
});
