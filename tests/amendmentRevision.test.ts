import { describe, it, expect } from 'vitest';
import { createHash } from 'crypto';
import { contentHash, hasSubstantiveChange, historyFingerprint } from '../apps/api/src/amendments/amendment-revision';
import { currentState } from '../apps/api/src/amendments/amendment-present';

describe('개정 후보의 판 (T-107)', () => {
  it('본문 해시는 UTF-8 SHA-256 hex — 마이그레이션 보정과 같은 형식', () => {
    expect(contentHash('연차휴가는 20일로 한다.')).toBe(
      createHash('sha256').update('연차휴가는 20일로 한다.', 'utf8').digest('hex'),
    );
    expect(contentHash('a')).toMatch(/^[0-9a-f]{64}$/);
    expect(contentHash('a')).not.toBe(contentHash('a '));
  });

  it('공백만 다르면 개정이 아니다', () => {
    expect(hasSubstantiveChange('휴가는 15일로 한다.', '휴가는  15일로\n한다.')).toBe(false);
    expect(hasSubstantiveChange('휴가는 15일로 한다.', '휴가는 20일로 한다.')).toBe(true);
  });

  it('지금 판의 표시는 생성 때 표시와 따로 — 고친 판·차이·근거 없는 변경 수', () => {
    expect(currentState({ revision: 1, candidateContent: '같다', diff: { unexplained: 0 }, baseContent: '같다' })).toEqual({
      revision: 1,
      hasChanges: false,
      unexplained: 0,
      edited: false,
    });
    expect(currentState({ revision: 3, candidateContent: '다르다', diff: { unexplained: 2 }, baseContent: '같다' })).toEqual({
      revision: 3,
      hasChanges: true,
      unexplained: 2,
      edited: true,
    });
  });
});

describe('historyFingerprint — 발행 이력 지문 (T-108)', () => {
  const v = (id: string, status: string, eff: string | null, n: number) => ({
    id,
    status,
    effectiveDate: eff ? new Date(`${eff}T00:00:00.000Z`) : null,
    versionNum: n,
  });

  it('시행본·폐지본만, 순서와 무관하게 같은 값', () => {
    const a = historyFingerprint([v('b', 'archived', '2020-01-01', 1), v('a', 'published', '2024-03-01', 2), v('c', 'draft', null, 3)]);
    const b = historyFingerprint([v('a', 'published', '2024-03-01', 2), v('b', 'archived', '2020-01-01', 1)]);
    expect(a).toBe(b);
    expect(a).toBe(`fp1:${createHash('sha256').update('a|published|2024-03-01|2\nb|archived|2020-01-01|1', 'utf8').digest('hex')}`);
  });

  it('상태·시행일·새 발행이 바뀌면 달라진다', () => {
    const base = [v('a', 'published', '2024-03-01', 1)];
    const f = historyFingerprint(base);
    expect(historyFingerprint([v('a', 'archived', '2024-03-01', 1)])).not.toBe(f);
    expect(historyFingerprint([v('a', 'published', '2024-03-02', 1)])).not.toBe(f);
    expect(historyFingerprint([...base, v('b', 'published', '2019-01-01', 2)])).not.toBe(f);
    // 초안은 이력이 아니다
    expect(historyFingerprint([...base, v('d', 'draft', null, 2)])).toBe(f);
  });
});
