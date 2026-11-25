/**
 * 질문 범위가 조문 찾기에 걸리는가 (T-219, SRS SEARCH-11) — 범위 확인, 목차·본문의 출발점(inForceRows), 낱말 찾기(keywordGroups).
 * 낱말 찾기는 낱말마다 200행에서 자르므로 결과를 나중에 거르면 범위 밖 규정이 자리를 차지해 범위 안의 조를 놓친다 —
 * 통합 시험의 작은 자료로는 드러나지 않아, 만들어지는 SQL 과 조회 조건을 직접 본다.
 */
import { BadRequestException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { ASK_SCOPE_MAX, checkedScope, inForceRows, keywordGroups } from '../apps/api/src/ask/ask-candidates';
import { ASK_SCOPE_MAX as WEB_ASK_SCOPE_MAX } from '../apps/web/src/lib/askScope';

type RawCall = { sql: string; values: unknown[] };

type PolicyArgs = { where: { id: { in: string[] } } & Record<string, unknown> };

function fakeDb(policies: { id: string; title: string; code: string }[] = []) {
  const raw: RawCall[] = [];
  const articleArgs: unknown[] = [];
  const policyArgs: PolicyArgs[] = [];
  const db = {
    $queryRaw: (q: RawCall) => {
      raw.push({ sql: q.sql, values: q.values });
      return Promise.resolve([]);
    },
    article: {
      findMany: (args: unknown) => {
        articleArgs.push(args);
        return Promise.resolve([]);
      },
    },
    policy: {
      findMany: (args: PolicyArgs) => {
        policyArgs.push(args);
        return Promise.resolve(policies.filter((p) => args.where.id.in.includes(p.id)));
      },
    },
  };
  return { db: db as never, raw, articleArgs, policyArgs };
}

describe('질문 범위 확인 (T-219)', () => {
  const a = { id: 'a', title: '여비 규정', code: 'FN-01' };
  const b = { id: 'b', title: '취업규칙', code: 'HR-02' };

  it('고르지 않았으면 null — 회사 전체', async () => {
    const f = fakeDb([a]);
    expect(await checkedScope(f.db, 't1', undefined)).toBeNull();
    expect(await checkedScope(f.db, 't1', [])).toBeNull();
    expect(f.policyArgs).toEqual([]);
  });

  it('그 회사의 활성 규정만 찾고, 고른 차례대로 그때의 이름·코드를 돌려준다(겹친 것은 한 번)', async () => {
    const f = fakeDb([a, b]);
    expect(await checkedScope(f.db, 't1', ['b', 'a', 'b'])).toEqual([b, a]);
    expect(f.policyArgs[0].where).toEqual({ id: { in: ['b', 'a'] }, tenantId: 't1', isActive: true });
  });

  it('하나라도 찾지 못하면(없음·다른 회사·비활성) 같은 400', async () => {
    const f = fakeDb([a]);
    const err = await checkedScope(f.db, 't1', ['a', 'zz']).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(BadRequestException);
    expect((err as BadRequestException).getResponse()).toMatchObject({ statusCode: 400, code: 'AI_QA_SCOPE_INVALID' });
  });

  it('고를 수 있는 수 상한은 화면과 서버가 같다', () => {
    expect(WEB_ASK_SCOPE_MAX).toBe(ASK_SCOPE_MAX);
  });
});

describe('범위가 조문 찾기에 걸린다 (T-219)', () => {
  it('목차·본문의 출발점: 범위가 있으면 그 규정의 조문만 읽는다', async () => {
    const f = fakeDb();
    await inForceRows(f.db, 't1', ['a', 'b']);
    expect(f.articleArgs[0]).toMatchObject({
      where: { chapter: { policy: { tenantId: 't1', isActive: true, id: { in: ['a', 'b'] } } } },
    });
    const g = fakeDb();
    await inForceRows(g.db, 't1', null);
    expect((g.articleArgs[0] as { where: { chapter: { policy: Record<string, unknown> } } }).where.chapter.policy).not.toHaveProperty('id');
  });

  it('낱말 찾기: 범위가 있으면 낱말마다 SQL 에서 그 규정만 본다(200행에서 자르기 전에)', async () => {
    const f = fakeDb();
    await keywordGroups(f.db, 't1', ['경조금', '결혼'], new Set(), ['a', 'b']);
    expect(f.raw).toHaveLength(2);
    for (const call of f.raw) {
      // Prisma.Sql 의 sql 은 자리 표시를 ? 로 적는다 — 범위 id 둘이 그 자리의 값이다
      expect(call.sql).toMatch(/AND p\.id IN \(\?,\s*\?\)/);
      expect(call.values).toEqual(expect.arrayContaining(['a', 'b']));
      expect(call.sql.indexOf('AND p.id IN')).toBeLessThan(call.sql.indexOf('LIMIT 200'));
    }
    const g = fakeDb();
    await keywordGroups(g.db, 't1', ['경조금'], new Set(), null);
    expect(g.raw[0].sql).not.toContain('p.id IN');
  });
});
