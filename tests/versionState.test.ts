import { describe, it, expect } from 'vitest';
import {
  articleBadgeState,
  articleDraftBase,
  collectArticleChangeNotes,
  isDraftOnlyArticle,
  nextScheduled,
  noCurrentTextMarker,
  statuteDate,
  versionDisplayState,
} from '../apps/web/src/lib/versionState';
import { formatArticleJo } from '../apps/web/src/lib/legalArticleLabel';

const today = '2026-10-10';

describe('버전 표시 상태 (T-127)', () => {
  it('미래 시행일로 개정을 승인하면 archived 인 지금 본문이 시행중, published 인 새 본문이 시행 예정', () => {
    const v1 = { id: 'v1', status: 'archived', effectiveDate: '2024-01-01' };
    const v2 = { id: 'v2', status: 'published', effectiveDate: '2099-01-01' };
    expect(versionDisplayState(v1, { currentId: 'v1', today })).toBe('in_force');
    expect(versionDisplayState(v2, { currentId: 'v1', today })).toBe('scheduled');
  });

  it('밀려 내려간 버전은 이전 버전, 폐지일이 지난 버전은 폐지', () => {
    expect(versionDisplayState({ id: 'v0', status: 'archived', effectiveDate: '2020-01-01' }, { currentId: 'v1', today })).toBe('superseded');
    expect(versionDisplayState({ id: 'v1', status: 'archived', repealedOn: '2026-10-10' }, { currentId: null, today })).toBe('repealed');
    // 폐지 예정일 전이면 아직 시행중
    expect(versionDisplayState({ id: 'v1', status: 'archived', repealedOn: '2026-12-01' }, { currentId: 'v1', today })).toBe('in_force');
  });

  it('초안·검토중은 그대로, 현재 id 를 모르면 날짜로만 가른다', () => {
    expect(versionDisplayState({ status: 'draft' }, { today })).toBe('draft');
    expect(versionDisplayState({ status: 'review' }, { today })).toBe('review');
    expect(versionDisplayState({ status: 'published', effectiveDate: '2026-10-10' }, { today })).toBe('in_force');
    expect(versionDisplayState({ status: 'published', effectiveDate: '2026-10-11' }, { today })).toBe('scheduled');
    expect(versionDisplayState({ status: 'published', effectiveDate: null }, { today })).toBe('in_force');
  });
});

describe('조문 상태 배지·초안 바탕', () => {
  const current = { id: 'v1', versionNum: 1, content: '지금 본문', effectiveDate: '2024-01-01T00:00:00.000Z' };
  const s1 = { id: 'v2', versionNum: 2, content: '첫 개정', effectiveDate: '2099-01-01T00:00:00.000Z' };
  const s2 = { id: 'v3', versionNum: 3, content: '둘째 개정', effectiveDate: '2099-06-01T00:00:00.000Z' };

  it('배지는 오늘 시행본 → 폐지 → 시행 예정 → 초안 순', () => {
    expect(articleBadgeState({ versions: [current], scheduledVersions: [s1] })).toBe('in_force');
    expect(articleBadgeState({ versions: [], currentState: 'repealed', scheduledVersions: [s1] })).toBe('repealed');
    expect(articleBadgeState({ versions: [], scheduledVersions: [s1], pendingVersion: { status: 'draft' } })).toBe('scheduled');
    expect(articleBadgeState({ versions: [], pendingVersion: { status: 'review' } })).toBe('review');
    expect(articleBadgeState({ versions: [] })).toBeNull();
  });

  it('새 초안은 가장 늦은 시행 예정 본문에서 — 없으면 오늘 시행본', () => {
    expect(articleDraftBase({ versions: [current], scheduledVersions: [s1, s2] })).toEqual({
      content: '둘째 개정',
      kind: 'scheduled',
      versionNum: 3,
      effectiveDate: '2099-06-01',
    });
    expect(articleDraftBase({ versions: [current] })).toMatchObject({ content: '지금 본문', kind: 'current', versionNum: 1 });
    expect(articleDraftBase({ versions: [] })).toEqual({ content: '', kind: 'none', versionNum: null, effectiveDate: null });
    expect(nextScheduled({ scheduledVersions: [s1, s2] })).toBe(s1);
  });

  it('시행 예정 버전이 있는 조문의 초안은 "시행 전 초안만"이 아니다(한꺼번에 시행 대상 아님)', () => {
    expect(isDraftOnlyArticle({ versions: [], pendingVersion: { status: 'draft' } })).toBe(true);
    expect(isDraftOnlyArticle({ versions: [], scheduledVersions: [s1], pendingVersion: { status: 'draft' } })).toBe(false);
    expect(isDraftOnlyArticle({ versions: [current], pendingVersion: { status: 'draft' } })).toBe(false);
  });
});

