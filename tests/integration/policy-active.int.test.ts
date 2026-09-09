import { describe, it, expect, beforeAll } from 'vitest';
import { api, createTenant, createPolicyWithArticle, login, waitForApi } from './helpers';

/**
 * 규정 시행 상태 토글 (T-15).
 *
 * `isActive` 는 필드도 API 도 있었지만 화면에서 바꿀 길이 없었다(표시만 됐다).
 *
 * **이 값은 지금도 표시 전용이다** — 검색에서 빠지지 않는다. 폐지된 규정도 찾을 수
 * 있어야 하기 때문이고, 그 전제가 깨지면 여기 테스트가 먼저 알려 준다.
 */
describe('규정 시행 상태 (T-15)', () => {
  let t: Awaited<ReturnType<typeof createTenant>>;
  let policyId: string;
  const title = `상태점검규정 ${Date.now().toString(36)}`;

  beforeAll(async () => {
    await waitForApi();
    t = await createTenant('active');
    const set = await createPolicyWithArticle(t.token, `AC-${Date.now().toString(36)}`, title);
    policyId = set.policy.id;
  });

  it('새 규정은 시행중으로 시작한다', async () => {
    const { body } = await api(`/policies/${policyId}`, { token: t.token });
    expect(body.isActive).toBe(true);
  });

  it('비활성으로 바꾸고 되돌릴 수 있다', async () => {
    const off = await api(`/policies/${policyId}`, {
      method: 'PUT',
      token: t.token,
      json: { isActive: false },
    });
    expect(off.status).toBe(200);
    expect(off.body.isActive).toBe(false);

    const on = await api(`/policies/${policyId}`, {
      method: 'PUT',
      token: t.token,
      json: { isActive: true },
    });
    expect(on.body.isActive).toBe(true);
  });

  it('목록에도 상태가 실린다 — 화면이 걸러 낼 수 있어야 한다', async () => {
    await api(`/policies/${policyId}`, { method: 'PUT', token: t.token, json: { isActive: false } });
    const { body } = await api('/policies', { token: t.token });
    const row = body.find((p: any) => p.id === policyId);
    expect(row.isActive).toBe(false);
  });

  /** 폐지된 규정도 찾을 수 있어야 한다 — 상태는 표시일 뿐 접근을 막지 않는다 */
  it('비활성이어도 검색에 나오고 상세를 열 수 있다', async () => {
    const found = await api(`/search?q=${encodeURIComponent('상태점검규정')}`, { token: t.token });
    expect(JSON.stringify(found.body)).toContain(policyId);

    const detail = await api(`/policies/${policyId}`, { token: t.token });
    expect(detail.status).toBe(200);
    expect(detail.body.chapters[0].articles.length).toBeGreaterThan(0);
  });

  it('상태 변경이 감사 로그에 남는다', async () => {
    const { body } = await api('/audit-logs?action=policy.update', { token: t.token });
    expect(body.rows.length).toBeGreaterThan(0);
  });

  describe('권한', () => {
    it('viewer 는 바꿀 수 없다', async () => {
      const email = `viewer-${t.slug}@example.test`;
      await api('/users', {
        method: 'POST',
        token: t.token,
        json: { email, password: t.password, name: '뷰어', role: 'viewer' },
      });
      const r = await login(email, t.password, t.slug);
      const { status } = await api(`/policies/${policyId}`, {
        method: 'PUT',
        token: r.body.accessToken,
        json: { isActive: true },
      });
      expect(status).toBe(403);
    });

    it('남의 회사 규정 상태는 바꿀 수 없다', async () => {
      const other = await createTenant('active-b');
      const { status } = await api(`/policies/${policyId}`, {
        method: 'PUT',
        token: other.token,
        json: { isActive: true },
      });
      expect(status).toBe(404);
    });
  });
});
