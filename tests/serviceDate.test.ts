import { describe, it, expect } from 'vitest';
import { serviceToday } from '../apps/web/src/lib/serviceDate';

describe('serviceToday — 화면의 "오늘"은 서버와 같은 한국 날짜 (T-126)', () => {
  it('한국 시간 0~9시에도 한국 날짜다(UTC 로 만들면 하루 이르다)', () => {
    expect(serviceToday(new Date('2026-10-08T15:30:00.000Z'))).toBe('2026-10-09');
    expect(serviceToday(new Date('2026-10-08T14:59:59.999Z'))).toBe('2026-10-08');
  });
});
