import { describe, it, expect, beforeAll } from 'vitest';
import { api, createTenant, createPolicyWithArticle, waitForApi } from './helpers';

/**
 * T-101 법령 관계 정보 — 통합.
 *
 * **테넌트 격리를 구현보다 먼저 보는 테스트다**(설계안 지시). `LawArticle`은 테넌트
 * 공용(T-100, ADR-0020)이라 `tenantId`가 없다 — `byLawArticle`이 tenantId 조건을
 * 빠뜨리면 다른 회사가 이 법에 어떻게 대응해 뒀는지가 그대로 보인다. 이 사고가
 * T-41에서 실제로 두 번 났던 형태(부모만 보고 자식의 tenantId 를 빠뜨림)와 같다.
 *
 * `articleId` 쪽 테넌트 검증(생성·조회 모두 `chapter.policy.tenantId` 경유)은 실제
 * `LawArticle` 없이도 검증 가능해 무조건 돈다. `byLawArticle` 교차 테넌트 확인과
 * suggest()는 진짜 등록된 법령조항이 있어야 해서 law.go.kr 인증값이 있을 때만 돈다
 * (T-100과 같은 이유 — 직접 Prisma로 시딩하면 이 파일만 DATABASE_URL 을 따로
 * 요구하게 돼 `test:int` 실행 방식이 갈라진다).
 */
