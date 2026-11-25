import { serviceToday } from './serviceDate';

/**
 * 조문 버전의 날짜 3종(T-111, 특허 청구항 7) — 사내 규정 시행일 · 발행일시 · 법령 시행일.
 *
 * 적용 기준인 사내 시행일을 먼저 둔다. 시점 조회는 사내 시행일 하나로만 버전을 고르고, 발행일·법령 시행일은 기록이다.
 * - 발행일: 발행할 때 적은 것(T-108 부터) / 승인 기록으로 보정(T-111 이 승인 시각에서 옮겨 적은 옛 발행 이력) /
 *   기록 없음(승인 시각도 없는 옛 발행 이력 — 생성일·시행일로 대신 채우지 않는다)
 * - 법령 시행일: 개정 후보 승인으로 발행한 버전만 있다. 이벤트에 날짜가 없으면 기록 없음.
 *   사내 시행일이 더 이르면 "법령보다 조기 시행"(승인 때 사유를 받았다 — 오류가 아니다)
 */

export type VersionLawChange = {
  eventId: string;
  lawId: string;
  lawName: string;
  label: string;
  lawEffectiveDate: string | null;
};

export type VersionDateInput = {
  status: string;
  effectiveDate?: string | null;
  repealedOn?: string | null;
  publishedAt?: string | null;
  publishedAtFromApproval?: boolean | null;
  lawChange?: VersionLawChange | null;
};

export type VersionDates = {
  /** 사내 규정 시행일(YYYY-MM-DD) — 시점 조회의 기준 */
  effective: string | null;
  /** 시행본인데 사내 시행일이 아직 오지 않았다 */
  upcoming: boolean;
  /** 발행일시(한국 시각 YYYY-MM-DD HH:mm) */
  published: string | null;
  publishedBasis: 'recorded' | 'approval' | 'missing';
  law: (VersionLawChange & { date: string | null; early: boolean }) | null;
};

/** 한국 시각 YYYY-MM-DD HH:mm — 브라우저 시간대와 상관없이 serviceToday 와 같은 고정 오프셋 */
export function kstDateTime(iso: string): string {
  const s = new Date(new Date(iso).getTime() + 9 * 60 * 60 * 1000).toISOString();
  return `${s.slice(0, 10)} ${s.slice(11, 16)}`;
}

/** 발행 이력(시행본·이전 버전)만 날짜 3종이 있다 — 초안·검토 중이면 null */
export function versionDates(v: VersionDateInput, today: string = serviceToday()): VersionDates | null {
  if (v.status !== 'published' && v.status !== 'archived') return null;
  const effective = v.effectiveDate ? String(v.effectiveDate).slice(0, 10) : null;
  const published = v.publishedAt ? kstDateTime(v.publishedAt) : null;
  const lawDate = v.lawChange?.lawEffectiveDate ?? null;
  return {
    effective,
    // 시행일 전이면 시행 예정 — archived 라도(더 이른 날로 다른 버전을 승인해 내려간 시행 예정 버전도 그날 현재가 된다, T-127)
    upcoming: !!effective && effective > today && !v.repealedOn,
    published,
    publishedBasis: !published ? 'missing' : v.publishedAtFromApproval ? 'approval' : 'recorded',
    law: v.lawChange
      ? { ...v.lawChange, date: lawDate, early: !!(effective && lawDate && effective < lawDate) }
      : null,
  };
}

/** 한 줄 글로 — 연혁 탭·개정 이력 타임라인처럼 좁은 목록용. 버전 카드(VersionDatesLine)와 같은 순서·표기 */
export function formatVersionDates(d: VersionDates): string {
  const parts = [
    `사내 시행일 ${d.effective ?? '기록 없음'}${d.upcoming ? '(시행 예정)' : ''}`,
    `발행 ${d.published ?? '기록 없음'}${d.publishedBasis === 'approval' ? '(승인 기록으로 보정)' : ''}`,
  ];
  if (d.law) {
    parts.push(`법령 시행일 ${d.law.date ?? '기록 없음'}(${d.law.lawName} ${d.law.label}${d.law.early ? ', 법령보다 조기 시행' : ''})`);
  }
  return parts.join(' · ');
}
