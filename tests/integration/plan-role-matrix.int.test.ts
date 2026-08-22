import { describe, it, expect, beforeAll } from 'vitest';
import { execSync } from 'child_process';
import { api, createTenant, login, waitForApi } from './helpers';

/**
 * 플랜 × 권한 조합 자동 검증 (T-59).
 *
 * 플랜 3개 × 역할 3개 = 9가지 조합을 실제 요청으로 확인한다. 이걸 손으로 확인하면
 * 27칸을 매번 눌러 봐야 해서 결국 아무도 안 한다 — 그리고 유료 기능이 열려 있어도
 * 아무도 모른다. [수동 체크리스트](../../docs/Deliverables/12_테스트결과서/플랜권한_점검표.md)는
 * 화면 노출처럼 여기서 볼 수 없는 것만 남겼다.
 *
 * 가드 순서는 `app.module.ts` 기준으로 JwtAuth → Plan → Roles 다. 그래서 플랜과 역할이
 * 둘 다 모자라면 **플랜 쪽 메시지**가 나온다. 상태 코드는 어느 쪽이든 403이라, 어떤 가드가
 * 걸었는지 알려면 메시지를 봐야 한다.
 */

type Plan = 'starter' | 'pro' | 'enterprise';
type Role = 'admin' | 'editor' | 'viewer';

const PLANS: Plan[] = ['starter', 'pro', 'enterprise'];
const ROLES: Role[] = ['admin', 'editor', 'viewer'];

function setPlan(plan: Plan, slug: string) {
  execSync(
    `docker compose exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -t -A -f -'`,
    { encoding: 'utf8', input: `UPDATE tenants SET plan='${plan}' WHERE slug='${slug}';` },
  );
}

/** 플랜별로 테넌트 하나, 그 안에 역할별 사용자 하나씩 */
type Cell = { plan: Plan; role: Role; token: string };
const cells: Cell[] = [];
const tenantOf: Record<Plan, Awaited<ReturnType<typeof createTenant>>> = {} as any;

beforeAll(async () => {
  await waitForApi();

  for (const plan of PLANS) {
    const t = await createTenant(`mx-${plan}`);
    tenantOf[plan] = t;
    setPlan(plan, t.slug);

    // 등록자는 admin. 플랜 변경이 토큰에 반영되도록 다시 로그인한다.
    const adminLogin = await login(t.email, t.password, t.slug);
    const adminToken = adminLogin.body.accessToken;
    cells.push({ plan, role: 'admin', token: adminToken });

    for (const role of ['editor', 'viewer'] as Role[]) {
      const email = `${role}-${t.slug}@example.test`;
      const invited = await api('/users', {
        method: 'POST',
        token: adminToken,
        json: { email, password: t.password, name: role, role },
      });
      expect(invited.status, `${plan}/${role} 초대 실패`).toBe(201);
      const r = await login(email, t.password, t.slug);
      cells.push({ plan, role, token: r.body.accessToken });
    }
  }
}, 90_000);

const cell = (plan: Plan, role: Role) => cells.find((c) => c.plan === plan && c.role === role)!;

/** 조합별 기대값을 표로 적고 그대로 돌린다 */
function matrix(
  title: string,
  request: (token: string, plan: Plan) => Promise<{ status: number; body: any }>,
  expected: Record<Plan, Record<Role, number>>,
) {
  describe(title, () => {
    for (const plan of PLANS) {
      for (const role of ROLES) {
        const want = expected[plan][role];
        it(`${plan} / ${role} → ${want}`, async () => {
          const { status, body } = await request(cell(plan, role).token, plan);
          expect(status, JSON.stringify(body)?.slice(0, 200)).toBe(want);
        });
      }
    }
  });
}

const all = (n: number): Record<Role, number> => ({ admin: n, editor: n, viewer: n });
const adminOnly = (ok: number): Record<Role, number> => ({ admin: ok, editor: 403, viewer: 403 });

