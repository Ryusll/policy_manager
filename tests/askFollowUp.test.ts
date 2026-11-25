/**
 * 이어서 묻기 (T-220, SRS SEARCH-12) — 앞 질문(부모) 확인, 앞 답의 근거 조문 이어받기, 후보 합치기.
 * 앞 질문·답의 글은 다시 보내지 않고(부모 기록에서 글을 읽지도 않는다), 그 답이 근거로 댄 조문이 **지금** 든 조를 이번 후보에 더한다.
 */
import { BadRequestException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { ASK_CARRY_MAX, carriedKeys, checkedParent, mergeCandidates } from '../apps/api/src/ask/ask-follow-up';
import { joKey } from '../apps/api/src/ask/ask-text';

type FindArgs = { where: Record<string, unknown>; select: Record<string, unknown> };

function fakeDb(row: { id: string; citations: unknown } | null) {
  const calls: FindArgs[] = [];
  const db = {
    aiQaLog: {
      findFirst: (args: FindArgs) => {
        calls.push(args);
        return Promise.resolve(row);
      },
    },
  };
  return { db: db as never, calls };
}

describe('앞 질문 확인 (T-220)', () => {
  it('이어 묻지 않으면 null — 조회도 하지 않는다', async () => {
    const f = fakeDb(null);
    expect(await checkedParent(f.db, 't1', 'u1', undefined)).toBeNull();
    expect(f.calls).toEqual([]);
  });

  it('본인·같은 회사·답을 낸 기록·보관 기간 안으로 찾고, 근거의 조문 id 를 인용 차례대로 돌려준다', async () => {
    const f = fakeDb({ id: 'p1', citations: [{ articleId: 'a2' }, { articleId: 'a1' }, { ref: 'R3' }, 'x'] });
    expect(await checkedParent(f.db, 't1', 'u1', 'p1')).toEqual({ id: 'p1', articleIds: ['a2', 'a1'] });
    const where = f.calls[0].where;
    expect(where).toMatchObject({ id: 'p1', tenantId: 't1', userId: 'u1', answerable: true });
    expect(where.createdAt).toHaveProperty('gte');
    // 앞 질문·답의 글은 읽지도 않는다 — 고지의 보내는 항목이 그대로인 근거(SEARCH-12 ②)
    expect(f.calls[0].select).toEqual({ id: true, citations: true });
  });

  it('찾지 못하거나(남의 것·다른 회사·기간 밖·답 못 함) 근거를 남기기 전·이어받을 조문이 없는 기록이면 같은 400', async () => {
    for (const row of [null, { id: 'p1', citations: null }, { id: 'p1', citations: [] }, { id: 'p1', citations: [{ ref: 'R1' }] }]) {
      const err = await checkedParent(fakeDb(row).db, 't1', 'u1', 'p1').catch((e: unknown) => e);
      expect(err).toBeInstanceOf(BadRequestException);
      expect((err as BadRequestException).getResponse()).toMatchObject({ statusCode: 400, code: 'AI_QA_PARENT_INVALID' });
    }
  });

  it('사용자가 없는 요청은 이어 묻지 못한다', async () => {
    const f = fakeDb({ id: 'p1', citations: [] });
    await expect(checkedParent(f.db, 't1', null, 'p1')).rejects.toBeInstanceOf(BadRequestException);
    expect(f.calls).toEqual([]);
  });
});

describe('앞 답의 근거 이어받기 (T-220)', () => {
  const row = (articleId: string, number: number, policyId = 'P') => ({ articleId, policyId, number, branchNumber: null });
  // 지금 시행 중인 행 — a1·a1c 는 제3조(조 머리·항), a2 는 제5조, a9 는 범위 밖 규정 Q 의 제1조
  const rows = [row('a1', 3), row('a1c', 3), row('a2', 5), row('a9', 1, 'Q')];
  const live = new Set([joKey('P', 3, null), joKey('P', 5, null)]);

  it('조문 id 로 지금 든 조를 찾는다 — 조 번호가 바뀌어도 같은 조, 항을 인용했어도 그 조', () => {
    expect(carriedKeys(['a1c', 'a2'], rows, live)).toEqual([joKey('P', 3, null), joKey('P', 5, null)]);
  });

  it('지금 시행 중이 아니거나 이번 범위 밖·지운 조문은 빼고, 같은 조는 한 번만', () => {
    expect(carriedKeys(['gone', 'a9', 'a1', 'a1c'], rows, live)).toEqual([joKey('P', 3, null)]);
  });

  it(`인용 차례대로 ${ASK_CARRY_MAX}개까지`, () => {
    const many = Array.from({ length: 6 }, (_, i) => row(`m${i}`, 10 + i));
    const all = new Set(many.map((r) => joKey('P', r.number, null)));
    expect(carriedKeys(many.map((r) => r.articleId), many, all)).toEqual(many.slice(0, ASK_CARRY_MAX).map((r) => joKey('P', r.number, null)));
  });
});

describe('후보 합치기 (T-220)', () => {
  const ks = (p: string, n: number) => Array.from({ length: n }, (_, i) => `${p}${i}`);

  it('AI 가 고른 조, 이어받은 조, 낱말 조 차례로 겹치지 않게 12개까지', () => {
    expect(mergeCandidates(['c0', 'c1'], ['s0', 'c1', 's1'], ['k0', 's0', 'k1'])).toEqual(['s0', 's1', 'c0', 'c1', 'k0', 'k1']);
    // AI 가 고를 것이 적은 이어 질문이면 이어받은 조 넷 다, 나머지는 낱말 조
    expect(mergeCandidates(ks('c', 4), ks('s', 3), ks('k', 9))).toEqual([...ks('s', 3), ...ks('c', 4), ...ks('k', 5)]);
  });

  it('AI 가 조를 많이 골라도 이어받은 조의 자리는 남는다 — AI 가 고른 조는 그만큼 줄어 8~10개', () => {
    expect(mergeCandidates(ks('c', 4), ks('s', 12), ks('k', 5))).toEqual([...ks('s', 8), ...ks('c', 4)]);
    expect(mergeCandidates(ks('c', 2), ks('s', 12), ks('k', 5))).toEqual([...ks('s', 10), ...ks('c', 2)]);
  });

  it('이어 묻기가 아니면 지금과 같다 — AI 가 고른 조 10개까지, 나머지는 낱말 조', () => {
    expect(mergeCandidates([], ks('s', 12), ks('k', 5))).toEqual([...ks('s', 10), ...ks('k', 2)]);
  });

  it('AI 가 아무것도 고르지 못해도 이어받은 조와 낱말 조로 찾는다', () => {
    expect(mergeCandidates(ks('c', 2), [], ks('k', 20))).toEqual([...ks('c', 2), ...ks('k', 10)]);
  });
});
