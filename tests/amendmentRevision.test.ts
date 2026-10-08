import { describe, it, expect } from 'vitest';
import { createHash } from 'crypto';
import { contentHash, hasSubstantiveChange } from '../apps/api/src/amendments/amendment-revision';
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
