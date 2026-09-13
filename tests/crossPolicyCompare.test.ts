import { describe, it, expect } from 'vitest';
import { buildCrossPolicyRows } from '../apps/api/src/policies/policy-compare';

/**
 * 규정 간 비교 (T-91).
 *
 * 같은 규정의 두 시점(T-56)은 `articleId` 로 짝을 짓지만, 서로 다른 두 규정에는
 * 공유하는 id 가 없어 **위치(조·항·목 번호)** 로 맞댈 수밖에 없다. 그건 가정이라,
 * 번호는 같은데 제목이 다른 짝을 표시해 화면이 "의심스럽다"고 말할 수 있어야 한다.
 * 조용히 짝지으면 표가 그럴듯하게 틀린다.
 */

const art = (over: Partial<Parameters<typeof buildCrossPolicyRows>[0][number]> = {}) => ({
  id: `a-${Math.random()}`,
  number: 1,
  clauseNumber: null,
  itemNumber: null,
  title: '목적',
  content: '이 규정은 …을 목적으로 한다.',
  effectiveDate: null,
  ...over,
});

describe('규정 간 비교 (T-91)', () => {
  it('같은 번호·같은 본문은 same', () => {
    const { rows, summary } = buildCrossPolicyRows([art()], [art()]);
    expect(rows).toHaveLength(1);
    expect(rows[0].kind).toBe('same');
    expect(rows[0].diff).toBeNull();
    expect(summary.same).toBe(1);
  });

  it('본문이 다르면 different 이고 낱말 diff 를 준다', () => {
    const { rows, summary } = buildCrossPolicyRows(
      [art({ content: '본사에 적용한다.' })],
      [art({ content: '본사와 지점에 적용한다.' })],
    );
    expect(rows[0].kind).toBe('different');
    expect(rows[0].diff).not.toBeNull();
    expect(rows[0].diff!.some((p) => p.added)).toBe(true);
    expect(summary.different).toBe(1);
  });

  /** 줄바꿈·공백 차이만으로 "다름"이 되면 표가 온통 빨개진다 */
  it('공백·줄바꿈 차이는 같은 것으로 본다', () => {
    const { rows } = buildCrossPolicyRows(
      [art({ content: '가나다\n  라마' })],
      [art({ content: ' 가나다\n라마 ' })],
    );
    expect(rows[0].kind).toBe('same');
  });

  it('한쪽에만 있는 조문을 구분한다', () => {
    const { rows, summary } = buildCrossPolicyRows(
      [art({ number: 1 }), art({ number: 2, title: '적용범위' })],
      [art({ number: 1 }), art({ number: 3, title: '용어의 정의' })],
    );
    const byNo = Object.fromEntries(rows.map((r) => [r.number, r.kind]));
    expect(byNo[2]).toBe('left-only');
    expect(byNo[3]).toBe('right-only');
    expect(summary.leftOnly).toBe(1);
    expect(summary.rightOnly).toBe(1);
  });

  describe('번호로 맞춘 짝이 의심스러울 때', () => {
    /** 이게 이 기능에서 제일 중요한 부분이다 */
    it('번호는 같은데 제목이 다르면 표시한다', () => {
      const { rows, summary } = buildCrossPolicyRows(
        [art({ number: 3, title: '휴가' })],
        [art({ number: 3, title: '징계' })],
      );
      expect(rows[0].titleDiffers).toBe(true);
      expect(summary.suspect).toBe(1);
    });

    it('본문이 같아도 제목이 다르면 같은 조문으로 보지 않는다', () => {
      const { rows } = buildCrossPolicyRows(
        [art({ number: 3, title: '휴가', content: '같은 본문' })],
        [art({ number: 3, title: '징계', content: '같은 본문' })],
      );
      expect(rows[0].kind).toBe('different');
    });

    /** 항·목은 보통 제목이 없다. 빈 제목을 "다르다"고 하면 전부 의심 줄이 된다 */
    it('한쪽 제목이 비어 있으면 의심으로 보지 않는다', () => {
      const { rows } = buildCrossPolicyRows(
        [art({ number: 1, clauseNumber: 1, title: '' })],
        [art({ number: 1, clauseNumber: 1, title: '' })],
      );
      expect(rows[0].titleDiffers).toBe(false);
      expect(rows[0].kind).toBe('same');
    });
  });

  it('조 → 항 → 목 순으로 정렬한다', () => {
    const { rows } = buildCrossPolicyRows(
      [
        art({ number: 2 }),
        art({ number: 1, clauseNumber: 1, itemNumber: 1, title: '' }),
        art({ number: 1 }),
        art({ number: 1, clauseNumber: 1, title: '' }),
      ],
      [],
    );
    expect(rows.map((r) => r.key)).toEqual(['1||', '1|1|', '1|1|1', '2||']);
  });

  it('양쪽이 비면 빈 결과', () => {
    const { rows, summary } = buildCrossPolicyRows([], []);
    expect(rows).toEqual([]);
    expect(summary).toEqual({ same: 0, different: 0, leftOnly: 0, rightOnly: 0, suspect: 0 });
  });
});
