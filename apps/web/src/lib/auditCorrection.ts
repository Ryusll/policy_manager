/**
 * 감사 로그 정정(T-178) 화면 도우미 — 정정 기록 action 과 대상별 기록 주소. 정정 action 은 서버의 정정 짝 표
 * (apps/api/src/audit/audit-correction.ts CORRECTION_TARGETS)의 열쇠와 같아야 한다(단위 시험이 맞춰 본다).
 */
export const CORRECTION_ACTIONS: ReadonlySet<string> = new Set(['amendment.reject_correct', 'version.withdraw']);

/** 한 대상의 감사 기록 목록 주소 — 감사 로그 화면이 주소의 entityType·entityId 로 거른다 */
export function auditEntityHref(entityType: string, entityId: string): string {
  return `/audit-logs?${new URLSearchParams({ entityType, entityId }).toString()}`;
}

/** 주소에서 대상 필터를 읽는다 — 둘 다 있을 때만(종류만 있으면 거르지 않는다), 길이는 서버 한도(64) 안 */
export function entityFilterFrom(params: URLSearchParams): { entityType: string; entityId: string } | null {
  const entityType = (params.get('entityType') ?? '').trim();
  const entityId = (params.get('entityId') ?? '').trim();
  if (!entityType || !entityId || entityType.length > 64 || entityId.length > 64) return null;
  return { entityType, entityId };
}
