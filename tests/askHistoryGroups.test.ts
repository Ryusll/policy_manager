/**
 * 내 지난 질문의 기간 묶음 (T-218, SRS SEARCH-10 ②) — 한국 날짜로 오늘·어제·지난 7일·지난 30일, 그보다 오래되면 달마다.
 * 브라우저 시간대가 아니라 서비스 기준(한국) 날짜로 센다 — 한국 0~9시에도 날짜가 하루 밀리지 않는다.
 */
import { describe, expect, it } from 'vitest';
import {
  formatAskedAt,
  groupHistory,
  historyErrorKind,
  historyPeriod,
  historyPeriodLabel,
  kstDaysAgo,
  retryHistoryLoad,
} from '../apps/web/src/lib/askHistory';

// 한국 시간 2026-11-19 00:30 (UTC 11-18 15:30)
const NOW = new Date('2026-11-18T15:30:00Z');
const t = (key: string) => key;

describe('한국 날짜로 며칠 전 (T-218)', () => {
  it('한국 자정 직후에도 어제는 어제다', () => {
    expect(kstDaysAgo('2026-11-18T15:10:00Z', NOW)).toBe(0); // 한국 11-19 00:10
    expect(kstDaysAgo('2026-11-18T14:50:00Z', NOW)).toBe(1); // 한국 11-18 23:50
  });
});

describe('기간 묶음 (T-218)', () => {
  it('오늘·어제·지난 7일·지난 30일·그 전은 달', () => {
    expect(historyPeriod('2026-11-18T15:10:00Z', NOW).kind).toBe('today');
    expect(historyPeriod('2026-11-18T14:50:00Z', NOW).kind).toBe('yesterday');
    expect(historyPeriod('2026-11-14T03:00:00Z', NOW).kind).toBe('week'); // 5일 전
    expect(historyPeriod('2026-11-12T16:00:00Z', NOW).kind).toBe('week'); // 한국 11-13 = 6일 전
    expect(historyPeriod('2026-11-12T14:00:00Z', NOW).kind).toBe('month'); // 한국 11-12 = 7일 전
    expect(historyPeriod('2026-10-21T03:00:00Z', NOW).kind).toBe('month'); // 29일 전
    const older = historyPeriod('2026-10-19T03:00:00Z', NOW); // 31일 전
    expect(older).toMatchObject({ kind: 'older', year: 2026, month: 10, key: '2026-10' });
  });

  it('최신순 목록을 차례대로 같은 묶음끼리 붙인다', () => {
    const items = [
      { id: 'a', createdAt: '2026-11-18T15:10:00Z' },
      { id: 'b', createdAt: '2026-11-18T14:50:00Z' },
      { id: 'c', createdAt: '2026-11-18T01:00:00Z' },
      { id: 'd', createdAt: '2026-10-01T03:00:00Z' },
      { id: 'e', createdAt: '2026-09-30T03:00:00Z' },
    ];
    const groups = groupHistory(items, NOW);
    expect(groups.map((g) => [g.period.key, g.items.map((i) => i.id)])).toEqual([
      ['today', ['a']],
      ['yesterday', ['b', 'c']],
      ['2026-10', ['d']],
      ['2026-9', ['e']],
    ]);
  });

  it('묶음 제목: 가까운 기간은 키, 오래된 것은 달 이름(올해가 아니면 연도까지)', () => {
    expect(historyPeriodLabel(historyPeriod('2026-11-18T15:10:00Z', NOW), NOW, 'ko', t)).toBe('ask.history.period.today');
    expect(historyPeriodLabel(historyPeriod('2026-10-01T03:00:00Z', NOW), NOW, 'ko', t)).toBe('10월');
    expect(historyPeriodLabel(historyPeriod('2026-10-01T03:00:00Z', NOW), NOW, 'en', t)).toBe('October');
    const jan = new Date('2027-01-10T03:00:00Z');
    expect(historyPeriodLabel(historyPeriod('2026-11-01T03:00:00Z', jan), jan, 'ko', t)).toBe('2026년 11월');
  });
});

describe('지난 질문을 읽다 난 오류 (T-218)', () => {
  const failed = (status?: number) => (status === undefined ? new Error('Network Error') : { response: { status } });

  it('404 는 보관 기간이 지나 없어진 것, 403 은 질문 화면이 닫힌 것, 나머지는 다시 시도할 오류', () => {
    expect(historyErrorKind(failed(404))).toBe('gone');
    expect(historyErrorKind(failed(403))).toBe('closed');
    for (const err of [failed(500), failed(400), failed(), null, undefined]) expect(historyErrorKind(err)).toBe('other');
  });

  it('4xx 는 저절로 다시 부르지 않고, 그 밖의 오류는 한 번만 더 부른다', () => {
    for (const status of [400, 403, 404]) expect(retryHistoryLoad(0, failed(status))).toBe(false);
    expect(retryHistoryLoad(0, failed(502))).toBe(true);
    expect(retryHistoryLoad(0, failed())).toBe(true);
    expect(retryHistoryLoad(1, failed(502))).toBe(false);
  });
});

describe('질문한 때 (T-218)', () => {
  it('한국 시간으로 날짜와 시각', () => {
    const text = formatAskedAt('2026-11-18T15:10:00Z', 'ko');
    expect(text).toContain('2026');
    expect(text).toContain('19');
    expect(text).toContain('00:10');
  });
});
