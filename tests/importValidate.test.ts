import { describe, it, expect } from 'vitest';
import { validateImport, type ValidateInput } from '../apps/api/src/admin/import-validate';

const base = (over: Partial<ValidateInput> = {}): ValidateInput => ({
  policies: [
    {
      code: 'HR-001',
      title: '인사규정',
      chapters: [
        { number: 1, title: '총칙', articles: [{ number: 1, title: '목적', content: '본문' }] },
      ],
    },
  ],
  existingCodes: [],
  currentCount: 0,
  maxPolicies: 10_000,
  ...over,
});

const errors = (r: ReturnType<typeof validateImport>) => r.issues.filter((i) => i.level === 'error');
const warnings = (r: ReturnType<typeof validateImport>) =>
  r.issues.filter((i) => i.level === 'warning');

describe('validateImport (T-13)', () => {
  it('멀쩡한 입력은 통과하고 건수를 센다', () => {
    const r = validateImport(base());
    expect(r.canImport).toBe(true);
    expect(r.issues).toEqual([]);
    expect(r.summary).toEqual({ policies: 1, chapters: 1, articles: 1 });
  });

  it('빈 목록은 거절한다', () => {
    const r = validateImport(base({ policies: [] }));
    expect(r.canImport).toBe(false);
  });

  describe('코드', () => {
    it('이미 있는 코드는 오류', () => {
      const r = validateImport(base({ existingCodes: ['HR-001'] }));
      expect(r.canImport).toBe(false);
      expect(errors(r)[0].message).toContain('이미 있는');
    });

    /** 예전에는 첫 충돌에서 트랜잭션째 멈춰, 무엇이 문제인지 한 번에 알 수 없었다 */
    it('파일 안의 중복도 잡고, 문제를 한 번에 모아 준다', () => {
      const r = validateImport(
        base({
          policies: [
            { code: 'A', title: '가', chapters: [] },
            { code: 'A', title: '나', chapters: [] },
            { code: '', title: '다', chapters: [] },
          ],
        }),
      );
      expect(r.canImport).toBe(false);
      const msgs = errors(r).map((e) => e.message);
      expect(msgs.some((m) => m.includes('겹칩니다'))).toBe(true);
      expect(msgs.some((m) => m.includes('코드가 비어'))).toBe(true);
      // 여러 문제가 함께 나와야 고치고 다시 올리기를 반복하지 않는다
      expect(errors(r).length).toBeGreaterThanOrEqual(2);
    });

    it('중복은 몇 번째와 겹치는지 알려 준다', () => {
      const r = validateImport(
        base({
          policies: [
            { code: 'A', title: '가', chapters: [] },
            { code: 'A', title: '나', chapters: [] },
          ],
        }),
      );
      expect(errors(r)[0].message).toContain('1번째');
      expect(errors(r)[0].policyIndex).toBe(1);
    });

    it('너무 긴 코드·제목은 오류', () => {
      const r = validateImport(
        base({ policies: [{ code: 'x'.repeat(81), title: 'y'.repeat(501), chapters: [] }] }),
      );
      const msgs = errors(r).map((e) => e.message);
      expect(msgs.some((m) => m.includes('코드가 80자'))).toBe(true);
      expect(msgs.some((m) => m.includes('제목이 500자'))).toBe(true);
    });
  });

  describe('구조', () => {
    it('장 번호·제목이 잘못되면 오류', () => {
      const r = validateImport(
        base({
          policies: [
            { code: 'A', title: '가', chapters: [{ number: 0, title: '  ', articles: [] }] },
          ],
        }),
      );
      expect(r.canImport).toBe(false);
      expect(errors(r).length).toBe(2);
    });

    it('조 번호가 잘못되면 오류', () => {
      const r = validateImport(
        base({
          policies: [
            {
              code: 'A',
              title: '가',
              chapters: [{ number: 1, title: '총칙', articles: [{ number: 0, title: '목적' }] }],
            },
          ],
        }),
      );
      expect(r.canImport).toBe(false);
    });

    it('장이 없으면 경고만 — 껍데기만 만드는 쓰임이 있다', () => {
      const r = validateImport(base({ policies: [{ code: 'A', title: '가', chapters: [] }] }));
      expect(r.canImport).toBe(true);
      expect(warnings(r)[0].message).toContain('장이 없습니다');
    });

    it('본문이 비면 경고', () => {
      const r = validateImport(
        base({
          policies: [
            {
              code: 'A',
              title: '가',
              chapters: [{ number: 1, title: '총칙', articles: [{ number: 1, title: '목적' }] }],
            },
          ],
        }),
      );
      expect(r.canImport).toBe(true);
      expect(warnings(r).some((w) => w.message.includes('본문이 비어'))).toBe(true);
    });

    /** 조 번호는 장을 가로질러 이어진다 — 겹치면 목차에서 조문을 특정할 수 없다 */
    it('장을 넘어 조 번호가 겹치면 경고', () => {
      const r = validateImport(
        base({
          policies: [
            {
              code: 'A',
              title: '가',
              chapters: [
                { number: 1, title: '총칙', articles: [{ number: 1, title: '목적', content: 'x' }] },
                { number: 2, title: '운영', articles: [{ number: 1, title: '원칙', content: 'y' }] },
              ],
            },
          ],
        }),
      );
      expect(r.canImport).toBe(true);
      expect(warnings(r).some((w) => w.message.includes('겹칩니다'))).toBe(true);
    });

    it('조 번호가 건너뛰면 경고', () => {
      const r = validateImport(
        base({
          policies: [
            {
              code: 'A',
              title: '가',
              chapters: [
                {
                  number: 1,
                  title: '총칙',
                  articles: [
                    { number: 1, title: '목적', content: 'x' },
                    { number: 5, title: '적용', content: 'y' },
                  ],
                },
              ],
            },
          ],
        }),
      );
      expect(warnings(r).some((w) => w.message.includes('이어지지 않습니다'))).toBe(true);
    });
  });

  /**
   * 규정을 하나씩 만들 때는 상한에 막히는데 일괄 가져오기는 통과했다 —
   * Starter(5건) 테넌트가 한 번에 100건을 넣을 수 있었다.
   */
  describe('플랜 상한', () => {
    it('상한을 넘으면 오류', () => {
      const r = validateImport(
        base({
          policies: Array.from({ length: 6 }, (_, i) => ({ code: `A${i}`, title: `가${i}`, chapters: [] })),
          currentCount: 0,
          maxPolicies: 5,
        }),
      );
      expect(r.canImport).toBe(false);
      expect(errors(r).some((e) => e.message.includes('상한'))).toBe(true);
    });

    it('이미 있는 규정 수를 함께 센다', () => {
      const r = validateImport(base({ currentCount: 5, maxPolicies: 5 }));
      expect(r.canImport).toBe(false);
      expect(errors(r).some((e) => e.message.includes('지금 5건'))).toBe(true);
    });

    it('딱 맞으면 통과', () => {
      const r = validateImport(base({ currentCount: 4, maxPolicies: 5 }));
      expect(r.canImport).toBe(true);
    });
  });
});
