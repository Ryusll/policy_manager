/**
 * 나중에 확정한 연결로 개정 후보 만들기의 규칙 (T-149) — 확정 시점 경로와 배포 때 일괄 처리(한 번)가 같은 함수를 쓴다.
 *
 * 동기화 끝 자동 생성(T-106)은 이벤트를 처리할 때 이미 확정된 연결만 본다. 그 뒤에 확정한 연결의 조문은 화면에서 직접
 * 만들어야 해서 대표 시연 흐름(법령 등록 → 규정 가져오기 → 연결 확정 → 후보)이 끊겼다. 여기 규칙이 그 틈을 메운다.
 */

/** 법령 시행일이 오늘(한국 날짜) − 이 일수 이후(그날 포함)인 변경만 — 그보다 오래된 개정은 화면에서 직접 만든다 */
export const CATCHUP_WINDOW_DAYS = 30;

/**
 * T-148(위 조항 연결로도 후보)이 운영에 반영된 시각 — 1차 운영 반영(T-186)의 새 API 컨테이너 시작(대장 T-149 행: 10/31 12:40Z 에 읽은
 * `docker inspect` 의 StartedAt, 그 시각을 사이에 둔 동기화 실행은 없다). 그 전에 처리된 이벤트는 위 조항 연결 조문을 보지 않았다.
 * 배포 때 한 번 돌리는 일괄 처리만 쓴다 — 운영에서 돌린 뒤에는 걷어내도 된다
 */
export const T148_DEPLOYED_AT = new Date('2026-10-31T11:12:12Z');

/** 일괄 처리 상한 — 넘으면 만들지 않고 PM 에게 묻는다(대장 T-149). PM 이 승인하면 명령의 --max-total·--max-per-tenant 로 올린다 */
export const CATCHUP_MAX_TOTAL = 100;
export const CATCHUP_MAX_PER_TENANT = 20;

const DAY_MS = 86_400_000;

/** 창의 첫날 — `today` 는 todayDateOnly()(한국 날짜의 UTC 자정)이고, 법령 시행일도 같은 꼴(@db.Date)이라 바로 비교한다 */
export function windowStart(today: Date): Date {
  return new Date(today.getTime() - CATCHUP_WINDOW_DAYS * DAY_MS);
}

type EventTimes = { lawEffectiveDate: Date | null; detectedAt: Date; amendmentsProcessedAt: Date | null };

/**
 * 기능 도입 전 이벤트 — T-106 마이그레이션이 처리 시각을 감지 시각으로 채워 자동 생성에서 뺐다. 동기화 끝 처리는 처리 시각을
 * 따로 적으므로 두 값이 같을 일이 없다. 일괄 처리는 이 이벤트로 만들지 않는다(대장 T-149) — 확정 시점 경로는 창만 본다
 */
export function isPreFeature(e: Pick<EventTimes, 'detectedAt' | 'amendmentsProcessedAt'>): boolean {
  return e.amendmentsProcessedAt !== null && e.amendmentsProcessedAt.getTime() === e.detectedAt.getTime();
}

/**
 * 연결을 확정할 때 후보를 만들 변경 — 법령 시행일이 있고 창 안인 것(대장 T-149 는 창만 건다). 처리 여부는 보지 않는다:
 * 아직 처리하지 않은 변경도 만든다(동기화가 그 변경을 처리하는 순간과 겹쳐도 놓치지 않게 — 나중 처리는 이미 후보가 있는 조문을 건너뛴다)
 */
export function inConfirmWindow(e: Pick<EventTimes, 'lawEffectiveDate'>, today: Date): boolean {
  return e.lawEffectiveDate !== null && e.lawEffectiveDate.getTime() >= windowStart(today).getTime();
}

/** 일괄 처리가 볼 변경 — 이미 처리됐고(처리 전 변경은 동기화 끝 자동 생성이 맡는다) 기능 도입 전 이벤트가 아니며, 확정 시점 경로와 같은 창 */
export function inCatchupWindow(e: EventTimes, runDay: Date): boolean {
  return e.amendmentsProcessedAt !== null && !isPreFeature(e) && inConfirmWindow(e, runDay);
}

/** ㉠ 위 조항 연결인데 T-148 전에 처리돼 빠진 것, ㉡ 처리 뒤에 확정해 빠진 것 */
export type CatchupReason = 'parent_before_t148' | 'confirmed_after_processing';

/**
 * 일괄 처리 대상 조문인가 — 그 조문에 닿는 연결 가운데 가장 가까운 것(closestPerArticle) 하나로 본다.
 * 확정 시각이 비어 있으면 생성 시각으로 본다(확정하는 두 경로는 늘 확정 시각을 남기므로 빈 것은 DB 에 직접 넣은 행뿐이다).
 * 직접 연결이 처리 때 이미 있었는데 후보가 없는 조문은 처리 때 까닭이 있어 건너뛴 것(시행일 미기록·기준 본문 없음·폐지)이라 넣지 않는다
 */
