import { describe, it, expect, beforeAll } from 'vitest';
import { execSync } from 'child_process';
import { api, createTenant, login, waitForApi } from './helpers';

/**
 * 규정 일괄 가져오기 (T-13).
 *
 * API 는 있었지만 화면이 없었다. 붙이면서 두 가지가 드러났다 —
 * **첫 충돌에서 트랜잭션째 멈춰** 무엇이 문제인지 한 번에 알 수 없었고,
 * **플랜 상한을 통과했다**(규정을 하나씩 만들 때는 막히는데 여기는 뚫려 있었다).
 */

function setPlan(plan: 'starter' | 'pro', slug: string) {
  execSync(
    `docker compose exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -t -A -f -'`,
    { encoding: 'utf8', input: `UPDATE tenants SET plan='${plan}' WHERE slug='${slug}';` },
  );
}

const policy = (code: string, over: Record<string, unknown> = {}) => ({
  code,
  title: `규정 ${code}`,
  chapters: [
    { number: 1, title: '총칙', articles: [{ number: 1, title: '목적', content: '본문', publish: true }] },
  ],
  ...over,
});

describe('규정 일괄 가져오기 (T-13)', () => {
  let t: Awaited<ReturnType<typeof createTenant>>;
  let tag: string;

  beforeAll(async () => {
    await waitForApi();
    t = await createTenant('bulk');
    setPlan('pro', t.slug);
    const fresh = await login(t.email, t.password, t.slug);
    t = { ...t, token: fresh.body.accessToken };
    tag = Date.now().toString(36);
  });

  describe('사전 검사', () => {
    it('멀쩡한 입력은 통과하고 건수를 센다', async () => {
      const { status, body } = await api('/admin/import/policies/validate', {
        method: 'POST',
        token: t.token,
        json: { policies: [policy(`BK-${tag}-1`)] },
      });
      expect(status).toBe(200);
      expect(body.canImport).toBe(true);
      expect(body.summary).toEqual({ policies: 1, chapters: 1, articles: 1 });
    });

    /** 예전에는 첫 충돌에서 멈춰 오류 한 줄만 돌아왔다 */
    it('문제를 한 번에 모아 돌려준다', async () => {
      const { body } = await api('/admin/import/policies/validate', {
        method: 'POST',
        token: t.token,
        json: {
          policies: [
            { code: `BK-${tag}-dup`, title: '가', chapters: [] },
            { code: `BK-${tag}-dup`, title: '나', chapters: [] },
            { code: `BK-${tag}-3`, title: '', chapters: [] },
          ],
        },
      });
      expect(body.canImport).toBe(false);
      expect(body.issues.filter((i: any) => i.level === 'error').length).toBeGreaterThanOrEqual(2);
    });

    it('검사만 하고 아무것도 만들지 않는다', async () => {
      const before = await api('/policies', { token: t.token });
      await api('/admin/import/policies/validate', {
        method: 'POST',
        token: t.token,
        json: { policies: [policy(`BK-${tag}-noop`)] },
      });
      const after = await api('/policies', { token: t.token });
      expect(after.body.length).toBe(before.body.length);
    });
  });

  describe('가져오기', () => {
    it('규정·장·조가 실제로 만들어진다', async () => {
      const code = `BK-${tag}-ok`;
      const { status, body } = await api('/admin/import/policies', {
        method: 'POST',
        token: t.token,
        json: { policies: [policy(code)] },
      });
      expect(status).toBe(201);
      expect(body.importedPolicies).toBe(1);

      const detail = await api(`/policies/${body.policyIds[0]}`, { token: t.token });
      expect(detail.body.code).toBe(code);
      expect(detail.body.chapters).toHaveLength(1);
      expect(detail.body.chapters[0].articles).toHaveLength(1);
      // publish: true 였으므로 첫 버전이 바로 게시본이다
      expect(detail.body.chapters[0].articles[0].versions[0].status).toBe('published');
    });

    it('이미 있는 코드는 400 이고 아무것도 들어가지 않는다', async () => {
      const before = await api('/policies', { token: t.token });
      const { status } = await api('/admin/import/policies', {
        method: 'POST',
        token: t.token,
        json: { policies: [policy(`BK-${tag}-new`), policy(`BK-${tag}-ok`)] },
      });
      expect(status).toBe(400);
      const after = await api('/policies', { token: t.token });
      // 절반만 들어간 규정집은 아무것도 안 들어간 것보다 나쁘다
      expect(after.body.length).toBe(before.body.length);
    });

    it('오류가 있으면 issues 를 함께 돌려준다', async () => {
      const { body } = await api('/admin/import/policies', {
        method: 'POST',
        token: t.token,
        json: { policies: [policy(`BK-${tag}-ok`)] },
      });
      expect(Array.isArray(body.issues)).toBe(true);
    });

    it('가져오기가 감사 로그에 남는다', async () => {
      const { body } = await api('/audit-logs?action=admin.', { token: t.token });
      expect(body.rows.map((r: any) => r.action)).toContain('admin.import_policies');
    });
  });

  /**
   * 규정을 하나씩 만들 때는 상한에 막히는데 일괄 가져오기는 통과했다 —
   * Starter(5건) 테넌트가 한 번에 100건을 넣을 수 있었다.
   */
  describe('플랜 상한', () => {
    it('Starter 상한을 넘기면 막는다', async () => {
      const s = await createTenant('bulk-starter');
      const many = Array.from({ length: 6 }, (_, i) => policy(`BKS-${tag}-${i}`));

      const check = await api('/admin/import/policies/validate', {
        method: 'POST',
        token: s.token,
        json: { policies: many },
      });
      expect(check.body.canImport).toBe(false);
      expect(check.body.issues.some((i: any) => i.message.includes('상한'))).toBe(true);

      const imported = await api('/admin/import/policies', {
        method: 'POST',
        token: s.token,
        json: { policies: many },
      });
      expect(imported.status).toBe(400);

      const list = await api('/policies', { token: s.token });
      expect(list.body).toHaveLength(0);
    });
  });

  describe('권한', () => {
    it('editor 는 가져올 수 없다', async () => {
      const email = `editor-${t.slug}@example.test`;
      await api('/users', {
        method: 'POST',
        token: t.token,
        json: { email, password: t.password, name: '편집자', role: 'editor' },
      });
      const r = await login(email, t.password, t.slug);
      const { status } = await api('/admin/import/policies', {
        method: 'POST',
        token: r.body.accessToken,
        json: { policies: [policy(`BK-${tag}-editor`)] },
      });
      expect(status).toBe(403);
    });

    it('사전 검사도 관리자 전용이다', async () => {
      const email = `editor-${t.slug}@example.test`;
      const r = await login(email, t.password, t.slug);
      const { status } = await api('/admin/import/policies/validate', {
        method: 'POST',
        token: r.body.accessToken,
        json: { policies: [policy(`BK-${tag}-editor2`)] },
      });
      expect(status).toBe(403);
    });
  });
});
