import { describe, it, expect } from 'vitest';
import {
  nextPeriod,
  planSubscriptionTransition,
  resolvePaymentAmount,
} from '../apps/api/src/billing/billing-records';

const iso = (d: Date) => d.toISOString();

describe('nextPeriod (T-17)', () => {
  it('보통 달은 같은 날짜로 한 달 뒤', () => {
    const p = nextPeriod(new Date('2026-03-15T09:00:00.000Z'));
    expect(iso(p.start)).toBe('2026-03-15T09:00:00.000Z');
    expect(iso(p.end)).toBe('2026-04-15T09:00:00.000Z');
  });

  /**
   * `setMonth` 를 그대로 쓰면 1월 31일 + 1개월이 3월 3일이 된다(2월에 31일이 없어
   * 넘쳐 흐른다). 그러면 청구 기간에서 2월이 통째로 사라진다.
   */
  it('말일을 넘기면 그 달의 마지막 날로 붙인다', () => {
    expect(iso(nextPeriod(new Date('2026-01-31T00:00:00.000Z')).end)).toBe(
      '2026-02-28T00:00:00.000Z',
    );
    expect(iso(nextPeriod(new Date('2026-03-31T00:00:00.000Z')).end)).toBe(
      '2026-04-30T00:00:00.000Z',
    );
  });

  it('윤년 2월을 알아본다', () => {
    expect(iso(nextPeriod(new Date('2028-01-31T00:00:00.000Z')).end)).toBe(
      '2028-02-29T00:00:00.000Z',
    );
  });

  it('해를 넘긴다', () => {
    expect(iso(nextPeriod(new Date('2026-12-15T00:00:00.000Z')).end)).toBe(
      '2027-01-15T00:00:00.000Z',
    );
  });

  it('여러 달도 같은 규칙', () => {
    expect(iso(nextPeriod(new Date('2026-01-31T00:00:00.000Z'), 12).end)).toBe(
      '2027-01-31T00:00:00.000Z',
    );
    expect(iso(nextPeriod(new Date('2026-08-31T00:00:00.000Z'), 6).end)).toBe(
      '2027-02-28T00:00:00.000Z',
    );
  });

  it('시각은 그대로 보존한다', () => {
    const p = nextPeriod(new Date('2026-05-10T23:59:59.999Z'));
    expect(iso(p.end)).toBe('2026-06-10T23:59:59.999Z');
  });
});

describe('planSubscriptionTransition', () => {
  it('구독이 없으면 새로 만든다', () => {
    expect(planSubscriptionTransition(null, 'pro')).toEqual({ kind: 'create' });
  });

  /** 새로 만들면 이력이 쪼개져 언제부터 써 왔는지 알 수 없게 된다 */
  it('같은 요금제를 다시 사면 연장한다', () => {
    expect(
      planSubscriptionTransition({ id: 's1', plan: 'pro', status: 'active' }, 'pro'),
    ).toEqual({ kind: 'extend', subscriptionId: 's1' });
  });

  /** 활성 구독이 둘이면 어느 쪽이 유효한지 판단할 근거가 없다 */
  it('요금제가 바뀌면 이전 것을 닫고 새로 연다', () => {
    expect(
      planSubscriptionTransition({ id: 's1', plan: 'pro', status: 'active' }, 'enterprise'),
    ).toEqual({ kind: 'replace', cancelSubscriptionId: 's1' });
  });

  it('체험 중이어도 같은 규칙을 따른다', () => {
    expect(planSubscriptionTransition({ id: 's1', plan: 'pro', status: 'trial' }, 'pro')).toEqual({
      kind: 'extend',
      subscriptionId: 's1',
    });
  });

  it('해지·만료된 구독은 되살리지 않고 새로 만든다', () => {
    expect(
      planSubscriptionTransition({ id: 's1', plan: 'pro', status: 'canceled' }, 'pro'),
    ).toEqual({ kind: 'create' });
    expect(
      planSubscriptionTransition({ id: 's1', plan: 'pro', status: 'expired' }, 'pro'),
    ).toEqual({ kind: 'create' });
  });
});

describe('resolvePaymentAmount', () => {
  /** 요금표를 지어내 넣으면 이력이 그럴듯하게 거짓이 된다 */
  it('mock 결제는 0원으로 남기고 mock 임을 표시한다', () => {
    expect(resolvePaymentAmount('mock', 50000)).toEqual({ amount: 0, mock: true });
  });

  it('실 결제는 결제사가 알려 준 금액을 쓴다', () => {
    expect(resolvePaymentAmount('toss', 49000)).toEqual({ amount: 49000, mock: false });
    expect(resolvePaymentAmount('toss', '49000')).toEqual({ amount: 49000, mock: false });
  });

  it('금액이 없거나 이상하면 0으로 둔다', () => {
    expect(resolvePaymentAmount('toss', undefined).amount).toBe(0);
    expect(resolvePaymentAmount('toss', -1).amount).toBe(0);
    expect(resolvePaymentAmount('toss', 'abc').amount).toBe(0);
  });
});
