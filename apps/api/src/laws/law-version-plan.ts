import type { LawSearchResultItem } from '../lawgokr/lawgokr.types';

/**
 * 법령 판 목록과 반영 계획 (T-151, PAT-07 — 특허 도 7 S770) — DB·법제처 없이 검사할 수 있는 순수 함수.
 *
 * **왜 판 목록이 필요한가.** 지금까지 동기화는 현행 목록(`target=law`)에서 가장 큰 MST 하나로 곧장 건너뛰었다.
 * 실호출(2026-10-14)로 보니 그 목록은 **현행만** 준다 — 공포됐지만 시행 전인 개정은 시행일이 돼야 보였고, 두 확인
 * 사이에 판이 여럿 공포되면 중간 판의 변경이 마지막 판의 공포일·시행일로 묶였다. 시행일법령 목록(`target=eflaw`)은
 * 연혁·현행·시행예정을 모두 준다. 이 목록에서 저장된 판 **뒤에 공포된 판 전부**를 공포 순으로 하나씩 반영한다.
 *
 * - 같은 MST 가 단계 시행일마다 따로 나온다(285279 → 2026-10-08·2026-12-08·2027-01-01) — MST 하나로 합치고 시행일을 모은다.
 * - 순서는 **공포 순**(공포일 → 공포번호 → MST)이다. 시행 순서와 다르다(290781 은 08-04 공포·10-02 시행, 285279 는
 *   04-07 공포·10-08 시행). 판 본문(`target=law`)은 그 판까지 공포된 개정을 모두 담으므로, 공포 순으로 이웃한 두 판의
 *   차이가 곧 뒤 판의 공포가 바꾼 조다. MST 번호 순서는 쓰지 않는다(2001년 이전 자료에서 공포 순과 어긋난다).
 */

/** 판 하나(같은 MST 의 단계 행을 합친 것) */
export interface LawVersionEntry {
  mst: string;
  lawId: string;
  title: string;
  /** YYYY-MM-DD */
  promulgationDate: string | null;
  promulgationNo: string | null;
  /** '일부개정' · '타법개정' · '폐지' 등 */
  revisionType: string | null;
  /** 이 판의 단계 시행일 — 오름차순, 겹친 것 없이 */
  stageEffectiveDates: string[];
  /** 단계 중 하나가 지금 시행 중(현행연혁코드 '현행') */
  current: boolean;
}

export type VersionListResult = { kind: 'ok'; versions: LawVersionEntry[] } | { kind: 'invalid'; reason: string };

const digits = (v: string | null | undefined) => String(v ?? '').replace(/\D/g, '');

/** 숫자 문자열 비교 — "9" < "21700", 빈 값은 가장 작다 */
function compareDigits(a: string | null | undefined, b: string | null | undefined): number {
  const x = digits(a).replace(/^0+/, '');
  const y = digits(b).replace(/^0+/, '');
  return x.length - y.length || (x < y ? -1 : x > y ? 1 : 0);
}

/**
 * 판 기록(`law_versions.order_key`)에 남기는 공포 순서 키 — 공포일(YYYYMMDD) + 공포번호(10자리) + MST(12자리).
 * 문자열 순서가 `compareVersions` 와 같다. 이 식은 여기 한 곳에만 둔다
 */
export function versionOrderKey(v: Pick<LawVersionEntry, 'promulgationDate' | 'promulgationNo' | 'mst'>): string {
  const day = (v.promulgationDate ?? '').replace(/-/g, '').padStart(8, '0');
  const no = digits(v.promulgationNo).replace(/^0+/, '').padStart(10, '0');
  return `${day}${no}${digits(v.mst).padStart(12, '0')}`;
}

/** 공포 순 — 공포일, 같은 날이면 공포번호, 그래도 같으면 MST */
export function compareVersions(a: LawVersionEntry, b: LawVersionEntry): number {
  const da = a.promulgationDate ?? '';
  const db = b.promulgationDate ?? '';
  if (da !== db) return da < db ? -1 : 1;
  return compareDigits(a.promulgationNo, b.promulgationNo) || compareDigits(a.mst, b.mst);
}

