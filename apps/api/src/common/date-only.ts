/**
 * 날짜만 다루는 컬럼(`@db.Date`)용 헬퍼.
 *
 * 시행일·개정일은 "그 날"이지 순간이 아니다. 로컬 타임존으로 파싱하면
 * 서버 타임존에 따라 하루가 밀려 시점 조회 결과가 달라지므로 UTC 자정으로 고정한다.
 */

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** `YYYY-MM-DD` → UTC 자정 Date. 형식이 어긋나면 null */
export function parseDateOnly(value: unknown): Date | null {
  const s = String(value ?? '').trim();
  const m = DATE_ONLY.exec(s);
  if (!m) return null;
  const [, y, mo, d] = m;
  const date = new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d)));
  if (Number.isNaN(date.getTime())) return null;
  // 2026-02-31 처럼 존재하지 않는 날짜가 굴러 들어오는 것을 막는다
  if (date.getUTCMonth() !== Number(mo) - 1 || date.getUTCDate() !== Number(d)) return null;
  return date;
}

/** Date → `YYYY-MM-DD` (UTC 기준) */
export function toDateOnlyString(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** 오늘(UTC 자정) */
export function todayDateOnly(): Date {
  return parseDateOnly(toDateOnlyString(new Date()))!;
}

/**
 * 선택 입력 날짜를 `@db.Date` 컬럼에 넣을 값으로 바꾼다.
 * 빈 값·null은 "지우기"로 보고 null, 형식이 어긋나면 예외 대신 null(검증은 DTO 몫).
 */
export function coerceNullableDate(value: unknown): Date | null {
  if (value == null || String(value).trim() === '') return null;
  // ISO 날짜시간(2026-08-04T00:00:00Z)도 날짜 부분만 취한다
  return parseDateOnly(String(value).slice(0, 10));
}
