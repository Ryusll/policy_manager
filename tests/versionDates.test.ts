import { describe, it, expect } from 'vitest';
import { formatVersionDates, kstDateTime, versionDates } from '../apps/web/src/lib/versionDates';

/**
 * 조문 버전의 날짜 3종 표시(T-111, 특허 청구항 7) — 사내 규정 시행일 · 발행일시 · 법령 시행일.
 *
 * 막고 싶은 사고: 보정한 발행일을 그때 기록한 것처럼 보이기, 기록 없는 발행일을 다른 날짜로 메우기,
 * 법령 시행일을 사내 시행일과 섞기, 아직 시행 전인 시행본을 시행 중처럼 보이기.
 */

const TODAY = '2026-10-09';
const law = { eventId: 'e1', lawId: 'l1', lawName: '근로기준법', label: '제60조제1항', lawEffectiveDate: '2026-11-01' };

describe('versionDates', () => {
  it('초안·검토 중은 날짜 3종이 없다 — 아직 발행 이력이 아니다', () => {
    expect(versionDates({ status: 'draft', effectiveDate: '2026-10-01' }, TODAY)).toBeNull();
    expect(versionDates({ status: 'review', publishedAt: '2026-10-01T00:00:00Z' }, TODAY)).toBeNull();
  });

  it('발행일 출처 — 그때 기록 / 승인 기록으로 보정 / 기록 없음(다른 날짜로 메우지 않는다)', () => {
    const recorded = versionDates({ status: 'published', effectiveDate: '2026-10-01', publishedAt: '2026-09-30T05:03:00Z' }, TODAY)!;
    expect(recorded.publishedBasis).toBe('recorded');
    expect(recorded.published).toBe('2026-09-30 14:03');

    const backfilled = versionDates(
      { status: 'archived', effectiveDate: '2026-07-01', publishedAt: '2026-06-30T01:00:00Z', publishedAtFromApproval: true },
      TODAY,
    )!;
    expect(backfilled.publishedBasis).toBe('approval');

    const missing = versionDates({ status: 'published', effectiveDate: '2026-07-01T00:00:00.000Z', publishedAt: null }, TODAY)!;
    expect(missing.publishedBasis).toBe('missing');
    expect(missing.published).toBeNull();
    expect(missing.effective).toBe('2026-07-01');
    // 보정 표시가 남아 있어도 값이 없으면 기록 없음이다
    expect(versionDates({ status: 'published', publishedAt: null, publishedAtFromApproval: true }, TODAY)!.publishedBasis).toBe('missing');
  });

  it('발행일시는 한국 시각 — 브라우저 시간대가 아니라 고정 +9시간', () => {
    expect(kstDateTime('2026-10-09T15:30:00Z')).toBe('2026-10-10 00:30');
    expect(kstDateTime('2026-10-09T14:59:00Z')).toBe('2026-10-09 23:59');
  });

  it('시행 예정 — 시행본이고 사내 시행일이 오늘 뒤일 때만(오늘 시행이면 아니다)', () => {
    expect(versionDates({ status: 'published', effectiveDate: '2026-10-10' }, TODAY)!.upcoming).toBe(true);
    expect(versionDates({ status: 'published', effectiveDate: TODAY }, TODAY)!.upcoming).toBe(false);
    expect(versionDates({ status: 'archived', effectiveDate: '2026-10-10' }, TODAY)!.upcoming).toBe(false);
    expect(versionDates({ status: 'published', effectiveDate: null }, TODAY)!.upcoming).toBe(false);
  });

  it('법령 시행일 — 후보 승인 버전만, 사내 시행일이 더 이르면 조기 시행', () => {
    expect(versionDates({ status: 'published', effectiveDate: '2026-10-15' }, TODAY)!.law).toBeNull();

    const early = versionDates({ status: 'published', effectiveDate: '2026-10-15', lawChange: law }, TODAY)!;
    expect(early.law).toMatchObject({ date: '2026-11-01', early: true, lawName: '근로기준법', label: '제60조제1항', eventId: 'e1' });

    const same = versionDates({ status: 'published', effectiveDate: '2026-11-01', lawChange: law }, TODAY)!;
    expect(same.law!.early).toBe(false);
    const later = versionDates({ status: 'published', effectiveDate: '2026-11-02', lawChange: law }, TODAY)!;
    expect(later.law!.early).toBe(false);

    // 이벤트에 법령 시행일이 없으면 기록 없음 — 조기 시행인지 알 수 없다
    const noDate = versionDates({ status: 'published', effectiveDate: '2026-10-15', lawChange: { ...law, lawEffectiveDate: null } }, TODAY)!;
    expect(noDate.law).toMatchObject({ date: null, early: false });
    // 사내 시행일이 비어 있어도 조기 시행으로 보지 않는다
    expect(versionDates({ status: 'published', effectiveDate: null, lawChange: law }, TODAY)!.law!.early).toBe(false);
  });
});

describe('formatVersionDates — 연혁 탭·타임라인 한 줄', () => {
  it('사내 시행일 → 발행 → 법령 시행일 순서, 보정·예정·조기 시행 표시', () => {
    const d = versionDates(
      { status: 'published', effectiveDate: '2026-10-15', publishedAt: '2026-10-09T05:03:00Z', publishedAtFromApproval: true, lawChange: law },
      TODAY,
    )!;
    expect(formatVersionDates(d)).toBe(
      '사내 시행일 2026-10-15(시행 예정) · 발행 2026-10-09 14:03(승인 기록으로 보정) · 법령 시행일 2026-11-01(근로기준법 제60조제1항, 법령보다 조기 시행)',
    );
  });

  it('기록이 없으면 기록 없음, 법령 연결이 없으면 법령 시행일을 쓰지 않는다', () => {
    const d = versionDates({ status: 'archived', effectiveDate: null, publishedAt: null }, TODAY)!;
    expect(formatVersionDates(d)).toBe('사내 시행일 기록 없음 · 발행 기록 없음');
    const noLawDate = versionDates(
      { status: 'archived', effectiveDate: '2026-01-01', publishedAt: '2025-12-31T15:00:00Z', lawChange: { ...law, lawEffectiveDate: null } },
      TODAY,
    )!;
    expect(formatVersionDates(noLawDate)).toBe('사내 시행일 2026-01-01 · 발행 2026-01-01 00:00 · 법령 시행일 기록 없음(근로기준법 제60조제1항)');
  });
});
