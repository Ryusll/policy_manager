import { describe, it, expect, beforeAll } from 'vitest';
import { randomUUID } from 'crypto';
import { JwtService } from '@nestjs/jwt';
import { AuthService } from '../apps/api/src/auth/auth.service';
import { hashRefreshToken } from '../apps/api/src/auth/session-policy';

/**
 * 갱신 토큰의 세션 이전·회전 (T-137) — DB 를 흉내 낸 최소 가짜로 서비스를 직접 부른다.
 *
 * 배포 전에 받은 토큰(세션 id 없음)은 통합 테스트로 만들 수 없다 — 서버의 서명 키가 있어야 해서다.
 */
type Row = Record<string, any>;

function fakePrisma() {
  const users = new Map<string, Row>();
  const sessions = new Map<string, Row>();
  const match = (row: Row, where: Row): boolean =>
    Object.entries(where).every(([k, v]) => {
      if (k === 'OR') return (v as Row[]).some((w) => match(row, w));
      if (v && typeof v === 'object' && 'lt' in v) return row[k] != null && row[k] < v.lt;
      return row[k] === v;
    });
  const updateMany = (table: Map<string, Row>) => ({ where, data }: { where: Row; data: Row }) => {
    let count = 0;
    for (const row of table.values()) if (match(row, where)) { Object.assign(row, data); count += 1; }
    return Promise.resolve({ count });
  };
  const prisma: any = {
    users,
    sessions,
    user: {
      findUnique: ({ where }: { where: Row }) => Promise.resolve(users.get(where.id) ?? null),
      updateMany: updateMany(users),
      update: ({ where, data }: { where: Row; data: Row }) => Promise.resolve(Object.assign(users.get(where.id)!, data)),
    },
    authSession: {
      create: ({ data }: { data: Row }) => {
        sessions.set(data.id, { revokedAt: null, ...data });
        return Promise.resolve(data);
      },
      deleteMany: ({ where }: { where: Row }) => {
        let count = 0;
        for (const [id, s] of sessions) if (match(s, where)) { sessions.delete(id); count += 1; }
        return Promise.resolve({ count });
      },
      findUnique: ({ where }: { where: Row }) => {
        const s = sessions.get(where.id);
        return Promise.resolve(s ? { ...s, user: users.get(s.userId) } : null);
      },
      updateMany: updateMany(sessions),
    },
    $transaction: (ops: Promise<unknown>[]) => Promise.all(ops),
  };
  return prisma;
}

const REFRESH_SECRET = 'unit-test-refresh-secret';
const user = (refreshToken: string | null) => ({
  id: 'u1',
  email: 'kim@example.test',
  name: '김',
  role: 'admin',
  platformRole: 'none',
  mustChangePassword: false,
  tenantId: 't1',
  tenant: { slug: 'acme', name: '에이크미', plan: 'starter' },
  refreshToken,
});
const claims = (jwt: string) => JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString());

describe('AuthService.refresh — 세션 이전과 회전 (T-137)', () => {
  let jwt: JwtService;
  beforeAll(() => {
    process.env.JWT_REFRESH_SECRET = REFRESH_SECRET;
    jwt = new JwtService({ secret: 'unit-test-access-secret' });
  });

  /** 배포했다고 모두를 로그인 화면으로 보내지 않는다 — 그러나 같은 옛 토큰을 두 번 쓸 수는 없다 */
  it('배포 전에 받은 옛 토큰(세션 id 없음)은 한 번만 세션으로 옮겨진다', async () => {
    const legacy = jwt.sign({ sub: 'u1', email: 'kim@example.test', role: 'admin', jti: randomUUID() }, { secret: REFRESH_SECRET, expiresIn: '7d' });
    const prisma = fakePrisma();
    prisma.users.set('u1', user(legacy));
    const svc = new AuthService(prisma, jwt);

    const r = await svc.refresh(legacy);
    expect(r.remember).toBe(false);
    expect(claims(r.refreshToken).sid).toBeTruthy();
    expect(prisma.users.get('u1').refreshToken).toBeNull();
    expect(prisma.sessions.size).toBe(1);
    const [session] = [...prisma.sessions.values()];
    // 원문이 아니라 해시가 저장된다
    expect(session.tokenHash).toBe(hashRefreshToken(r.refreshToken));
    expect(session.tokenHash).not.toBe(r.refreshToken);

    await expect(svc.refresh(legacy)).rejects.toThrow('Invalid refresh token');

    // 옮겨진 세션은 보통처럼 회전한다
    const r2 = await svc.refresh(r.refreshToken);
    expect(r2.refreshToken).not.toBe(r.refreshToken);
    await expect(svc.refresh(r.refreshToken)).rejects.toThrow('Invalid refresh token');
  });

  it('저장된 값과 다른 옛 토큰은 옮기지 않는다', async () => {
    const legacy = jwt.sign({ sub: 'u1', jti: randomUUID() }, { secret: REFRESH_SECRET, expiresIn: '7d' });
    const prisma = fakePrisma();
    prisma.users.set('u1', user('something-else'));
    await expect(new AuthService(prisma, jwt).refresh(legacy)).rejects.toThrow('Invalid refresh token');
    expect(prisma.sessions.size).toBe(0);
  });

  /** 두 탭이 같은 토큰으로 동시에 갱신하면 — 둘 다 성공하면 한쪽은 DB 에 없는 토큰을 들고 있게 된다 */
  it('같은 갱신 토큰으로 동시에 두 번 갱신하면 한쪽만 성공한다', async () => {
    const prisma = fakePrisma();
    const legacy = jwt.sign({ sub: 'u1', jti: randomUUID() }, { secret: REFRESH_SECRET, expiresIn: '7d' });
    prisma.users.set('u1', user(legacy));
    const svc = new AuthService(prisma, jwt);
    const first = await svc.refresh(legacy);

    const results = await Promise.allSettled([svc.refresh(first.refreshToken), svc.refresh(first.refreshToken)]);
    expect(results.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
    const winner = results.find((x) => x.status === 'fulfilled') as PromiseFulfilledResult<{ refreshToken: string }>;
    const [session] = [...prisma.sessions.values()];
    expect(session.tokenHash).toBe(hashRefreshToken(winner.value.refreshToken));
  });

  it('끝난 세션(로그아웃)은 갱신되지 않는다', async () => {
    const prisma = fakePrisma();
    const legacy = jwt.sign({ sub: 'u1', jti: randomUUID() }, { secret: REFRESH_SECRET, expiresIn: '7d' });
    prisma.users.set('u1', user(legacy));
    const svc = new AuthService(prisma, jwt);
    const r = await svc.refresh(legacy);
    await svc.logout('u1', claims(r.refreshToken).sid);
    await expect(svc.refresh(r.refreshToken)).rejects.toThrow('Invalid refresh token');
  });
});