describe('공식 문서(인쇄·PDF·한글·TXT·읽어주기)에 적는 말 — 시행 예정 본문은 넣지 않는다', () => {
  const s1 = { id: 'v2', versionNum: 2, content: '새 조문 본문', effectiveDate: '2099-03-01T00:00:00.000Z' };

  it('법령 표기 날짜', () => {
    expect(statuteDate('2026-10-10')).toBe('2026. 10. 10.');
    expect(statuteDate('2026-01-05T00:00:00.000Z')).toBe('2026. 1. 5.');
    expect(statuteDate(null)).toBe('');
  });

  it('오늘 시행 중인 본문이 있으면 적을 말이 없다(본문을 쓴다)', () => {
    expect(noCurrentTextMarker({ versions: [{ content: '지금' }], scheduledVersions: [s1] })).toBeNull();
  });

  it('폐지는 "삭제 <날짜>" — 그 뒤 다시 시행할 판이 있어도', () => {
    expect(noCurrentTextMarker({ versions: [], currentState: 'repealed', repealedOn: '2026-10-10' })).toBe('삭제 <2026. 10. 10.>');
    expect(noCurrentTextMarker({ versions: [], currentState: 'repealed', repealedOn: '2026-10-10', scheduledVersions: [s1] })).toBe(
      '삭제 <2026. 10. 10.>',
    );
  });

  it('아직 시행 전인 새 조문은 "날짜 시행 예정" — 본문은 넣지 않는다', () => {
    const marker = noCurrentTextMarker({ versions: [], currentState: 'scheduled', scheduledVersions: [s1] });
    expect(marker).toBe('2099-03-01 시행 예정');
    expect(marker).not.toContain('새 조문 본문');
  });

  it('둘 다 아니면 null — 쓰는 쪽의 기본 문구(초안만 있는 조문 등)', () => {
    expect(noCurrentTextMarker({ versions: [], pendingVersion: { status: 'draft', content: '초안' } })).toBeNull();
    expect(noCurrentTextMarker({})).toBeNull();
  });
});

describe('조문별 개정 사유 — 시행 예정 개정의 사유도 함께', () => {
  it('오늘 시행본과 시행 예정 버전의 사유를 시행일 늦은 순으로, 사유 없는 버전은 뺀다', () => {
    const policy = {
      chapters: [
        {
          articles: [
            {
              number: 2,
              title: '수당',
              versions: [{ id: 'v1', changeNote: '제정', effectiveDate: '2024-01-01T00:00:00.000Z' }],
              scheduledVersions: [
                { id: 'v2', changeNote: '수당 인상', effectiveDate: '2099-01-01T00:00:00.000Z' },
                { id: 'v3', changeNote: '  ', effectiveDate: '2099-06-01T00:00:00.000Z' },
              ],
            },
            { number: 3, branchNumber: 2, title: '', versions: [], scheduledVersions: [{ id: 'v9', changeNote: '신설', effectiveDate: '2099-03-01' }] },
          ],
        },
      ],
    };
    expect(collectArticleChangeNotes(policy, formatArticleJo)).toEqual([
      { key: 'v9', label: '제3조의2', note: '신설', effectiveDate: '2099-03-01', scheduled: true },
      { key: 'v2', label: '제2조 (수당)', note: '수당 인상', effectiveDate: '2099-01-01T00:00:00.000Z', scheduled: true },
      { key: 'v1', label: '제2조 (수당)', note: '제정', effectiveDate: '2024-01-01T00:00:00.000Z', scheduled: false },
    ]);
  });
});