/**
 * 검색 행들에서 이 법령(법령ID)의 판 목록을 만든다. 다른 법령ID 의 행(이름이 겹치는 시행령 등)은 버린다.
 * 같은 MST 인데 공포일·공포번호가 서로 다르거나, 법령ID·MST 가 빈 행이 `since`(저장 판의 공포일) 뒤에 있으면 목록을 믿을 수 없어
 * 판단하지 않는다(invalid).
 */
export function groupVersions(items: LawSearchResultItem[], lawId: string, since: string | null = null): VersionListResult {
  const byMst = new Map<string, LawVersionEntry>();
  // 저장 판보다 옛 판이 분명한 행 — 공포일이 since 보다 앞이거나, 공포일이 없으면 시행일이 한 해 넘게 앞이다(보통 공포 ≤ 시행이지만
  // 소급 시행일 수 있어 여유를 둔다). 이런 행의 이상은 계획과 상관없어 멈추지 않는다(연혁 한 줄 때문에 법령 전체가 멈추지 않게, T-151 검토)
  const yearBefore = since ? `${Number(since.slice(0, 4)) - 1}${since.slice(4)}` : null;
  const isOld = (i: Pick<LawSearchResultItem, 'promulgationDate' | 'effectiveDate'>) =>
    !!since && (i.promulgationDate ? i.promulgationDate < since : !!i.effectiveDate && !!yearBefore && i.effectiveDate < yearBefore);
  for (const item of items) {
    if (item.lawId && item.lawId !== lawId) continue; // 다른 법령(이름이 겹치는 시행령 등)
    if (!item.lawId || !/^\d+$/.test(item.mst)) {
      // 법령ID·MST 가 빈 행은 어느 판인지 알 수 없다. 저장 판보다 옛 행이면 쓰지 않고, 그 뒤(같은 날 포함)면 사이 판이 빠질 수 있다 —
      // 조용히 버리면 그 판의 변경이 다음 판의 날짜로 묶인다(T-151 검토)
      if (isOld(item)) continue;
      return {
        kind: 'invalid',
        reason: `법제처 판 목록에 법령ID·MST 가 빈 행이 있습니다(공포일 ${item.promulgationDate ?? '없음'}) — 사이 판이 빠지지 않았다고 확인할 수 없어 반영하지 않습니다(목록이 고쳐질 때까지 같은 실패).`,
      };
    }
    if (!item.promulgationDate) {
      // 공포일이 없는 판은 공포 순서에 놓을 수 없다 — 맨 앞으로 줄 서면 저장 판이 옛 판들보다 앞에 서서 옛 판을 다시 반영하거나
      // (본문이 옛 문구로 돌아가고 이벤트·후보가 생긴다), 사이 판이 저장 판 앞으로 빠진다(T-151 검토). 옛 판이 분명하면 쓰지 않는다
      if (isOld(item)) continue;
      return {
        kind: 'invalid',
        reason: `법제처 판 목록에 공포일이 없는 판(MST ${item.mst})이 있습니다 — 공포 순서를 정할 수 없어 반영하지 않습니다(목록이 고쳐질 때까지 같은 실패).`,
      };
    }
    const prev = byMst.get(item.mst);
    if (!prev) {
      byMst.set(item.mst, {
        mst: item.mst,
        lawId: item.lawId,
        title: item.title,
        promulgationDate: item.promulgationDate,
        promulgationNo: item.promulgationNo,
        revisionType: item.revisionType,
        stageEffectiveDates: item.effectiveDate ? [item.effectiveDate] : [],
        current: item.status === '현행',
      });
      continue;
    }
    if (prev.promulgationDate !== item.promulgationDate || digits(prev.promulgationNo) !== digits(item.promulgationNo)) {
      if (isOld(item) && isOld({ promulgationDate: prev.promulgationDate, effectiveDate: null })) continue; // 둘 다 옛 판 — 계획과 상관없다
      return {
        kind: 'invalid',
        reason: `법제처 판 목록에서 같은 판(MST ${item.mst})의 공포일·공포번호가 서로 다릅니다 — 목록을 믿을 수 없어 반영하지 않습니다(목록이 고쳐질 때까지 같은 실패).`,
      };
    }
    if (item.effectiveDate && !prev.stageEffectiveDates.includes(item.effectiveDate)) prev.stageEffectiveDates.push(item.effectiveDate);
    if (item.status === '현행') prev.current = true;
  }
  const versions = [...byMst.values()];
  for (const v of versions) v.stageEffectiveDates.sort();
  versions.sort(compareVersions);
  return { kind: 'ok', versions };
}

