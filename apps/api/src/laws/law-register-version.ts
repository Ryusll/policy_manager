import { BadGatewayException, UnprocessableEntityException } from '@nestjs/common';
import type { LawGoKrService } from '../lawgokr/lawgokr.service';
import type { LawSearchResultItem } from '../lawgokr/lawgokr.types';
import { toDateOnlyString, todayDateOnly } from '../common/date-only';
import { baseVersionIndex, groupVersions, needsNextPage, versionLabel } from './law-version-plan';

/**
 * 등록할 판 고르기 (T-150 ③, SRS LAW-15).
 *
 * 법령은 **현행 판으로** 등록한다. 시행 예정 판(MST)으로 등록하면 그 판의 본문이 기준판이 돼, 그 판이 바꾸는 조가 변경
 * 이벤트 없이 묻힌다(개정 후보도 생기지 않는다). 옛 판으로 등록하면 그 뒤 개정이 한꺼번에 이벤트가 된다. 그래서 요청한 판이
 * 현행이 아니면 같은 법령(법령ID)의 현행 판으로 등록하고, 시행 예정 판은 다음 동기화가 공포 순으로 반영해 이벤트로 남긴다.
 * 현행 판은 시행일법령 목록(`target=eflaw`)의 현행연혁코드('현행')로 안다 — 본문(`target=law`)에는 그 표시가 없다.
 * 아직 시행된 판이 없는 법령(제정 뒤 시행 전)은 기준으로 삼을 현행 본문이 없어 등록하지 않는다.
 * 판 목록이 비었거나 쪽 상한까지 현행을 찾지 못하면 등록하지 않는다 — 시행 전이라고, 또는 요청한 옛 판이 맞다고 짐작하지 않는다(T-150 검토).
 * 현행 판보다 먼저 공포됐지만 아직 시행 전인 판이 있으면 그 판의 바로 앞 판으로 등록한다 — 판 본문은 공포 순으로 쌓여 현행 판 본문에
 * 그 개정이 이미 들어 있다(`baseVersionIndex`, T-150 검토). 다음 동기화가 그 판부터 공포 순으로 반영해 변경 이벤트를 남긴다.
 * 고른 판의 단계 시행일(같은 MST 의 시행일 행들)을 함께 돌려준다 — 기준판이 첫 단계부터 현행으로 보이게(T-150 검토). 읽은 쪽 밖의 단계는
 * 다음 동기화가 채운다(`ensureStoredVersionRow`).
 */
export type RegisterVersion =
  /** 요청한 판이 현행이다(또는 목록으로 확인할 수 없다 — 법령ID 가 없으면 기존 판정에 맡긴다) */
  | { kind: 'requested'; stageEffectiveDates: string[] }
  /**
   * 요청한 판이 아닌 이 판으로 등록한다 — 현행 판, 또는 현행보다 먼저 공포된 시행 전 판이 있으면 그 판의 바로 앞 판.
   * 뒤 경우 `beforePending` 에 그 시행 전 판의 이름을 싣는다 — 등록 알림이 '현행 판으로 등록'이라고 하지 않게(T-150 마지막 검토)
   */
  | { kind: 'current'; mst: string; stageEffectiveDates: string[]; beforePending?: string }
  /** 현행 판이 없고 요청한 판은 시행 전이다 */
  | { kind: 'not_in_force' }
  /** 판 목록이 비었거나(법제처 이상)·믿을 수 없거나·쪽 상한까지 현행이 없거나·기준으로 삼을 앞 판이 없다 — 판을 고를 수 없다 */
  | { kind: 'list_unavailable'; reason: 'empty' | 'invalid' | 'too_long' | 'no_base' };

export const MAX_REGISTER_LIST_PAGES = 10;

/** 같은 MST 의 시행일 행들 — 단계 시행 판은 시행일마다 한 행이다 */
function stagesOf(items: LawSearchResultItem[], mst: string): string[] {
  return [...new Set(items.filter((i) => i.mst === mst && i.effectiveDate).map((i) => i.effectiveDate!))].sort();
}

