/**
 * 법령 개정 영향 분석(T-105)의 판정 규칙 — DB 없이 검사할 수 있도록 떼어 냈다.
 */

/**
 * 영향 분석 기준일 — "제1 조문"(개정 후보의 기준이 되는 사내 조문 본문)을 고르는 날.
 *
 * - **법령 개정이 아직 시행 전**이면 그 시행일. 그날 시행될 우리 조문이 고쳐야 할 대상이다
 *   (회사가 미리 승인해 둔 개정본이 있으면 그것이 기준이 된다).
 * - **이미 시행된 개정**(늦게 발견했거나 시행일이 지났다)이면 오늘. 그 사이 회사가 이미
 *   고쳤다면 고친 본문이 기준이어야 한다 — 시행일 시점의 옛 본문으로 초안을 만들면 이미
 *   반영한 내용을 되돌리는 초안이 나온다.
 * - 법령 시행일을 모르면 오늘.
 */
export function impactReferenceDate(lawEffectiveDate: Date | null, today: Date): Date {
  if (!lawEffectiveDate) return today;
  return lawEffectiveDate.getTime() > today.getTime() ? lawEffectiveDate : today;
}
