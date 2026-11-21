import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * T-225 — 조 순서 저장 요청 본문: 창이 그린 규정의 배치 지문(basedOn)을 꼭 실어 보낸다. 서버는 지문이 없거나 null 이면 400
 * POLICY_JO_ORDER_BASIS_REQUIRED(새로 고치라는 문구)로, 빈 글·대문자 등 형식이 틀리면 DTO 의 400 으로 거절한다 — 그래서 화면은 지문이
 * 없으면 보내지 않는다(useReorderSave, reorderStale 시험).
 */
const http = vi.hoisted(() => ({ put: vi.fn() }));
vi.mock('../apps/web/src/api/client', () => ({ default: { put: http.put } }));
const { policiesApi } = await import('../apps/web/src/api/policies');

afterEach(() => http.put.mockReset());
const order = [
  { chapterId: 'c1', jo: 2 },
  { chapterId: 'c1', jo: 1 },
];

describe('조 순서 저장 요청 본문 (T-225 — policiesApi.reorderArticles)', () => {
  it('배치 지문을 basedOn 으로 싣는다', async () => {
    http.put.mockResolvedValueOnce({ data: { changed: 2 } });
    const basis = 'b'.repeat(64);
    expect(await policiesApi.reorderArticles('A', order, basis)).toEqual({ changed: 2 });
    expect(http.put).toHaveBeenCalledWith('/policies/A/jo-order', { order, basedOn: basis });
  });

  it('본문은 차례와 지문 둘뿐이다 — 서버의 DTO 가 모르는 칸을 거절한다', async () => {
    http.put.mockResolvedValueOnce({ data: { changed: 0 } });
    await policiesApi.reorderArticles('A', order, 'c'.repeat(64));
    expect(Object.keys(http.put.mock.calls[0][1]).sort()).toEqual(['basedOn', 'order']);
  });
});
