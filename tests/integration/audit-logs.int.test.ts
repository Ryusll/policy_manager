import { describe, it, expect, beforeAll } from 'vitest';
import { api, createTenant, createPolicyWithArticle, waitForApi } from './helpers';

/**
 * 감사 로그 조회 (T-11).
 *
 * API 는 있었지만 화면이 없어서, 무슨 일이 있었는지 보려면 DB 를 열어야 했다.
 * 화면을 붙이면서 필터·페이지와 **목록/상세 분리**를 함께 넣었다.
 */
describe('감사 로그 조회 (T-11)', () => {
  let t: Awaited<ReturnType<typeof createTenant>>;
  let other: Awaited<ReturnType<typeof createTenant>>;

  beforeAll(async () => {
    await waitForApi();
    [t, other] = await Promise.all([createTenant('audit'), createTenant('audit-b')]);
    // 여러 종류의 기록을 만든다
    const set = await createPolicyWithArticle(t.token, `AU-${Date.now().toString(36)}`);
    await api(`/policies/${set.policy.id}`, {
      method: 'PUT',
      token: t.token,
      json: { title: '고친 제목' },
    });
    await createPolicyWithArticle(other.token, `AU-OTHER-${Date.now().toString(36)}`);
  });

  it('목록은 rows·total·page 로 온다', async () => {
    const { status, body } = await api('/audit-logs', { token: t.token });
    expect(status).toBe(200);
    expect(Array.isArray(body.rows)).toBe(true);
    expect(typeof body.total).toBe('number');
    expect(body.page).toBe(1);
  });

  /**
   * 템플릿 수정 기록의 `details` 에는 before/after 스냅샷이 통째로 들어 있다.
   * 50건이면 응답이 수 MB 인데 목록에서는 펼치기 전까지 쓰지 않는다.
   */
  it('목록에는 details 본문이 없고 무엇이 담겼는지만 온다', async () => {
    const { body } = await api('/audit-logs', { token: t.token });
    const row = body.rows.find((r: any) => r.action === 'policy.update');
    expect(row).toBeTruthy();
    expect(row.details).toBeUndefined();
    expect(row.hasDetails).toBe(true);
    expect(row.keys.length).toBeGreaterThan(0);
  });

  it('상세에서 details 본문을 받는다', async () => {
    const { body } = await api('/audit-logs', { token: t.token });
    const row = body.rows.find((r: any) => r.action === 'policy.update');
    const detail = await api(`/audit-logs/${row.id}`, { token: t.token });
    expect(detail.status).toBe(200);
    expect(detail.body.details).toBeTruthy();
  });

  describe('필터', () => {
    it('액션 정확히 일치', async () => {
      const { body } = await api('/audit-logs?action=policy.create', { token: t.token });
      expect(body.rows.length).toBeGreaterThan(0);
      expect(body.rows.every((r: any) => r.action === 'policy.create')).toBe(true);
    });

    /** 액션 이름이 점으로 갈라져 있어 접두어가 곧 분류다 */
    it('끝에 점을 붙이면 묶음으로 거른다', async () => {
      const { body } = await api('/audit-logs?action=policy.', { token: t.token });
      expect(body.rows.length).toBeGreaterThan(0);
      expect(body.rows.every((r: any) => r.action.startsWith('policy.'))).toBe(true);
      // 묶음이 정확히 일치보다 넓어야 의미가 있다
      const exact = await api('/audit-logs?action=policy.create', { token: t.token });
      expect(body.total).toBeGreaterThan(exact.body.total);
    });

    it('수행자로 거른다', async () => {
      const { body } = await api(`/audit-logs?userId=${t.user.id}`, { token: t.token });
      expect(body.rows.length).toBeGreaterThan(0);
      expect(body.rows.every((r: any) => r.user?.id === t.user.id)).toBe(true);
    });

    it('먼 과거 구간으로 거르면 비어 있다', async () => {
      const { body } = await api('/audit-logs?from=2000-01-01&to=2000-01-02', { token: t.token });
      expect(body.total).toBe(0);
    });

    /** `lte: to` 로 두면 그날 00:00 이후 기록이 전부 빠져서, "오늘"을 골라도 오늘 게 안 나온다 */
    it('종료일 당일 기록이 포함된다', async () => {
      const today = new Date().toISOString().slice(0, 10);
      const { body } = await api(`/audit-logs?from=${today}&to=${today}`, { token: t.token });
      expect(body.total).toBeGreaterThan(0);
    });

    it('날짜 형식이 틀리면 400', async () => {
      const { status } = await api('/audit-logs?from=2026/01/01', { token: t.token });
      expect(status).toBe(400);
    });
  });

  describe('페이지', () => {
    it('크기와 페이지가 반영된다', async () => {
      const first = await api('/audit-logs?limit=1&page=1', { token: t.token });
      const second = await api('/audit-logs?limit=1&page=2', { token: t.token });
      expect(first.body.rows).toHaveLength(1);
      expect(second.body.rows).toHaveLength(1);
      expect(first.body.rows[0].id).not.toBe(second.body.rows[0].id);
      expect(first.body.total).toBe(second.body.total);
    });

    it('상한을 넘는 크기는 좁힌다', async () => {
      const { body } = await api('/audit-logs?limit=99999', { token: t.token });
      expect(body.limit).toBe(200);
    });
  });

  describe('필터 재료', () => {
    it('이 회사에 쌓인 액션만 돌려준다', async () => {
      const { body } = await api('/audit-logs/actions', { token: t.token });
      expect(body.length).toBeGreaterThan(0);
      expect(body.every((r: any) => typeof r.count === 'number')).toBe(true);
    });

    it('기록을 남긴 사용자만 돌려준다', async () => {
      const { body } = await api('/audit-logs/actors', { token: t.token });
      expect(body.map((u: any) => u.id)).toContain(t.user.id);
    });
  });

  describe('격리·권한', () => {
    it('남의 회사 기록은 섞이지 않는다', async () => {
      const mine = await api('/audit-logs?limit=200', { token: t.token });
      const theirs = await api('/audit-logs?limit=200', { token: other.token });
      const mineIds = new Set(mine.body.rows.map((r: any) => r.id));
      expect(theirs.body.rows.every((r: any) => !mineIds.has(r.id))).toBe(true);
    });

    it('남의 회사 기록 상세는 404', async () => {
      const mine = await api('/audit-logs?limit=1', { token: t.token });
      const { status } = await api(`/audit-logs/${mine.body.rows[0].id}`, { token: other.token });
      expect(status).toBe(404);
    });

    it('editor 는 볼 수 없다', async () => {
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
      const { status } = await api('/audit-logs', { token: r.body.accessToken });
      expect(status).toBe(403);
    });
  });
});
