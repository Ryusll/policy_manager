import { describe, it, expect, beforeAll } from 'vitest';
import { api, createTenant, createPolicyWithArticle, waitForApi } from './helpers';

/**
 * 버전 반려·폐지 (T-10).
 *
 * 두 동작 모두 API 는 있었지만 화면에서 부를 길이 없었다. 연결하면서 두 가지를 함께 정했다.
 * 반려는 **사유를 받는다**(사유 없이 되돌리면 편집자는 왜 반려됐는지 모른다).
 * 폐지는 **마지막 게시본이었는지 알려 준다**(그러면 조문이 본문 없이 남는다).
 */
describe('버전 반려·폐지 (T-10)', () => {
  let t: Awaited<ReturnType<typeof createTenant>>;
  let articleId: string;

  const newVersion = async (content: string) => {
    const created = await api(`/articles/${articleId}/versions`, {
      method: 'POST',
      token: t.token,
      json: { content },
    });
    return created.body;
  };

  beforeAll(async () => {
    await waitForApi();
    t = await createTenant('ver-flow');
    const set = await createPolicyWithArticle(t.token, `VF-${Date.now().toString(36)}`);
    articleId = set.article.id;
  });

  describe('반려', () => {
    it('사유 없이 반려하면 400', async () => {
      const v = await newVersion('반려 대상 본문');
      await api(`/versions/${v.id}/submit`, { method: 'POST', token: t.token });
      const { status } = await api(`/versions/${v.id}/reject`, {
        method: 'POST',
        token: t.token,
        json: {},
      });
      expect(status).toBe(400);
    });

    it('사유와 함께 반려하면 초안으로 돌아가고 사유가 남는다', async () => {
      const v = await newVersion('반려 대상 본문 2');
      await api(`/versions/${v.id}/submit`, { method: 'POST', token: t.token });

      const { status, body } = await api(`/versions/${v.id}/reject`, {
        method: 'POST',
        token: t.token,
        json: { reason: '근거 법령 인용이 빠졌습니다.' },
      });
      expect(status).toBe(200);
      expect(body.status).toBe('draft');
      expect(body.reviewNote).toBe('근거 법령 인용이 빠졌습니다.');
    });

    it('다시 검토 요청하면 이전 반려 사유가 지워진다', async () => {
      // 남겨 두면 다시 올린 뒤에도 반려 상태처럼 보인다
      const v = await newVersion('되돌린 뒤 다시 올릴 본문');
      await api(`/versions/${v.id}/submit`, { method: 'POST', token: t.token });
      await api(`/versions/${v.id}/reject`, {
        method: 'POST',
        token: t.token,
        json: { reason: '고쳐 주세요' },
      });
      const resubmitted = await api(`/versions/${v.id}/submit`, { method: 'POST', token: t.token });
      expect(resubmitted.body.status).toBe('review');
      expect(resubmitted.body.reviewNote).toBeNull();
    });

    it('검토 중이 아닌 버전은 반려할 수 없다', async () => {
      const v = await newVersion('초안 그대로');
      const { status } = await api(`/versions/${v.id}/reject`, {
        method: 'POST',
        token: t.token,
        json: { reason: '아무거나' },
      });
      expect(status).toBe(400);
    });

    it('반려가 감사 로그에 사유와 함께 남는다', async () => {
      const { body } = await api('/audit-logs?limit=50', { token: t.token });
      const rejected = body.find((r: any) => r.action === 'version.reject');
      expect(rejected).toBeTruthy();
      expect(rejected.details.reason).toBeTruthy();
    });
  });

  describe('폐지', () => {
    it('게시되지 않은 버전은 폐지할 수 없다', async () => {
      const v = await newVersion('게시 안 된 본문');
      const { status } = await api(`/versions/${v.id}/archive`, { method: 'POST', token: t.token });
      expect(status).toBe(400);
    });

    it('게시본을 폐지하면 archived 가 되고 남은 게시본 수를 알려 준다', async () => {
      const v = await newVersion('게시할 본문');
      await api(`/versions/${v.id}/submit`, { method: 'POST', token: t.token });
      await api(`/versions/${v.id}/approve`, {
        method: 'POST',
        token: t.token,
        json: { changeNote: '최초 시행' },
      });

      const { status, body } = await api(`/versions/${v.id}/archive`, {
        method: 'POST',
        token: t.token,
      });
      expect(status).toBe(200);
      expect(body.status).toBe('archived');
      // 이 조문의 마지막 게시본이었다 — 화면이 "본문 없이 남는다"고 말할 수 있어야 한다
      expect(body.remainingPublished).toBe(0);
    });

    it('폐지 후 조문에 게시된 본문이 남지 않는다', async () => {
      const { body } = await api(`/articles/${articleId}/versions`, { token: t.token });
      expect(body.filter((v: any) => v.status === 'published')).toHaveLength(0);
    });
  });

  describe('권한', () => {
    it('editor 는 반려할 수 없다', async () => {
      const email = `editor-${t.slug}@example.test`;
      await api('/users', {
        method: 'POST',
        token: t.token,
        json: { email, password: t.password, name: '편집자', role: 'editor' },
      });
      const r = await api('/auth/login', {
        method: 'POST',
        json: { email, password: t.password, tenantSlug: t.slug },
      });
      const editorToken = r.body.accessToken;

      const v = await newVersion('편집자가 올린 본문');
      await api(`/versions/${v.id}/submit`, { method: 'POST', token: editorToken });

      const { status } = await api(`/versions/${v.id}/reject`, {
        method: 'POST',
        token: editorToken,
        json: { reason: '스스로 반려' },
      });
      expect(status).toBe(403);
    });

    it('남의 회사 버전은 반려·폐지할 수 없다', async () => {
      const other = await createTenant('ver-flow-b');
      const v = await newVersion('남이 건드릴 본문');
      await api(`/versions/${v.id}/submit`, { method: 'POST', token: t.token });

      const rejected = await api(`/versions/${v.id}/reject`, {
        method: 'POST',
        token: other.token,
        json: { reason: '탈취' },
      });
      expect(rejected.status).toBe(404);

      const archived = await api(`/versions/${v.id}/archive`, { method: 'POST', token: other.token });
      expect(archived.status).toBe(404);
    });
  });
});