export type VersionPlan =
  /** 저장된 판 뒤에 공포된 판들(공포 순). 비어 있으면 저장된 판이 마지막이다 */
  | { kind: 'pending'; pending: LawVersionEntry[]; stored: LawVersionEntry }
  /** 저장된 판을 목록에서 찾지 못했다 — 사이 판이 빠지지 않았다고 보장할 수 없어 반영하지 않는다 */
  | { kind: 'stored_missing' };

/** 저장된 판(MST) 뒤의 판들. 저장된 판이 목록에 없으면 멈춘다(공포일만으로 자리를 짐작하지 않는다) */
export function planVersions(versions: LawVersionEntry[], storedMst: string): VersionPlan {
  const at = versions.findIndex((v) => v.mst === storedMst);
  if (at < 0) return { kind: 'stored_missing' };
  return { kind: 'pending', pending: versions.slice(at + 1), stored: versions[at] };
}

/**
 * 폐지 판 — 본문을 받아 조항을 지우는 이벤트로 만들지 않고 멈춘다(사람이 추적 해제를 정한다). 다른 법률의 부칙으로 폐지되는
 * '타법폐지'·여러 법령을 한꺼번에 없애는 '일괄폐지'도 폐지다. '폐지제정'(없애고 새로 만듦)은 아니다 — 정확히 견준다
 */
const REPEAL_TYPES = new Set(['폐지', '타법폐지', '일괄폐지']);
export const isRepealVersion = (v: Pick<LawVersionEntry, 'revisionType'>) => REPEAL_TYPES.has((v.revisionType ?? '').trim());

/**
 * 공포일 내림차순으로 받은 한 쪽을 보고 다음 쪽이 필요한지 — 뒤에 쪽이 더 있고(전체 건수 기준 — 걸러 낸 뒤의 행 수로
 * 판단하면 한 행만 빠져도 "마지막 쪽"으로 잘못 본다), 그 쪽의 가장 오래된 행이 아직 기준 공포일보다 늦거나 같으면 더
 * 오래된 행(저장된 판 포함)이 다음 쪽에 있을 수 있다. 기준 공포일을 모르면 끝까지 받는다
 */
export function needsNextPage(
  res: { page: number; display: number; total: number; items: Pick<LawSearchResultItem, 'promulgationDate'>[] },
  baselineDate: string | null,
): boolean {
  if (res.page * res.display >= res.total) return false;
  if (!baselineDate) return true;
  const pageItems = res.items;
  const oldest = pageItems.reduce<string | null>((min, i) => {
    const d = i.promulgationDate;
    return d && (!min || d < min) ? d : min;
  }, null);
  return !oldest || oldest >= baselineDate;
}

/** 판 표기 — '법률 제21533호(2026-04-07 공포)' 처럼 사람이 아는 이름. 공포번호가 없으면 MST */
export function versionLabel(v: Pick<LawVersionEntry, 'mst' | 'promulgationNo' | 'promulgationDate'>): string {
  const no = digits(v.promulgationNo).replace(/^0+/, '');
  const head = no ? `제${no}호` : `MST ${v.mst}`;
  return v.promulgationDate ? `${head}(${v.promulgationDate} 공포)` : head;
}
