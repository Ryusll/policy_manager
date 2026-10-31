import { describe, it, expect } from 'vitest';
import {
  checkoutBlock,
  paymentProvider,
  providerName,
  webhookBlock,
} from '../apps/api/src/billing/billing-policy';

describe('paymentProvider — 결제를 쓰는 서버인가 (T-125)', () => {
  /** 예전에는 비어 있으면 mock 이었다 — 운영이 이 값을 넘겨받지 않아 요금제가 무료로 올라갔다 */
  it('기본은 결제 미사용 — 설정이 빠진 서버가 mock 으로 떨어지면 안 된다', () => {
    expect(paymentProvider({})).toEqual({ kind: 'disabled' });
    for (const v of ['', '  ', 'none', 'OFF', 'disabled', 'false']) {
      expect(paymentProvider({ PAYMENT_PROVIDER: v }), JSON.stringify(v)).toEqual({ kind: 'disabled' });
    }
  });

  it('mock 은 명시해야만 켜진다', () => {
    expect(paymentProvider({ PAYMENT_PROVIDER: 'mock' })).toEqual({ kind: 'mock' });
    expect(paymentProvider({ PAYMENT_PROVIDER: ' Mock ' })).toEqual({ kind: 'mock' });
  });

  it('그 밖의 값은 실 PG 이름으로 본다', () => {
    expect(paymentProvider({ PAYMENT_PROVIDER: 'TossPayments' })).toEqual({ kind: 'external', name: 'tosspayments' });
    expect(providerName(paymentProvider({ PAYMENT_PROVIDER: 'testpg' }))).toBe('testpg');
    expect(providerName({ kind: 'mock' })).toBe('mock');
  });
});

describe('checkoutBlock — 고객사 관리자의 결제 시작', () => {
  it('결제 미사용이면 BILLING_CLOSED 로 막고 아스트룸 문의로 안내한다', () => {
    const block = checkoutBlock({ kind: 'disabled' });
    expect(block?.status).toBe(403);
    expect(block?.code).toBe('BILLING_CLOSED');
    expect(block?.message).toContain('아스트룸');
  });

  it('결제를 켠 서버에서는 막지 않는다', () => {
    expect(checkoutBlock({ kind: 'mock' })).toBeNull();
    expect(checkoutBlock({ kind: 'external', name: 'testpg' })).toBeNull();
  });
});

describe('webhookBlock — 로그인 없이 열린 결제 웹훅', () => {
  const external = { kind: 'external', name: 'testpg' } as const;
  const SECRET = 'whsec_0123456789abcdef';

  it('결제 미사용·mock 서버는 비밀키가 맞아도 받지 않는다 — 결제사가 보낼 웹훅이 있을 수 없다', () => {
    for (const provider of [{ kind: 'disabled' } as const, { kind: 'mock' } as const]) {
      expect(webhookBlock(provider, SECRET, SECRET)?.code, provider.kind).toBe('PAYMENT_DISABLED');
      expect(webhookBlock(provider, undefined, undefined)?.code, provider.kind).toBe('PAYMENT_DISABLED');
    }
  });

  /** 예전 코드는 비밀키가 비어 있으면 검사를 건너뛰었다 */
  it('비밀키가 설정되지 않았으면 무엇을 대도 받지 않는다', () => {
    for (const configured of [undefined, '', '   ']) {
      for (const presented of [undefined, '', '   ', 'anything']) {
        const block = webhookBlock(external, configured, presented);
        expect(block?.status, `${configured}/${presented}`).toBe(403);
        expect(block?.code, `${configured}/${presented}`).toBe('WEBHOOK_SECRET_NOT_CONFIGURED');
      }
    }
  });

  it('비밀키가 없거나 다르면 401 — 앞부분만 맞거나 더 길어도', () => {
    for (const presented of [undefined, '', 'guess', SECRET.slice(0, -1), `${SECRET}x`, SECRET.toUpperCase()]) {
      const block = webhookBlock(external, SECRET, presented);
      expect(block?.status, String(presented)).toBe(401);
      expect(block?.code, String(presented)).toBe('INVALID_WEBHOOK_SECRET');
    }
  });

  it('실결제 서버 + 설정된 비밀키 + 같은 값일 때만 통과한다', () => {
    expect(webhookBlock(external, SECRET, SECRET)).toBeNull();
    // 설정값 앞뒤 공백은 운영 실수로 보고 잘라 비교한다
    expect(webhookBlock(external, `  ${SECRET}\n`, SECRET)).toBeNull();
  });
});
