import type { Prisma } from '@prisma/client';
import { toDateOnlyString } from '../common/date-only';
import { labelFromNodeKey } from '../laws/law-rows';

/**
 * 조문 버전이 이어진 법령 변경 — 날짜 3종 중 "법령 시행일"(T-111, 특허 청구항 7).
 *
 * 개정 후보 승인으로 발행한 버전만 변경 이벤트를 가리킨다(`changeEventId`, T-108). 법령 시행일은 그 이벤트의 값을 읽고
 * 버전에 따로 옮겨 적지 않는다 — 후보가 이벤트를 Restrict 로 붙잡고(T-106) 법령 추적 해제도 후보가 있으면 막혀서,
 * 버전이 남아 있는 동안 이벤트가 지워지지 않는다. 연결이 없는 버전은 법령 시행일을 보이지 않는다(그 법령의 최신
 * 시행일로 대신하지 않는다). 시점 조회의 기준은 여전히 사내 규정 시행일(`effectiveDate`) 하나다.
 */
export const VERSION_LAW_CHANGE = {
  select: {
    id: true,
    lawId: true,
    nodeKey: true,
    lawEffectiveDate: true,
    law: { select: { lawName: true } },
    lawArticle: { select: { label: true } },
  },
} satisfies Prisma.LawChangeEventDefaultArgs;

type LawChangeRow = Prisma.LawChangeEventGetPayload<typeof VERSION_LAW_CHANGE>;

export function presentLawChange(e: LawChangeRow | null) {
  if (!e) return null;
  return {
    eventId: e.id,
    lawId: e.lawId,
    lawName: e.law.lawName,
    // 조항 행이 없으면(T-124 전 동기화가 법령에서 사라진 조항을 지웠다) nodeKey 로 표기를 되살린다
    label: e.lawArticle?.label ?? labelFromNodeKey(e.nodeKey),
    /** 법령 시행일 — 이벤트에 없으면 null(화면은 "기록 없음") */
    lawEffectiveDate: e.lawEffectiveDate ? toDateOnlyString(e.lawEffectiveDate) : null,
  };
}

/** 버전 행의 `changeEvent` 를 화면이 쓰는 `lawChange` 로 바꾼다 */
export function withLawChange<V extends { changeEvent: LawChangeRow | null }>(v: V) {
  const { changeEvent, ...rest } = v;
  return { ...rest, lawChange: presentLawChange(changeEvent) };
}
