import { describe, it, expect } from 'vitest';
import {
  ReorderPlanError,
  buildReorderPlan,
  currentJoOrder,
  type ReorderArticleRow,
} from '../apps/api/src/policies/article-reorder';

const CH1 = 'ch-1';
const CH2 = 'ch-2';
const CHAPTERS = [CH1, CH2];

/** 제1장: 제1·2조, 제2장: 제3조. 제2조에는 항이 둘 달려 있다 */
const rows: ReorderArticleRow[] = [
  { id: 'a1', chapterId: CH1, sectionId: null, number: 1 },
  { id: 'a2', chapterId: CH1, sectionId: null, number: 2 },
  { id: 'a2-c1', chapterId: CH1, sectionId: null, number: 2 },
  { id: 'a2-c2', chapterId: CH1, sectionId: null, number: 2 },
  { id: 'a3', chapterId: CH2, sectionId: null, number: 3 },
];

describe('currentJoOrder', () => {
  it('장 순서 → 조 순서로 현재 차례를 만든다', () => {
    const order = currentJoOrder([
      { id: CH2, number: 2, articles: [{ number: 3 }] },
      { id: CH1, number: 1, articles: [{ number: 2 }, { number: 1 }, { number: 2 }] },
    ]);
    expect(order).toEqual([
      { chapterId: CH1, jo: 1 },
      { chapterId: CH1, jo: 2 },
      { chapterId: CH2, jo: 3 },
    ]);
  });
});

describe('buildReorderPlan (T-60)', () => {
  it('순서가 그대로면 바꿀 것이 없다', () => {
    const plan = buildReorderPlan(
      rows,
      [
        { chapterId: CH1, jo: 1 },
        { chapterId: CH1, jo: 2 },
        { chapterId: CH2, jo: 3 },
      ],
      CHAPTERS,
    );
    expect(plan).toEqual([]);
  });

  /**
   * 조 번호는 장을 가로질러 이어진다(제1장 제1·2조 → 제2장 제3조).
   * 그래서 하나만 앞으로 당겨도 뒤의 번호가 전부 밀린다.
   */
  it('마지막 조를 맨 앞으로 옮기면 나머지가 한 칸씩 밀린다', () => {
    const plan = buildReorderPlan(
      rows,
      [
        { chapterId: CH1, jo: 3 },
        { chapterId: CH1, jo: 1 },
        { chapterId: CH1, jo: 2 },
      ],
      CHAPTERS,
    );
    const byId = Object.fromEntries(plan.map((c) => [c.id, c]));
    expect(byId['a3'].number).toBe(1);
    expect(byId['a1'].number).toBe(2);
    expect(byId['a2'].number).toBe(3);
  });

  /** 조 하나는 여러 행이다 — 한 행만 바꾸면 항·목이 엉뚱한 조에 붙는다 */
  it('조를 옮기면 그 조의 항·목 행도 함께 움직인다', () => {
    const plan = buildReorderPlan(
      rows,
      [
        { chapterId: CH1, jo: 2 },
        { chapterId: CH1, jo: 1 },
        { chapterId: CH2, jo: 3 },
      ],
      CHAPTERS,
    );
    const moved = plan.filter((c) => ['a2', 'a2-c1', 'a2-c2'].includes(c.id));
    expect(moved).toHaveLength(3);
    expect(new Set(moved.map((c) => c.number))).toEqual(new Set([1]));
  });

  it('다른 장으로 옮기면 chapterId 가 바뀐다', () => {
    const plan = buildReorderPlan(
      rows,
      [
        { chapterId: CH1, jo: 1 },
        { chapterId: CH2, jo: 2 },
        { chapterId: CH2, jo: 3 },
      ],
      CHAPTERS,
    );
    const moved = plan.filter((c) => c.id.startsWith('a2'));
    expect(moved).toHaveLength(3);
    for (const c of moved) expect(c.chapterId).toBe(CH2);
  });

  it('장이 바뀌면 절 지정을 푼다', () => {
    // 절은 장에 속한다. 그대로 두면 남의 장 절을 가리키게 된다.
    const withSection: ReorderArticleRow[] = [
      { id: 'x1', chapterId: CH1, sectionId: 'sec-1', number: 1 },
      { id: 'x2', chapterId: CH2, sectionId: null, number: 2 },
    ];
    const plan = buildReorderPlan(
      withSection,
      [
        { chapterId: CH2, jo: 1 },
        { chapterId: CH2, jo: 2 },
      ],
      CHAPTERS,
    );
    expect(plan.find((c) => c.id === 'x1')?.sectionId).toBeNull();
  });

  it('같은 장 안에서 옮기면 절 지정은 유지한다', () => {
    const withSection: ReorderArticleRow[] = [
      { id: 'y1', chapterId: CH1, sectionId: 'sec-1', number: 1 },
      { id: 'y2', chapterId: CH1, sectionId: 'sec-1', number: 2 },
    ];
    const plan = buildReorderPlan(
      withSection,
      [
        { chapterId: CH1, jo: 2 },
        { chapterId: CH1, jo: 1 },
      ],
      CHAPTERS,
    );
    expect(plan.every((c) => c.sectionId === 'sec-1')).toBe(true);
  });

  describe('거절해야 하는 입력', () => {
    it('조가 빠지면 거절한다', () => {
      // 재정렬은 순서만 바꾸는 일이다. 빠진 조를 그냥 두면 번호에 구멍이 남는다.
      expect(() =>
        buildReorderPlan(rows, [{ chapterId: CH1, jo: 1 }, { chapterId: CH1, jo: 2 }], CHAPTERS),
      ).toThrow(ReorderPlanError);
    });

    it('없는 조가 들어오면 거절한다', () => {
      expect(() =>
        buildReorderPlan(
          rows,
          [
            { chapterId: CH1, jo: 1 },
            { chapterId: CH1, jo: 2 },
            { chapterId: CH1, jo: 3 },
            { chapterId: CH1, jo: 9 },
          ],
          CHAPTERS,
        ),
      ).toThrow(ReorderPlanError);
    });

    it('같은 조가 두 번 오면 거절한다', () => {
      expect(() =>
        buildReorderPlan(
          rows,
          [
            { chapterId: CH1, jo: 1 },
            { chapterId: CH1, jo: 1 },
            { chapterId: CH1, jo: 2 },
          ],
          CHAPTERS,
        ),
      ).toThrow(ReorderPlanError);
    });

    it('다른 규정의 장으로는 옮길 수 없다', () => {
      expect(() =>
        buildReorderPlan(
          rows,
          [
            { chapterId: '남의-장', jo: 1 },
            { chapterId: CH1, jo: 2 },
            { chapterId: CH2, jo: 3 },
          ],
          CHAPTERS,
        ),
      ).toThrow(ReorderPlanError);
    });
  });
});
