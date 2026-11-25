import { describe, it, expect } from 'vitest';
import { asOfState } from '../apps/api/src/common/as-of';

const d = (s: string) => new Date(`${s}T00:00:00.000Z`);

describe('asOfState — 시점 조회로 고른 버전이 그날 시행 중인가 (T-126)', () => {
  it('고른 버전이 없으면 none', () => {
    expect(asOfState(null, d('2026-10-09'))).toBe('none');
    expect(asOfState(undefined, d('2026-10-09'))).toBe('none');
  });

  it('폐지일이 없으면 시행 중', () => {
    expect(asOfState({ repealedOn: null }, d('2026-10-09'))).toBe('in_force');
  });

  it('폐지일 당일부터 폐지 — 전날까지는 시행 중', () => {
    const v = { repealedOn: d('2026-10-09') };
    expect(asOfState(v, d('2026-10-08'))).toBe('in_force');
    expect(asOfState(v, d('2026-10-09'))).toBe('repealed');
    expect(asOfState(v, d('2027-01-01'))).toBe('repealed');
  });
});