describe('T-101 법령 관계 정보', () => {
  let a: Awaited<ReturnType<typeof createTenant>>;
  let b: Awaited<ReturnType<typeof createTenant>>;
  let lawGoKrReady = false;

  beforeAll(async () => {
    await waitForApi();
    a = await createTenant('law-links-a');
    b = await createTenant('law-links-b');
    const status = await api('/lawgokr/status', { token: a.token });
    lawGoKrReady = status.status === 200 && status.body?.configured === true;
  }, 90_000);

  it('로그인 없이는 볼 수 없다', async () => {
    const res = await api('/law-links?articleId=00000000-0000-4000-8000-000000000000');
    expect(res.status).toBe(401);
  });

  it('articleId·lawArticleId 를 둘 다 안 주면 400', async () => {
    const res = await api('/law-links', { token: a.token });
    expect(res.status).toBe(400);
  });

  it('articleId·lawArticleId 를 둘 다 주면 400', async () => {
    const res = await api('/law-links?articleId=x&lawArticleId=y', { token: a.token });
    expect(res.status).toBe(400);
  });

  describe('사내 조문 쪽 테넌트 경계 (법령조항 데이터 없이도 확인 가능)', () => {
    it('다른 테넌트의 조문으로는 조회할 수 없다 (404)', async () => {
      const { article } = await createPolicyWithArticle(a.token, `lla-${Date.now()}`);
      const res = await api(`/law-links?articleId=${article.id}`, { token: b.token });
      expect(res.status).toBe(404);
    });

    it('다른 테넌트의 조문으로는 연결을 만들 수 없다 (404) — lawArticleId 가 가짜여도 조문 검사가 먼저 걸린다', async () => {
      const { article } = await createPolicyWithArticle(a.token, `llb-${Date.now()}`);
      const res = await api('/law-links', {
        method: 'POST',
        token: b.token,
        json: {
          lawArticleId: '00000000-0000-4000-8000-000000000000',
          articleId: article.id,
          relationType: 'citation',
        },
      });
      expect(res.status).toBe(404);
    });

    it('존재하지 않는 조문으로 추천 실행 시 404', async () => {
      const res = await api('/law-links/suggest', {
        method: 'POST',
        token: a.token,
        json: { articleId: '00000000-0000-4000-8000-000000000000' },
      });
      expect(res.status).toBe(404);
    });
  });

  describe('법령조항이 필요한 경로 (인증값이 있을 때만)', () => {
    it('연결 생성·조회·확정·반려·삭제, 그리고 ★ 다른 테넌트에게는 안 보인다', async ({ skip }) => {
      if (!lawGoKrReady) return skip();

      const found = await api('/lawgokr/search?q=%EA%B7%BC%EB%A1%9C%EA%B8%B0%EC%A4%80%EB%B2%95&display=1', {
        token: a.token,
      });
      const mst = found.body?.items?.[0]?.mst;
      expect(mst).toBeTruthy();
      const law = await api('/laws', { method: 'POST', token: a.token, json: { mst } });
      expect(law.status).toBe(200);
      const articles = await api(`/laws/${law.body.id}/articles`, { token: a.token });
      const lawArticleId = articles.body[0].id;

      const { article: articleA } = await createPolicyWithArticle(a.token, `llc-${Date.now()}`);

      // 생성 — 수동 생성은 바로 confirmed 로 저장된다
      const created = await api('/law-links', {
        method: 'POST',
        token: a.token,
        json: { lawArticleId, articleId: articleA.id, relationType: 'citation', evidenceText: '테스트 근거' },
      });
      expect(created.status).toBe(201);
      expect(created.body.confirmState).toBe('confirmed');
      expect(created.body.confirmedBy).toBe(a.user.id);

      // 같은 조합을 또 만들면 409
      const dup = await api('/law-links', {
        method: 'POST',
        token: a.token,
        json: { lawArticleId, articleId: articleA.id, relationType: 'citation' },
      });
      expect(dup.status).toBe(409);

      // articleId 로 조회 — 만든 테넌트에서는 보인다
      const byArticle = await api(`/law-links?articleId=${articleA.id}`, { token: a.token });
      expect(byArticle.body).toHaveLength(1);
      expect(byArticle.body[0].id).toBe(created.body.id);

      // ★★★ 핵심 — lawArticleId 로 조회할 때 다른 테넌트에는 보이면 안 된다
      const byLawArticleFromB = await api(`/law-links?lawArticleId=${lawArticleId}`, { token: b.token });
      expect(byLawArticleFromB.status).toBe(200);
      expect(byLawArticleFromB.body).toEqual([]);

      // 만든 테넌트에서는 당연히 보인다
      const byLawArticleFromA = await api(`/law-links?lawArticleId=${lawArticleId}`, { token: a.token });
      expect(byLawArticleFromA.body.map((x: any) => x.id)).toContain(created.body.id);

      // 다른 테넌트는 수정·삭제도 못 한다 (404 — 있다는 사실조차 알려주지 않는다)
      const updateFromB = await api(`/law-links/${created.body.id}`, {
        method: 'PATCH',
        token: b.token,
        json: { confirmState: 'rejected' },
      });
      expect(updateFromB.status).toBe(404);
      const removeFromB = await api(`/law-links/${created.body.id}`, { method: 'DELETE', token: b.token });
      expect(removeFromB.status).toBe(404);

      // 법령을 지우려 하면 연결이 남아 있어 거부된다
      const removeLawBlocked = await api(`/laws/${law.body.id}`, { method: 'DELETE', token: a.token });
      expect(removeLawBlocked.status).toBe(409);

      // 반려 — 사유는 없지만 confirmState 만 바뀐다
      const rejected = await api(`/law-links/${created.body.id}`, {
        method: 'PATCH',
        token: a.token,
        json: { confirmState: 'rejected' },
      });
      expect(rejected.status).toBe(200);
      expect(rejected.body.confirmState).toBe('rejected');

      // 삭제 후 법령 삭제가 풀린다
      const removed = await api(`/law-links/${created.body.id}`, { method: 'DELETE', token: a.token });
      expect(removed.status).toBe(200);
      const removeLawOk = await api(`/laws/${law.body.id}`, { method: 'DELETE', token: a.token });
      expect(removeLawOk.status).toBe(200);
    }, 120_000);

    it('본문 인용 패턴으로 suggested 연결을 자동 생성한다', async ({ skip }) => {
      if (!lawGoKrReady) return skip();

      const found = await api('/lawgokr/search?q=%EA%B7%BC%EB%A1%9C%EA%B8%B0%EC%A4%80%EB%B2%95&display=1', {
        token: a.token,
      });
      const mst = found.body?.items?.[0]?.mst;
      const law = await api('/laws', { method: 'POST', token: a.token, json: { mst } });
      const articles = await api(`/laws/${law.body.id}/articles`, { token: a.token });
      const target = articles.body.find((x: any) => x.clauseNo === null && x.itemNo === null);
      expect(target).toBeTruthy();

      const { policy, chapter } = await createPolicyWithArticle(a.token, `lld-${Date.now()}`);
      const article = await api(`/policies/${policy.id}/chapters/${chapter.id}/articles`, {
        method: 'POST',
        token: a.token,
        json: {
          number: 2,
          title: '인용 테스트',
          content: `이 회사는 「${law.body.lawName}」 ${target.label}를 준용한다.`,
        },
      });
      expect(article.status).toBe(201);

      const suggested = await api('/law-links/suggest', {
        method: 'POST',
        token: a.token,
        json: { articleId: article.body.id },
      });
      expect(suggested.status).toBe(201);
      expect(suggested.body.scanned).toBeGreaterThan(0);
      expect(suggested.body.created.length).toBeGreaterThan(0);
      const link = suggested.body.created[0];
      expect(link.lawArticleId).toBe(target.id);
      expect(link.confirmState).toBe('suggested');
      expect(link.confirmedBy).toBeNull();

      // 같은 조문을 다시 스캔해도 이미 있는 연결을 또 만들지 않는다
      const again = await api('/law-links/suggest', {
        method: 'POST',
        token: a.token,
        json: { articleId: article.body.id },
      });
      expect(again.body.created).toHaveLength(0);

      // 정리 — `Law`는 테넌트 공용이라 이 링크를 남겨 두면, 같은 법을 등록한
      // 다른 테스트(T-100)의 "법령 삭제" 검증을 이 테스트가 막게 된다
      await api(`/law-links/${link.id}`, { method: 'DELETE', token: a.token });
    }, 120_000);
  });
});
