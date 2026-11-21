import { BadRequestException, ConflictException, type HttpException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import {
  JO_ORDER_BASIS_REQUIRED,
  JO_ORDER_STALE,
  assertJoLayoutBasis,
  joLayoutDigest,
  requireJoLayoutBasis,
} from '../apps/api/src/policies/article-reorder';

/**
 * T-225 — 조 순서 저장의 비교 후 교체: 창을 연 때의 조문 배치 지문(joLayoutDigest). 서버가 GET :id(current.joOrderBasis)·GET :id/jo-order
 * (basedOn)로 내려주고, 저장할 때 되돌려 받아 규정을 잠근 뒤 지금 행으로 다시 만들어 견준다 — 없으면 400, 다르면 409.
 */
// 제1장 제1조, 제2조(본문 + 항 둘), 제2장 제3조의2
const rows = [
  { id: 'a1', chapterId: 'c1', chapterNumber: 1, number: 1, branchNumber: null },
  { id: 'a2', chapterId: 'c1', chapterNumber: 1, number: 2, branchNumber: null },
  { id: 'a2-1', chapterId: 'c1', chapterNumber: 1, number: 2, branchNumber: null },
  { id: 'a2-2', chapterId: 'c1', chapterNumber: 1, number: 2, branchNumber: null },
  { id: 'a3', chapterId: 'c2', chapterNumber: 2, number: 3, branchNumber: 2 },
];
const digest = joLayoutDigest(rows);
const change = (id: string, patch: Partial<(typeof rows)[number]>) => rows.map((r) => (r.id === id ? { ...r, ...patch } : r));

/** 던진 HTTP 예외의 상태와 code — 던지지 않으면 null */
function thrown(run: () => unknown): { status: number; code?: string; message?: string; type: string } | null {
  try {
    run();
    return null;
  } catch (e) {
    const body = (e as HttpException).getResponse() as { code?: string; message?: string };
    return { status: (e as HttpException).getStatus(), code: body.code, message: body.message, type: (e as Error).constructor.name };
  }
}

describe('조문 배치 지문 (T-225 — joLayoutDigest)', () => {
  it('64자리 16진수이고, 같은 배치면 행 차례와 상관없이 같다', () => {
    expect(digest).toMatch(/^[0-9a-f]{64}$/);
    expect(joLayoutDigest([...rows].reverse())).toBe(digest);
  });

  it('가지 번호는 없음·0 을 같게 본다 — 서버의 짝 맞추기(buildReorderPlan)와 같게', () => {
    const zero = rows.map((r) => (r.branchNumber === null ? { ...r, branchNumber: 0 } : r));
    const omitted = rows.map(({ branchNumber, ...r }) => (branchNumber === null ? r : { ...r, branchNumber }));
    expect(joLayoutDigest(zero)).toBe(digest);
    expect(joLayoutDigest(omitted)).toBe(digest);
  });

  it('조를 맞바꾸면 지문이 다르다 — 조 단위(장·번호·가지) 목록은 그대로라도 어느 행이 몇 번에 붙었는지를 본다', () => {
    const swapped = rows.map((r) => (r.number === 1 ? { ...r, number: 2 } : r.number === 2 ? { ...r, number: 1 } : r));
    const joKeys = (list: typeof rows) => [...new Set(list.map((r) => `${r.chapterId}/${r.number}/${r.branchNumber || 0}`))].sort();
    expect(joKeys(swapped)).toEqual(joKeys(rows));
    expect(joLayoutDigest(swapped)).not.toBe(digest);
  });

  it('조 번호·가지 번호·장이 바뀌거나 행이 더해지거나 빠지면 다르다', () => {
    expect(joLayoutDigest(change('a1', { number: 4 }))).not.toBe(digest);
    expect(joLayoutDigest(change('a3', { branchNumber: 3 }))).not.toBe(digest);
    expect(joLayoutDigest(change('a3', { branchNumber: null }))).not.toBe(digest);
    expect(joLayoutDigest(change('a2-2', { chapterId: 'c2', chapterNumber: 2 }))).not.toBe(digest);
    // 번호가 같은 다른 장(지우고 다시 만든 장 등)으로 옮겨도 다르다 — 장 번호만이 아니라 장 id 를 본다
    expect(joLayoutDigest(change('a2-2', { chapterId: 'c1-new' }))).not.toBe(digest);
    expect(joLayoutDigest([...rows, { id: 'a4', chapterId: 'c2', chapterNumber: 2, number: 4, branchNumber: null }])).not.toBe(digest);
    expect(joLayoutDigest(rows.slice(1))).not.toBe(digest);
    // 지우고 같은 자리에 새로 만든 조문(행 id 만 다르다)
    expect(joLayoutDigest(change('a1', { id: 'a1-new' }))).not.toBe(digest);
  });

  it('장 번호가 바뀌면 다르다 — 창은 장 번호 차례로 조를 늘어놓아 보내므로, 장 차례가 바뀐 뒤의 옛 차례는 창이 본 적 없는 순서로 매겨진다', () => {
    // 제1장을 3장으로(장 수정) — 조문 행은 그대로다
    const renumbered = rows.map((r) => (r.chapterId === 'c1' ? { ...r, chapterNumber: 3 } : r));
    expect(joLayoutDigest(renumbered)).not.toBe(digest);
  });

  it('항·호·목 번호와 제목·본문 같은 다른 칸은 보지 않는다 — 조 순서와 상관없다', () => {
    const extra = rows.map((r) => ({ ...r, clauseNumber: 9, itemNumber: 9, title: '다른 제목', content: '다른 본문', sectionId: 's9' }));
    expect(joLayoutDigest(extra)).toBe(digest);
  });
});

describe('저장의 지문 확인 (T-225 — requireJoLayoutBasis·assertJoLayoutBasis)', () => {
  it('지문이 없거나(옛 화면) null·빈 글·문자열이 아니면 400 POLICY_JO_ORDER_BASIS_REQUIRED — 새로 고치라는 고객 문구', () => {
    for (const missing of [undefined, null, '', 42, {}]) {
      const r = thrown(() => requireJoLayoutBasis(missing));
      expect(r).toMatchObject({ status: 400, code: JO_ORDER_BASIS_REQUIRED, type: BadRequestException.name });
      expect(r?.message).toMatch(/화면을 새로 고친 뒤 다시 옮기세요\.$/);
    }
    expect(requireJoLayoutBasis(digest)).toBe(digest);
  });

  it('지금 행의 지문과 다르면 409 POLICY_JO_ORDER_STALE, 같으면 지나간다', () => {
    const swapped = rows.map((r) => (r.number === 1 ? { ...r, number: 2 } : r.number === 2 ? { ...r, number: 1 } : r));
    expect(thrown(() => assertJoLayoutBasis(swapped, digest))).toMatchObject({ status: 409, code: JO_ORDER_STALE, type: ConflictException.name });
    expect(thrown(() => assertJoLayoutBasis(rows, joLayoutDigest(swapped)))).toMatchObject({ status: 409, code: JO_ORDER_STALE });
    expect(thrown(() => assertJoLayoutBasis([...rows].reverse(), digest))).toBeNull();
  });

  it('거절 code 는 화면이 분기하는 값과 같다', () => {
    expect(JO_ORDER_STALE).toBe('POLICY_JO_ORDER_STALE');
    expect(JO_ORDER_BASIS_REQUIRED).toBe('POLICY_JO_ORDER_BASIS_REQUIRED');
  });
});
