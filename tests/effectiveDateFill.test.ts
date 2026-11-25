import { describe, it, expect } from 'vitest';
import { planEffectiveDateFill, type FillCandidate } from '../apps/api/src/versions/effective-date-fill';

const d = (s: string) => new Date(`${s}T00:00:00.000Z`);
const v = (id: string, articleId: string, versionNum: number, date: string | null): FillCandidate => ({
  id,
  articleId,
  versionNum,
  effectiveDate: date ? d(date) : null,
});

describe('planEffectiveDateFill (PAT-02)', () => {
  it('시행일 없는 시행본 하나는 넣을 대상이다', () => {
    expect(planEffectiveDateFill([v('v1', 'a', 1, null)], d('2024-03-01'))).toEqual({
      updateIds: ['v1'],
      conflicts: [],
    });
  });

  it('비어 있는 것이 없으면 아무것도 하지 않는다', () => {
    expect(planEffectiveDateFill([v('v1', 'a', 1, '2024-03-01')], d('2024-03-01'))).toEqual({
      updateIds: [],
      conflicts: [],
    });
  });

  it('뒤 버전 시행일보다 늦으면 거부한다 — 시점 조회가 옛 본문과 새 본문을 거꾸로 고르게 된다', () => {
    const versions = [v('v1', 'a', 1, null), v('v2', 'a', 2, '2025-01-01')];
    expect(planEffectiveDateFill(versions, d('2025-06-01'))).toEqual({
      updateIds: [],
      conflicts: [{ articleId: 'a', reason: 'after-later-version', boundary: '2025-01-01' }],
    });
    expect(planEffectiveDateFill(versions, d('2024-03-01')).updateIds).toEqual(['v1']);
  });

  it('앞 버전 시행일보다 이르면 거부한다', () => {
    const versions = [v('v1', 'a', 1, '2024-01-01'), v('v2', 'a', 2, null)];
    expect(planEffectiveDateFill(versions, d('2023-12-31')).conflicts).toEqual([
      { articleId: 'a', reason: 'before-earlier-version', boundary: '2024-01-01' },
    ]);
    expect(planEffectiveDateFill(versions, d('2024-06-01')).updateIds).toEqual(['v2']);
  });

  it('한 조문에 비어 있는 시행본이 둘이면 날짜 하나로 정할 수 없다', () => {
    const versions = [v('v1', 'a', 1, null), v('v2', 'a', 2, null)];
    expect(planEffectiveDateFill(versions, d('2024-03-01'))).toEqual({
      updateIds: [],
      conflicts: [{ articleId: 'a', reason: 'multiple-missing' }],
    });
  });

  it('조문별로 따로 판정한다 — 한 조문의 충돌이 다른 조문 판정을 바꾸지 않는다', () => {
    const versions = [v('a1', 'a', 1, null), v('b1', 'b', 1, null), v('b2', 'b', 2, '2023-01-01')];
    const plan = planEffectiveDateFill(versions, d('2024-03-01'));
    expect(plan.updateIds).toEqual(['a1']);
    expect(plan.conflicts.map((c) => c.articleId)).toEqual(['b']);
  });
});