export function catchupReason(
  link: { viaParent: boolean; confirmedAt: Date | null; createdAt: Date },
  processedAt: Date,
): CatchupReason | null {
  const confirmed = (link.confirmedAt ?? link.createdAt).getTime();
  if (confirmed > processedAt.getTime()) return 'confirmed_after_processing';
  if (link.viaParent && processedAt.getTime() < T148_DEPLOYED_AT.getTime()) return 'parent_before_t148';
  return null;
}

/** 상한 확인 — 합계가 넘었는지, 넘은 회사들. 같은 수(100·20)는 통과한다 */
export function overCap(perTenant: Map<string, number>, caps: { total: number; perTenant: number }) {
  const total = [...perTenant.values()].reduce((a, b) => a + b, 0);
  const overTotal = total > caps.total;
  const overTenants = [...perTenant].filter(([, n]) => n > caps.perTenant).map(([tenantId]) => tenantId);
  return { total, overTotal, overTenants, over: overTotal || overTenants.length > 0 };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * 잘못된 행(연결의 회사 ≠ 조문의 회사)을 지우는 SQL — 코드는 지우지 않고 사용자가 운영 DB 에서 돌린다. 계획이 낸 id 만, 그리고
 * 돌리는 순간에도 여전히 잘못된 행만 지운다(그 사이 바로잡힌 행은 남는다). 지우면 그 연결을 가리키던 후보의 law_link_id 는
 * 비워지고(ON DELETE SET NULL) 근거 스냅샷은 남는다
 */
export function deleteInvalidLinksSql(ids: string[]): string | null {
  if (!ids.length) return null;
  const bad = ids.filter((id) => !UUID.test(id));
  if (bad.length) throw new Error(`연결 id 형식이 아닙니다: ${bad.join(', ')}`);
  return [
    'DELETE FROM law_links ll USING articles a, chapters c, policies p',
    `WHERE ll.id IN (${ids.map((id) => `'${id}'`).join(', ')})`,
    '  AND a.id = ll.article_id AND c.id = a.chapter_id AND p.id = c.policy_id AND p.tenant_id <> ll.tenant_id;',
  ].join('\n');
}

/** 후보를 만든 까닭 — 감사 기록 details.origin 과 알림 문구 */
export type CandidateOrigin = 'link_confirm' | 'catchup';

/** 회사마다 알림 하나 — 개정 후보 목록으로 보낸다(판 단위 묶음 T-159 와 별개). 후보는 초안일 뿐이라 '반영'은 승인 뒤의 일로만 쓴다 */
export function bundleNotice(n: { events: number; articles: number; created: number; origin: CandidateOrigin }) {
  const span = `최근 ${CATCHUP_WINDOW_DAYS}일 안에 시행됐거나 앞으로 시행될 법령 개정 ${n.events}건`;
  const made =
    n.origin === 'link_confirm'
      ? `법령 관계를 확정한 조문 ${n.articles}곳에 개정 후보 ${n.created}건을 만들었습니다(${span}).`
      : `그동안 만들지 못한 개정 후보 ${n.created}건을 우리 조문 ${n.articles}곳에 만들었습니다(${span}).`;
  return { title: `[법령 개정] 개정 후보 ${n.created}건`, body: [made, '검토하고 승인해야 우리 규정에 반영됩니다.'].join('\n'), link: '/amendments' };
}

/**
 * 연결은 확정했는데 후보를 못 만들었을 때 — 받는 사람이 법령 화면에서 직접 만들게 한다(실패를 서버 로그에만 두지 않는다).
 * 법령이 하나면 그 법령 화면으로, 여럿(여러 건 확정)이면 법령 목록으로 보내고 본문에 법령 이름을 적는다
 */
export function failureNotice(n: { failed: number; lawId: string | null; lawNames: string[] }) {
  const names = n.lawNames.length ? `(${n.lawNames.slice(0, 3).join(', ')}${n.lawNames.length > 3 ? ` 외 ${n.lawNames.length - 3}개` : ''})` : '';
  return {
    title: '[법령 개정] 개정 후보를 만들지 못했습니다',
    body: [
      n.failed ? `법령 관계는 확정했지만, 법령 개정 ${n.failed}건으로는 개정 후보를 만들지 못했습니다${names}.` : `법령 관계는 확정했지만 개정 후보를 만들지 못했습니다${names}.`,
      "법령 화면에서 그 개정을 펼쳐 '개정 후보 만들기'로 만들어 주세요.",
    ].join('\n'),
    link: n.lawId ? `/laws/${n.lawId}` : '/laws',
  };
}
