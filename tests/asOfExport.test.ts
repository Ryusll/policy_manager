import { describe, it, expect } from 'vitest';
import { sortAppendices } from '../apps/web/src/lib/appendixOrder';
import { buildTemplateTokenData } from '../apps/web/src/components/policy-template/templateTokens';

/**
 * T-180 시점 본문 내보내기 — 시점 모드의 TXT 는 본문과 같은 응답(같은 스냅숏)의 부칙·별표를 쓰고, 양식 머리에는 현행 규정의 개정일·
 * 시행일을 싣지 않는다(그 시점의 값은 복원하지 않는다).
 */
describe('시점 본문 내보내기 (T-180)', () => {
  it('부칙·별표·서식은 종류(부칙 → 별표 → 서식) → 정한 순서 → 만든 순 — 화면 목록과 같은 차례 (T-180)', () => {
    const rows = [
      { id: 'f', kind: 'form', sortOrder: 0, createdAt: '2024-01-01' },
      { id: 'a2', kind: 'annex', sortOrder: 2, createdAt: '2024-01-01' },
      { id: 's', kind: 'supplementary', sortOrder: 5, createdAt: '2024-01-01' },
      { id: 'a1b', kind: 'annex', sortOrder: 1, createdAt: '2024-02-01' },
      { id: 'a1a', kind: 'annex', sortOrder: 1, createdAt: '2024-01-15' },
    ];
    expect(sortAppendices(rows).map((r) => r.id)).toEqual(['s', 'a1a', 'a1b', 'a2', 'f']);
    expect(sortAppendices(undefined)).toEqual([]);
  });

  it('시점 본문이면 개정일·시행일 토큰을 비우고 기준일을 싣는다 — 현행이면 그대로 (T-180)', () => {
    const base = { policyTitle: '인사규정', policyCode: 'HR-001', revisionDate: '2024-01-01', effectiveDate: '2024-02-01' };
    const current = buildTemplateTokenData(base);
    expect([current.revisionDate, current.effectiveDate, current.asOf]).toEqual(['2024. 1. 1.', '2024. 2. 1.', '']);
    const past = buildTemplateTokenData({ ...base, asOf: '2021-06-01' });
    expect([past.revisionDate, past.effectiveDate, past.asOf]).toEqual(['', '', '2021-06-01']);
  });
});
