import { kstDayStart } from '../common/date-only';

/**
 * 감사 로그 조회 조건 조립 (T-11).
 *
 * 화면에서 오는 값은 문자열이라 그대로 Prisma 에 넘기면 조용히 무시되거나 터진다.
 * 날짜·페이지·필터 해석을 한곳에 모아 두고 순수 함수로 검사한다.
 */

export type AuditQueryInput = {
  action?: string;
  userId?: string;
  /** YYYY-MM-DD — 한국 시간 그날 0시부터 */
  from?: string;
  /** YYYY-MM-DD — 한국 시간 그날 끝까지(끝날을 포함하지 않으면 "오늘"을 골라도 오늘 게 안 나온다) */
  to?: string;
  page?: string | number;
  limit?: string | number;
};

export type AuditQueryPlan = {
  where: Record<string, unknown>;
  skip: number;
  take: number;
  page: number;
  limit: number;
};

export const AUDIT_PAGE_SIZE = 50;
export const AUDIT_MAX_PAGE_SIZE = 200;

function toInt(value: unknown, fallback: number): number {
  const n = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * `action` 은 정확히 일치와 앞자리 일치를 함께 받는다.
 *
 * 실제 조회는 "버전 관련 전부"처럼 묶어서 보게 되는데, 우리 액션 이름이
 * `version.approve` / `version.reject` 처럼 점으로 갈라져 있어서 접두어가 곧 분류다.
 * 끝에 `.` 을 붙여 보내면(`version.`) 그 묶음 전체가 된다.
 */
export function buildAuditWhere(tenantId: string, input: AuditQueryInput): Record<string, unknown> {
  const where: Record<string, unknown> = { tenantId };

  const action = String(input.action ?? '').trim();
  if (action) {
    where.action = action.endsWith('.') ? { startsWith: action } : action;
  }

  const userId = String(input.userId ?? '').trim();
  if (userId) where.userId = userId;

  // 날짜는 **한국 날짜**로 자른다(T-129). UTC 하루로 자르면 한국 시간 0~9시 기록이 전날로 잡혀, 오늘을 고르면
  // 오늘 0~9시 기록이 빠지고 다음 날 0~9시 기록이 들어온다. 없는 날짜(2026-02-31)는 거르지 않는다.
  const createdAt: Record<string, Date> = {};
  const from = kstDayStart(String(input.from ?? '').trim());
  const to = kstDayStart(String(input.to ?? '').trim());
  if (from) createdAt.gte = from;
  // 끝날을 포함해야 한다 — 다음 날(한국) 0시 "미만"
  if (to) createdAt.lt = new Date(to.getTime() + 24 * 60 * 60 * 1000);
  if (Object.keys(createdAt).length) where.createdAt = createdAt;

  return where;
}

export function buildAuditQuery(tenantId: string, input: AuditQueryInput): AuditQueryPlan {
  const limit = Math.min(AUDIT_MAX_PAGE_SIZE, Math.max(1, toInt(input.limit, AUDIT_PAGE_SIZE)));
  const page = Math.max(1, toInt(input.page, 1));
  return {
    where: buildAuditWhere(tenantId, input),
    skip: (page - 1) * limit,
    take: limit,
    page,
    limit,
  };
}

/**
 * 목록에서 `details` 를 통째로 돌려주지 않는 이유.
 *
 * 템플릿 수정 기록의 `details` 에는 before/after 스냅샷이 들어 있다(레이아웃 JSON + CSS 전문).
 * 50건이면 응답이 수 MB 가 되고, 정작 목록에서는 펼치기 전까지 쓰지 않는다.
 * 목록은 "무엇이 담겨 있는지"만 알려 주고 본문은 상세 조회에서 받는다.
 */
export function summarizeDetails(details: unknown): { hasDetails: boolean; keys: string[] } {
  if (!details || typeof details !== 'object' || Array.isArray(details)) {
    return { hasDetails: false, keys: [] };
  }
  const keys = Object.keys(details as Record<string, unknown>);
  return { hasDetails: keys.length > 0, keys };
}
