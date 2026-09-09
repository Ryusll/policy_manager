import { describe, it, expect } from 'vitest';
import {
  dateKey,
  daysBetween,
  recentlyRevised,
  todayKey,
  upcomingEffective,
} from '../apps/web/src/lib/policyRevisionFeed';

const p = (id: string, revisionDate: string | null, effectiveDate: string | null = null) => ({
  id,
  code: id,
  title: id,
  revisionDate,
  effectiveDate,
});

const TODAY = '2026-08-21';

describe('dateKey', () => {
  it('ISO 든 날짜-전용이든 앞 10자리를 쓴다', () => {
    expect(dateKey('2026-08-21')).toBe('2026-08-21');
    expect(dateKey('2026-08-21T00:00:00.000Z')).toBe('2026-08-21');
  });
  it('없거나 형식이 아니면 null', () => {
    expect(dateKey(null)).toBeNull();
    expect(dateKey('')).toBeNull();
    expect(dateKey('어제')).toBeNull();
  });
});

describe('todayKey — 표준시 때문에 하루가 밀리면 안 된다', () => {
  it('로컬 기준 날짜를 쓴다', () => {
    // UTC 로 만들면 한국 시간 자정~오전 9시 사이에 어제가 나온다.
    const local = new Date(2026, 7, 21, 0, 30);
    expect(todayKey(local)).toBe('2026-08-21');
  });
});

describe('recentlyRevised', () => {
  it('개정일이 오늘까지인 규정을 최신순으로 준다', () => {
    const out = recentlyRevised([p('a', '2026-01-01'), p('b', '2026-08-01'), p('c', '2026-05-05')], 5, TODAY);
    expect(out.map((x) => x.id)).toEqual(['b', 'c', 'a']);
  });

  it('개정일이 없는 규정은 넣지 않는다', () => {
    // 등록만 하고 개정일을 안 적은 것을 "개정"으로 보면 안 된다.
    expect(recentlyRevised([p('a', null)], 5, TODAY)).toEqual([]);
  });

  it('미래 개정일은 최근 개정이 아니다', () => {
    expect(recentlyRevised([p('future', '2026-12-31')], 5, TODAY)).toEqual([]);
  });

  it('오늘 개정분은 포함한다', () => {
    expect(recentlyRevised([p('today', TODAY)], 5, TODAY).map((x) => x.id)).toEqual(['today']);
  });

  it('limit 을 지킨다', () => {
    const many = ['2026-01-01', '2026-02-01', '2026-03-01'].map((d, i) => p(`p${i}`, d));
    expect(recentlyRevised(many, 2, TODAY)).toHaveLength(2);
  });
});

describe('upcomingEffective', () => {
  it('아직 시행 전인 규정을 가까운 순으로 준다', () => {
    const out = upcomingEffective(
      [p('a', null, '2026-12-01'), p('b', null, '2026-09-01'), p('c', null, '2026-01-01')],
      5,
      TODAY,
    );
    expect(out.map((x) => x.id)).toEqual(['b', 'a']);
  });

  it('오늘 시행분은 이미 시행된 것으로 본다', () => {
    // 예고는 시행 전에 알리는 것이 목적이다.
    expect(upcomingEffective([p('t', null, TODAY)], 5, TODAY)).toEqual([]);
  });

  it('남은 일수를 계산한다', () => {
    const out = upcomingEffective([p('a', null, '2026-08-31')], 5, TODAY);
    expect(out[0].daysLeft).toBe(10);
  });
});

describe('daysBetween — 표준시·서머타임에 흔들리지 않는다', () => {
  it('달을 넘어도 정확하다', () => {
    expect(daysBetween('2026-08-21', '2026-09-01')).toBe(11);
    expect(daysBetween('2026-02-28', '2026-03-01')).toBe(1);
    expect(daysBetween('2026-08-21', '2026-08-21')).toBe(0);
  });
});