describe('플랜 × 권한 조합 (T-59)', () => {
  matrix(
    '템플릿 목록 — Starter 는 컨트롤러 전체가 막힌다',
    (token) => api('/templates', { token }),
    { starter: all(403), pro: all(200), enterprise: all(200) },
  );

  matrix(
    '템플릿 생성 — Pro 이상 + admin',
    (token, plan) =>
      api('/templates', {
        method: 'POST',
        token,
        json: { name: `matrix-${plan}-${Math.random().toString(36).slice(2, 7)}`, layoutJson: {}, cssText: '' },
      }),
    { starter: all(403), pro: adminOnly(201), enterprise: adminOnly(201) },
  );

  matrix(
    'API 연동 — Enterprise 전용(역할 무관)',
    (token) => api('/integrations/api-access', { token }),
    { starter: all(403), pro: all(403), enterprise: all(200) },
  );

  matrix(
    '회사 브랜딩 조회 — 플랜·역할 제한 없음(헤더는 모두가 그린다)',
    (token) => api('/tenant-branding', { token }),
    { starter: all(200), pro: all(200), enterprise: all(200) },
  );

  matrix(
    '회사 브랜딩 저장 — Pro 이상 + admin',
    (token) => api('/tenant-branding', { method: 'PUT', token, json: { brandMark: '표' } }),
    { starter: all(403), pro: adminOnly(200), enterprise: adminOnly(200) },
  );

  matrix(
    '감사 로그 — 플랜 무관, admin 전용',
    (token) => api('/audit-logs?limit=1', { token }),
    { starter: adminOnly(200), pro: adminOnly(200), enterprise: adminOnly(200) },
  );

  matrix(
    '사용자 초대 — 플랜 무관, admin 전용',
    (token, plan) =>
      api('/users', {
        method: 'POST',
        token,
        json: {
          email: `probe-${plan}-${Math.random().toString(36).slice(2, 8)}@example.test`,
          password: 'IntegrationTest!234',
          name: '조합점검',
          role: 'viewer',
        },
      }),
    { starter: adminOnly(201), pro: adminOnly(201), enterprise: adminOnly(201) },
  );

  matrix(
    '규정 생성 — 플랜 무관, viewer 만 차단',
    (token, plan) =>
      api('/policies', {
        method: 'POST',
        token,
        json: { code: `MX-${plan}-${Math.random().toString(36).slice(2, 7)}`, title: '조합 점검' },
      }),
    {
      starter: { admin: 201, editor: 201, viewer: 403 },
      pro: { admin: 201, editor: 201, viewer: 403 },
      enterprise: { admin: 201, editor: 201, viewer: 403 },
    },
  );

  matrix(
    '플랫폼 관리 — 테넌트 역할과 무관하게 전부 차단',
    (token) => api('/platform-admin/tenants', { token }),
    { starter: all(403), pro: all(403), enterprise: all(403) },
  );

  /**
   * 상태 코드만 보면 두 가드가 구분되지 않는다. 어느 쪽이 걸었는지가 사용자에게
   * 보이는 안내 문구를 가르므로 메시지까지 확인한다.
   */
  describe('403의 출처 — 플랜인가 역할인가', () => {
    it('Starter viewer 는 플랜 가드가 먼저 잡는다', async () => {
      const { body } = await api('/tenant-branding', {
        method: 'PUT',
        token: cell('starter', 'viewer').token,
        json: { brandMark: '표' },
      });
      expect(body.message).toContain('pro plan');
    });

    it('Pro viewer 는 역할 가드가 잡는다', async () => {
      const { body } = await api('/tenant-branding', {
        method: 'PUT',
        token: cell('pro', 'viewer').token,
        json: { brandMark: '표' },
      });
      expect(body.message).toBe('Insufficient permissions');
    });
  });

  /** 플랜 상한은 가드가 아니라 서비스가 센다 — 403 이지만 경로가 다르다 */
  describe('Starter 규정 개수 상한(5건)', () => {
    it('상한을 넘기면 거부한다', async () => {
      const token = cell('starter', 'admin').token;
      const created: number[] = [];
      for (let i = 0; i < 8; i += 1) {
        const { status } = await api('/policies', {
          method: 'POST',
          token,
          json: { code: `MX-LIMIT-${i}-${Math.random().toString(36).slice(2, 6)}`, title: `상한 점검 ${i}` },
        });
        created.push(status);
      }
      // 앞선 매트릭스에서 이미 몇 건 만들었으므로 정확한 개수 대신 "결국 막힌다"를 본다
      expect(created).toContain(403);
      expect(created.filter((s) => s === 201).length).toBeLessThan(8);
    });
  });
});
