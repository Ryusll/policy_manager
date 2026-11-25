import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  BODY_SCALE_STEPS,
  DEFAULT_BODY_SCALE,
  BODY_SCALE_STORAGE_KEY,
  normalizeBodyScale,
  stepBodyScale,
  canStepBodyScale,
  loadBodyScale,
  saveBodyScale,
  bodyScaleStyle,
} from '../apps/web/src/lib/bodyScale';

/**
 * 본문 글자 크기 조절 (T-75).
 *
 * 저장된 값은 사용자 브라우저에서 오는 값이라 무엇이든 들어올 수 있다.
 * 이상한 값 하나에 본문이 안 보이게 되면 안 된다.
 */

function withStorage(store: Record<string, string> | null) {
  const mem = store ?? {};
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => (store === null ? (() => { throw new Error('blocked'); })() : mem[k] ?? null),
    setItem: (k: string, v: string) => {
      if (store === null) throw new Error('blocked');
      mem[k] = v;
    },
  });
  return mem;
}

describe('본문 글자 크기 (T-75)', () => {
  beforeEach(() => vi.unstubAllGlobals());

  it('기본은 100%이고 단계는 오름차순이다', () => {
    expect(DEFAULT_BODY_SCALE).toBe(100);
    expect(BODY_SCALE_STEPS).toContain(100);
    expect([...BODY_SCALE_STEPS]).toEqual([...BODY_SCALE_STEPS].sort((a, b) => a - b));
  });

  describe('값 보정', () => {
    it('정해진 단계는 그대로 둔다', () => {
      for (const step of BODY_SCALE_STEPS) expect(normalizeBodyScale(step)).toBe(step);
    });

    it('문자열로 저장된 값도 읽는다', () => {
      expect(normalizeBodyScale('110')).toBe(110);
    });

    /** 저장소가 손상됐다고 본문이 사라지면 안 된다 */
    it('이상한 값은 기본값으로 떨어진다', () => {
      for (const bad of [null, undefined, '', 'abc', NaN, {}, []]) {
        expect(normalizeBodyScale(bad)).toBe(DEFAULT_BODY_SCALE);
      }
    });

    it('단계에 없는 숫자는 가장 가까운 단계로 맞춘다', () => {
      expect(normalizeBodyScale(112)).toBe(110);
      expect(normalizeBodyScale(9999)).toBe(150);
      expect(normalizeBodyScale(95)).toBe(90);
    });

    /** 0 이하는 "조금 작은 값"이 아니라 쓰레기다 */
    it('0 이하는 기본값으로 보낸다', () => {
      for (const bad of [0, -50, '0']) expect(normalizeBodyScale(bad)).toBe(DEFAULT_BODY_SCALE);
    });
  });

  describe('단계 이동', () => {
    it('한 단계씩 오르내린다', () => {
      expect(stepBodyScale(100, 1)).toBe(110);
      expect(stepBodyScale(100, -1)).toBe(90);
    });

    it('양 끝에서는 더 가지 않는다', () => {
      const [min] = BODY_SCALE_STEPS;
      const max = BODY_SCALE_STEPS[BODY_SCALE_STEPS.length - 1];
      expect(stepBodyScale(min, -1)).toBe(min);
      expect(stepBodyScale(max, 1)).toBe(max);
    });

    /** 버튼을 언제 비활성으로 보일지 판단하는 데 쓴다 */
    it('더 갈 수 있는지 알려준다', () => {
      const [min] = BODY_SCALE_STEPS;
      const max = BODY_SCALE_STEPS[BODY_SCALE_STEPS.length - 1];
      expect(canStepBodyScale(min, -1)).toBe(false);
      expect(canStepBodyScale(min, 1)).toBe(true);
      expect(canStepBodyScale(max, 1)).toBe(false);
    });
  });

  describe('저장', () => {
    it('저장하고 다시 읽는다', () => {
      withStorage({});
      expect(saveBodyScale(125)).toBe(125);
      expect(loadBodyScale()).toBe(125);
    });

    it('저장 전에는 기본값', () => {
      withStorage({});
      expect(loadBodyScale()).toBe(DEFAULT_BODY_SCALE);
    });

    it('저장할 때도 보정한다', () => {
      const mem = withStorage({});
      saveBodyScale(9999);
      expect(mem[BODY_SCALE_STORAGE_KEY]).toBe('150');
    });

    /** 시크릿 창이나 저장소 차단 환경에서도 화면은 떠야 한다 */
    it('저장소를 못 쓰면 조용히 기본값으로 동작한다', () => {
      withStorage(null);
      expect(() => loadBodyScale()).not.toThrow();
      expect(loadBodyScale()).toBe(DEFAULT_BODY_SCALE);
      expect(() => saveBodyScale(110)).not.toThrow();
      expect(saveBodyScale(110)).toBe(110);
    });
  });

  describe('스타일', () => {
    /** 기본 배율에서 zoom 을 걸면 브라우저마다 미세한 렌더 차이가 생긴다 */
    it('기본 배율이면 아무 스타일도 걸지 않는다', () => {
      expect(bodyScaleStyle(100)).toEqual({});
    });

    /** 인쇄 때 되돌릴 수 있도록 CSS 변수로 넘긴다(인라인 zoom 은 덮기 어렵다) */
    it('다른 배율이면 CSS 변수로 넘긴다', () => {
      expect(bodyScaleStyle(125)).toEqual({ '--policy-body-scale': '1.25' });
      expect(bodyScaleStyle(90)).toEqual({ '--policy-body-scale': '0.9' });
    });
  });
});
