import { describe, it, expect, beforeAll } from 'vitest';
import { api, createTenant, waitForApi } from './helpers';

/**
 * 장 없는 규정 (T-84).
 *
 * `Article.chapterId` 가 필수라, "장 없는 규정"은 **숨김 장**(`suppressHeader`)
 * 이라는 관례로 표현된다([ADR-0011]). 스키마를 바꾸지 않기로 한 이상 그 관례가
 * 모든 경로에서 성립해야 한다 — 감사에서 두 군데가 어긋나 있었다.
 *
 *  - 보이는 장의 제목을 **수정으로는** 비울 수 있었다(생성은 막는데).
 *  - 일괄 가져오기는 장 없는 규정을 아예 표현할 수 없었다.
 */
describe('장 없는 규정 (T-84)', () => {
  let t: Awaited<ReturnType<typeof createTenant>>;

  beforeAll(async () => {
    await waitForApi();
    t = await createTenant('t84');
  });

  describe('장 머리글 불변식', () => {
    let policyId: string;
    let chapterId: string;

    beforeAll(async () => {
      const p = await api('/policies', {
        method: 'POST',
        token: t.token,
        json: { code: `T84-${Date.now().toString(36)}`, title: '머리글 규칙' },
      });
      policyId = p.body.id;
      const c = await api(`/policies/${policyId}/chapters`, {
        method: 'POST',
        token: t.token,
        json: { number: 1, title: '총칙' },
      });
      chapterId = c.body.id;
    });

    it('제목 없이 보이는 장을 만들 수 없다', async () => {
      const { status } = await api(`/policies/${policyId}/chapters`, {
        method: 'POST',
        token: t.token,
        json: { number: 2, title: '' },
      });
      expect(status).toBe(400);
    });

    /** 만들 때 막은 상태를 고칠 때 만들 수 있었다 — 실측 200, title="" */
    it('보이는 장의 제목을 수정으로도 비울 수 없다', async () => {
      const { status } = await api(`/policies/${policyId}/chapters/${chapterId}`, {
        method: 'PUT',
        token: t.token,
        json: { title: '   ' },
      });
      expect(status).toBe(400);

      const { body } = await api(`/policies/${policyId}`, { token: t.token });
      expect(body.chapters[0].title).toBe('총칙');
    });

    it('숨김을 켜면 제목 없이도 된다', async () => {
      const { status, body } = await api(`/policies/${policyId}/chapters/${chapterId}`, {
        method: 'PUT',
        token: t.token,
        json: { title: '', suppressHeader: true },
      });
      expect(status).toBe(200);
      expect(body.suppressHeader).toBe(true);
      // 목록에서 알아볼 수 있게 기본 이름이 채워진다
      expect(String(body.title).trim()).not.toBe('');
    });

    it('숨김 장은 제목 없이 만들 수 있다', async () => {
      const { status, body } = await api(`/policies/${policyId}/chapters`, {
        method: 'POST',
        token: t.token,
        json: { number: 3, suppressHeader: true },
      });
      expect(status).toBe(201);
      expect(body.suppressHeader).toBe(true);
    });
  });

  describe('일괄 가져오기', () => {
    /**
     * 예전에는 `policy.chapters[].articles[]` 뿐이라, 장 없는 규정을 넣으려면
     * **없는 장 제목을 지어내야** 했다 — T-83 이 다른 경로에서 없앤 문제다.
     */
    it('최상위 articles 로 장 없는 규정을 넣는다', async () => {
      const code = `T84B-${Date.now().toString(36)}`;
      const res = await api('/admin/import/policies', {
        method: 'POST',
        token: t.token,
        json: {
          policies: [
            {
              code,
              title: '장 없는 규정',
              articles: [
                { number: 1, title: '목적', content: '이 규정은 …을 목적으로 한다.', publish: true },
                { number: 2, title: '적용범위', content: '본사와 지점에 적용한다.' },
              ],
            },
          ],
        },
      });
      expect(res.status).toBe(201);

      const list = await api('/policies', { token: t.token });
      const created = list.body.find((p: any) => p.code === code);
      expect(created).toBeTruthy();

      const { body } = await api(`/policies/${created.id}`, { token: t.token });
      expect(body.chapters).toHaveLength(1);
      // 조문을 담는 그릇일 뿐이므로 화면에는 장으로 보이지 않는다
      expect(body.chapters[0].suppressHeader).toBe(true);
      expect(body.chapters[0].articles.map((a: any) => a.number)).toEqual([1, 2]);
    });

    it('사전 검사도 최상위 articles 를 센다', async () => {
      const { status, body } = await api('/admin/import/policies/validate', {
        method: 'POST',
        token: t.token,
        json: {
          policies: [
            {
              code: `T84C-${Date.now().toString(36)}`,
              title: '장 없는 규정',
              articles: [{ number: 1, title: '목적', content: 'x' }],
            },
          ],
        },
      });
      expect(status).toBe(200);
      expect(body.canImport).toBe(true);
      expect(body.summary.articles).toBe(1);
    });

    /** 제목 없는 장을 그냥 보내면 여전히 막는다 — 실수와 의도를 구분한다 */
    it('suppressHeader 없이 제목만 빈 장은 거부한다', async () => {
      const { body } = await api('/admin/import/policies/validate', {
        method: 'POST',
        token: t.token,
        json: {
          policies: [
            {
              code: `T84D-${Date.now().toString(36)}`,
              title: '잘못된 입력',
              chapters: [{ number: 1, title: '', articles: [{ number: 1, title: '목적', content: 'x' }] }],
            },
          ],
        },
      });
      expect(body.canImport).toBe(false);
    });
  });
});
