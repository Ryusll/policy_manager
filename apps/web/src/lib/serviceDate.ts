/**
 * 서비스 기준 "오늘" — 한국 날짜(YYYY-MM-DD). 서버의 `todayDateOnly` 와 같은 날이다(T-126).
 *
 * UTC 로 만들면 한국 시간 0~9시에 하루 이르고, 브라우저 시간대를 따르면 해외에서 접속할 때 서버와 어긋난다.
 * 한국은 서머타임이 없어 고정 오프셋이면 된다.
 */
export function serviceToday(now: Date = new Date()): string {
  return new Date(now.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}
