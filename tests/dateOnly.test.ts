import { describe, it, expect } from 'vitest';
import {
  parseDateOnly,
  toDateOnlyString,
  coerceNullableDate,
} from '../apps/api/src/common/date-only';

describe('parseDateOnly', () => {
  it('YYYY-MM-DD를 UTC 자정으로 읽는다', () => {
    expect(parseDateOnly('2026-08-04')?.toISOString()).toBe('2026-08-04T00:00:00.000Z');
  });

  it('존재하지 않는 날짜를 거른다', () => {
    // 롤오버(2026-03-03)로 조용히 통과하면 시점 조회가 엉뚱한 날을 가리킨다
    expect(parseDateOnly('2026-02-31')).toBeNull();
  });

  it('형식이 어긋나면 null', () => {
    for (const bad of ['2026-2-4', '', 'abc', '2026/08/04', null, undefined]) {
      expect(parseDateOnly(bad)).toBeNull();
    }
  });

  it('왕복 변환이 보존된다', () => {
    expect(toDateOnlyString(parseDateOnly('2026-08-04')!)).toBe('2026-08-04');
  });
});

describe('coerceNullableDate', () => {
  it('빈 값·null은 지우기(null)로 본다', () => {
    expect(coerceNullableDate('')).toBeNull();
    expect(coerceNullableDate(null)).toBeNull();
    expect(coerceNullableDate(undefined)).toBeNull();
  });

  it('ISO 날짜시간에서 날짜만 취한다 (DTO의 IsDateString이 허용하는 형태)', () => {
    expect(coerceNullableDate('2026-08-04T09:30:00Z')?.toISOString()).toBe(
      '2026-08-04T00:00:00.000Z',
    );
  });
});
