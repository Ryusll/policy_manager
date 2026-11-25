import { serviceToday } from './serviceDate';

/**
 * 내 지난 질문의 기간 묶음(T-218, SRS SEARCH-10 ②) — 한국 날짜로 오늘·어제·지난 7일·지난 30일, 그보다 오래되면 달마다.
 * 서버가 최신순으로 주므로 차례대로 같은 묶음끼리 붙인다. 브라우저 시간대가 아니라 서비스 기준(한국) 날짜로 센다.
 */
export type HistoryPeriodKind = 'today' | 'yesterday' | 'week' | 'month' | 'older';

export interface HistoryPeriod {
  /** 묶음을 가르는 값 — 같은 값이면 한 묶음 */
  key: string;
  kind: HistoryPeriodKind;
  /** 'older' 일 때 그 달(한국 날짜) */
  year: number;
  month: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** 한국 날짜로 며칠 전인가(오늘 0, 어제 1) */
export function kstDaysAgo(iso: string, now: Date): number {
  const day = (d: Date) => Date.parse(`${serviceToday(d)}T00:00:00Z`);
  return Math.round((day(now) - day(new Date(iso))) / DAY_MS);
}

export function historyPeriod(iso: string, now: Date): HistoryPeriod {
  const [year, month] = serviceToday(new Date(iso)).split('-').map(Number);
  const days = kstDaysAgo(iso, now);
  const base = { year, month };
  if (days <= 0) return { key: 'today', kind: 'today', ...base };
  if (days === 1) return { key: 'yesterday', kind: 'yesterday', ...base };
  if (days < 7) return { key: 'week', kind: 'week', ...base };
  if (days < 30) return { key: 'month', kind: 'month', ...base };
  return { key: `${year}-${month}`, kind: 'older', ...base };
}

/** 최신순 목록을 차례대로 기간 묶음으로 */
export function groupHistory<T extends { createdAt: string }>(items: readonly T[], now: Date) {
  const groups: { period: HistoryPeriod; items: T[] }[] = [];
  for (const item of items) {
    const period = historyPeriod(item.createdAt, now);
    const last = groups[groups.length - 1];
    if (last && last.period.key === period.key) last.items.push(item);
    else groups.push({ period, items: [item] });
  }
  return groups;
}

/** 묶음 제목 — 'older' 는 달 이름(올해가 아니면 연도까지) */
export function historyPeriodLabel(period: HistoryPeriod, now: Date, locale: string, t: (key: string) => string): string {
  if (period.kind !== 'older') return t(`ask.history.period.${period.kind}`);
  const sameYear = Number(serviceToday(now).slice(0, 4)) === period.year;
  return new Intl.DateTimeFormat(locale === 'en' ? 'en-US' : 'ko-KR', {
    month: 'long',
    ...(sameYear ? {} : { year: 'numeric' }),
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(period.year, period.month - 1, 15)));
}

/**
 * 지난 질문을 읽다 난 오류의 종류 — 404 는 보관 기간(90일)이 지나 없어진 것(목록도 다시 받는다), 403 은 회사가 꺼졌거나
 * 고지 재확인을 기다리는 것(질문 화면 전체가 안내로 바뀌어야 한다), 나머지는 잠시 뒤 다시 시도할 오류다.
 */
export type HistoryErrorKind = 'gone' | 'closed' | 'other';

const httpStatus = (err: unknown) => (err as { response?: { status?: unknown } } | null)?.response?.status;

export function historyErrorKind(err: unknown): HistoryErrorKind {
  const status = httpStatus(err);
  if (status === 404) return 'gone';
  if (status === 403) return 'closed';
  return 'other';
}

/** 저절로 한 번 더 불러 볼 오류인가 — 4xx 는 다시 불러도 같은 답이라 바로 알린다 */
export function retryHistoryLoad(failureCount: number, err: unknown): boolean {
  const status = httpStatus(err);
  if (typeof status === 'number' && status >= 400 && status < 500) return false;
  return failureCount < 1;
}

/** 질문한 때 — 한국 시간으로 날짜와 시각 */
export function formatAskedAt(iso: string, locale: string): string {
  return new Intl.DateTimeFormat(locale === 'en' ? 'en-US' : 'ko-KR', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'Asia/Seoul',
  }).format(new Date(iso));
}
