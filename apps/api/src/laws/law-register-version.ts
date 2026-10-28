import { UnprocessableEntityException } from '@nestjs/common';
import type { LawGoKrService } from '../lawgokr/lawgokr.service';
import { toDateOnlyString, todayDateOnly } from '../common/date-only';
import { needsNextPage } from './law-version-plan';

/**
 * 등록할 판 고르기 (T-150 ③, SRS LAW-15).
 *
 * 법령은 **현행 판으로** 등록한다. 시행 예정 판(MST)으로 등록하면 그 판의 본문이 기준판이 돼, 그 판이 바꾸는 조가 변경
 * 이벤트 없이 묻힌다(개정 후보도 생기지 않는다). 옛 판으로 등록하면 그 뒤 개정이 한꺼번에 이벤트가 된다. 그래서 요청한 판이
 * 현행이 아니면 같은 법령(법령ID)의 현행 판으로 등록하고, 시행 예정 판은 다음 동기화가 공포 순으로 반영해 이벤트로 남긴다.
 * 현행 판은 시행일법령 목록(`target=eflaw`)의 현행연혁코드('현행')로 안다 — 본문(`target=law`)에는 그 표시가 없다.
 * 아직 시행된 판이 없는 법령(제정 뒤 시행 전)은 기준으로 삼을 현행 본문이 없어 등록하지 않는다.
 */
export type RegisterVersion =
  /** 요청한 판이 현행이다(또는 목록으로 확인할 수 없다 — 법령ID 가 없으면 기존 판정에 맡긴다) */
  | { kind: 'requested' }
  /** 요청한 판은 현행이 아니다 — 이 판으로 등록한다 */
  | { kind: 'current'; mst: string }
  /** 현행 판이 없고 요청한 판은 시행 전이다 */
  | { kind: 'not_in_force' };

export const MAX_REGISTER_LIST_PAGES = 10;

export async function resolveRegisterVersion(
  lawGoKr: Pick<LawGoKrService, 'searchVersions'>,
  input: { mst: string; lawId: string | null; effectiveDate: string | null; today: string },
): Promise<RegisterVersion> {
  if (!input.lawId) return { kind: 'requested' };
  for (let page = 1; page <= MAX_REGISTER_LIST_PAGES; page++) {
    const res = await lawGoKr.searchVersions(input.lawId, page);
    const current = res.items.find((i) => i.lawId === input.lawId && i.status === '현행' && /^\d+$/.test(i.mst));
    if (current) return current.mst === input.mst ? { kind: 'requested' } : { kind: 'current', mst: current.mst };
    if (!needsNextPage(res, null)) break;
  }
  // 목록에 현행이 없다 — 요청한 판이 시행 전이면 등록하지 않는다. 이미 시행된 판(폐지 직전 등)이면 지금처럼 그 판으로
  return input.effectiveDate && input.effectiveDate > input.today ? { kind: 'not_in_force' } : { kind: 'requested' };
}

/** 등록할 판의 본문을 받는다 — 요청한 판이 현행이 아니면 현행 판의 본문. 현행 판이 없는 시행 전 법령은 422 `LAW_NOT_IN_FORCE` */
export async function fetchRegisterVersion(lawGoKr: Pick<LawGoKrService, 'getLaw' | 'searchVersions'>, requestedMst: string, now: Date = new Date()) {
  const requested = await lawGoKr.getLaw(requestedMst);
  const pick = await resolveRegisterVersion(lawGoKr, {
    mst: requestedMst,
    lawId: requested.meta.lawId,
    effectiveDate: requested.meta.effectiveDate,
    today: toDateOnlyString(todayDateOnly(now)),
  });
  if (pick.kind === 'not_in_force') {
    throw new UnprocessableEntityException({
      statusCode: 422,
      error: 'Unprocessable Entity',
      code: 'LAW_NOT_IN_FORCE',
      message: '아직 시행된 판이 없는 법령이라 등록할 수 없습니다 — 시행일이 지나면 다시 등록하세요.',
    });
  }
  if (pick.kind === 'requested') return { mst: requestedMst, ...requested };
  return { mst: pick.mst, ...(await lawGoKr.getLaw(pick.mst)) };
}