export async function resolveRegisterVersion(
  lawGoKr: Pick<LawGoKrService, 'searchVersions'>,
  input: { mst: string; lawId: string | null; effectiveDate: string | null; today: string },
): Promise<RegisterVersion> {
  if (!input.lawId) return { kind: 'requested', stageEffectiveDates: [] };
  // 오늘 세 해 전까지 받는다 — 목록은 공포일 내림차순이라 기준일을 넘는 쪽까지 받으면 현행 판과 그보다 먼저 공포된 시행 전 판, 그 앞 판이
  // 모두 들어온다. 그보다 옛 행의 이상(빈 공포일 등)은 판단에 쓰지 않는다(`groupVersions`)
  const since = `${Number(input.today.slice(0, 4)) - 3}${input.today.slice(4)}`;
  const items: LawSearchResultItem[] = [];
  let complete = false;
  for (let page = 1; page <= MAX_REGISTER_LIST_PAGES; page++) {
    const res = await lawGoKr.searchVersions(input.lawId, page);
    items.push(...res.items);
    if (!needsNextPage(res, since)) {
      complete = true;
      break;
    }
  }
  if (!items.some((i) => i.lawId === input.lawId)) return { kind: 'list_unavailable', reason: 'empty' };
  const grouped = groupVersions(items, input.lawId, since);
  if (grouped.kind === 'invalid') return { kind: 'list_unavailable', reason: 'invalid' };
  const versions = grouped.versions;
  const current = versions.findIndex((v) => v.current);
  if (current === -1) {
    if (!complete) return { kind: 'list_unavailable', reason: 'too_long' };
    // 목록에 현행이 없다 — 요청한 판이 시행 전이면 등록하지 않는다. 이미 시행된 판(폐지 직전 등)이면 지금처럼 그 판으로
    return input.effectiveDate && input.effectiveDate > input.today
      ? { kind: 'not_in_force' }
      : { kind: 'requested', stageEffectiveDates: stagesOf(items, input.mst) };
  }
  // 현행 판보다 먼저 공포됐지만 아직 시행 전인 판이 있으면 그 앞 판으로 — 현행 판 본문에는 그 개정이 이미 들어 있어 묻힌다
  const base = baseVersionIndex(versions, current, input.today);
  if (base === null) return { kind: 'list_unavailable', reason: 'no_base' };
  const { mst, stageEffectiveDates } = versions[base];
  if (mst === input.mst) return { kind: 'requested', stageEffectiveDates };
  return base < current
    ? { kind: 'current', mst, stageEffectiveDates, beforePending: versionLabel(versions[base + 1]) }
    : { kind: 'current', mst, stageEffectiveDates };
}

/**
 * 등록할 판의 본문을 받는다 — 요청한 판이 현행이 아니면 현행 판의 본문. 현행 판이 없는 시행 전 법령은 422 `LAW_NOT_IN_FORCE`,
 * 판 목록으로 판을 고를 수 없으면 502 `LAW_VERSION_LIST_UNAVAILABLE`.
 */
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
  if (pick.kind === 'list_unavailable') {
    throw new BadGatewayException({
      statusCode: 502,
      error: 'Bad Gateway',
      code: 'LAW_VERSION_LIST_UNAVAILABLE',
      message:
        pick.reason === 'empty'
          ? '법제처 판 목록을 받지 못해 현행 판을 알 수 없어 등록하지 않았습니다 — 잠시 뒤 다시 시도하세요.'
          : '법제처 판 목록으로 등록할 판을 정하지 못해 등록하지 않았습니다 — 아스트룸에 문의하세요.',
    });
  }
  if (pick.kind === 'requested') return { mst: requestedMst, stageEffectiveDates: pick.stageEffectiveDates, beforePending: undefined, ...requested };
  return { mst: pick.mst, stageEffectiveDates: pick.stageEffectiveDates, beforePending: pick.beforePending, ...(await lawGoKr.getLaw(pick.mst)) };
}
