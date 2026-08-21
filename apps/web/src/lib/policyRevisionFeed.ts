/**
 * 최근 개정 · 제·개정 예고 (T-78).
 *
 * 날짜는 **문자열(YYYY-MM-DD) 그대로** 비교한다. `new Date()`로 바꾸면 서버가 준
 * 날짜-전용 값이 브라우저 표준시로 해석돼 하루씩 밀린다(시행일이 오늘인 규정이
 * 어제 것으로 보이는 식). 사전식 정렬이 곧 날짜 순이라 문자열 비교로 충분하다.
 */

export type RevisionFeedPolicy = {
  id: string;
  code: string;
  title: string;
  isActive?: boolean;
  /** 개정일 (YYYY-MM-DD 또는 ISO) */
  revisionDate?: string | null;
  /** 시행일 (YYYY-MM-DD 또는 ISO) */
  effectiveDate?: string | null;
};

/** ISO든 날짜-전용이든 앞 10자리만 쓴다 */
export function dateKey(value?: string | null): string | null {
  if (!value) return null;
  const key = String(value).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(key) ? key : null;
}

/** 오늘 날짜를 로컬 기준 YYYY-MM-DD 로 (UTC 로 만들면 자정 근처에 하루가 어긋난다) */
export function todayKey(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * 최근 개정 — 개정일이 오늘까지인 규정을 최신순으로.
 * 개정일이 없는 규정은 넣지 않는다(등록만 하고 개정일을 안 적은 것을 개정으로 보면 안 된다).
 */
export function recentlyRevised<T extends RevisionFeedPolicy>(
  policies: T[],
  limit = 5,
  today = todayKey(),
): (T & { dateKey: string })[] {
  return policies
    .map((p) => ({ ...p, dateKey: dateKey(p.revisionDate) }))
    .filter((p): p is T & { dateKey: string } => p.dateKey != null && p.dateKey <= today)
    .sort((a, b) => b.dateKey.localeCompare(a.dateKey))
    .slice(0, limit);
}

/**
 * 제·개정 예고 — 시행일이 **아직 오지 않은** 규정을 가까운 순으로.
 * 시행 전에 미리 알리는 것이 목적이라 오늘 시행분은 이미 시행된 것으로 본다.
 */
export function upcomingEffective<T extends RevisionFeedPolicy>(
  policies: T[],
  limit = 5,
  today = todayKey(),
): (T & { dateKey: string; daysLeft: number })[] {
  return policies
    .map((p) => ({ ...p, dateKey: dateKey(p.effectiveDate) }))
    .filter((p): p is T & { dateKey: string } => p.dateKey != null && p.dateKey > today)
    .sort((a, b) => a.dateKey.localeCompare(b.dateKey))
    .slice(0, limit)
    .map((p) => ({ ...p, daysLeft: daysBetween(today, p.dateKey) }));
}

/** 두 날짜-전용 키 사이의 일수. 표준시 영향을 받지 않도록 UTC 자정으로 고정해 뺀다. */
export function daysBetween(from: string, to: string): number {
  const a = Date.UTC(+from.slice(0, 4), +from.slice(5, 7) - 1, +from.slice(8, 10));
  const b = Date.UTC(+to.slice(0, 4), +to.slice(5, 7) - 1, +to.slice(8, 10));
  return Math.round((b - a) / 86_400_000);
}
