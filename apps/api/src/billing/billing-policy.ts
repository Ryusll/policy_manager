import { createHash, timingSafeEqual } from 'crypto';

/**
 * 결제를 쓰는 서버인지, 쓴다면 어떤 방식인지 (T-125).
 *
 * **가격 정책(D-02)·실 PG(D-03)가 정해지기 전의 임시 운영 방침**: 고객사가 스스로 결제하거나
 * 요금제를 바꾸는 길은 닫고, 요금제는 통합 관리에서 플랫폼 관리자만 바꾼다. 운영 서버에는
 * `PAYMENT_PROVIDER` 를 넣지 않는다.
 *
 * **설정이 빠지면 닫힌다.** 예전에는 비어 있으면 `mock` 으로 떨어졌고, mock 은 돈을 받지 않고
 * 요금제를 바로 올린다. 운영 서버가 이 값을 넘겨받지 않아서, 고객사 관리자가 요금제 창의 버튼
 * 한 번으로 Pro·Enterprise 를 무료로 쓸 수 있었다.
 *
 * - `disabled` — 결제 미사용(기본). 결제 시작·웹훅 모두 거부한다.
 * - `mock` — 개발용. 명시해야만 켜진다. 결제 시작이 즉시 요금제를 바꾼다(0원 기록).
 * - `external` — 실 PG. 결제창으로 보내고, 요금제는 서명된 웹훅으로만 바뀐다.
 */
export type PaymentProvider =
  | { kind: 'disabled' }
  | { kind: 'mock' }
  | { kind: 'external'; name: string };

const DISABLED_VALUES = new Set(['', 'none', 'disabled', 'off', 'false']);

export function paymentProvider(env: NodeJS.ProcessEnv = process.env): PaymentProvider {
  const raw = String(env.PAYMENT_PROVIDER ?? '').trim().toLowerCase();
  if (DISABLED_VALUES.has(raw)) return { kind: 'disabled' };
  if (raw === 'mock') return { kind: 'mock' };
  return { kind: 'external', name: raw };
}

/** 결제·구독 기록과 감사 로그에 남길 결제사 이름 */
export function providerName(provider: PaymentProvider): string {
  return provider.kind === 'external' ? provider.name : provider.kind;
}

export type BillingBlock = { status: 401 | 403; code: string; message: string };

export const BILLING_CLOSED_MESSAGE =
  '요금제 변경은 아스트룸에 문의해 주세요. 이 서버에서는 결제나 요금제 변경을 직접 할 수 없습니다.';

/** 고객사 관리자의 결제 시작(`POST /billing/checkout`)을 막아야 하면 그 이유 */
export function checkoutBlock(provider: PaymentProvider): BillingBlock | null {
  if (provider.kind === 'disabled') {
    return { status: 403, code: 'BILLING_CLOSED', message: BILLING_CLOSED_MESSAGE };
  }
  return null;
}

/**
 * 결제 웹훅(`POST /billing/webhook`)을 막아야 하면 그 이유.
 *
 * 웹훅은 로그인 없이 열려 있고 요금제를 바꾼다. 예전에는 비밀키가 **설정되지 않았으면 검사를
 * 건너뛰었다** — 지금까지 요금제가 바뀌지 않은 건 입력 검증이 본문의 `data` 를 거부했기
 * 때문이지, 막아 둬서가 아니었다. 그래서 순서대로 본다:
 *
 * 1. 실결제를 쓰는 서버인가 — 결제 미사용·mock 이면 결제사가 보낼 웹훅이 있을 수 없다
 * 2. 비밀키가 설정돼 있는가 — 없으면 누가 보냈는지 확인할 방법이 없다
 * 3. 보낸 쪽이 같은 비밀키를 댔는가
 */
export function webhookBlock(
  provider: PaymentProvider,
  configuredSecret: string | undefined,
  presentedSecret: string | undefined,
): BillingBlock | null {
  if (provider.kind !== 'external') {
    return {
      status: 403,
      code: 'PAYMENT_DISABLED',
      message: '결제를 쓰지 않는 서버입니다. 웹훅으로 요금제를 바꿀 수 없습니다.',
    };
  }
  const expected = (configuredSecret ?? '').trim();
  if (!expected) {
    return {
      status: 403,
      code: 'WEBHOOK_SECRET_NOT_CONFIGURED',
      message: '웹훅 비밀키가 설정되지 않아 요청을 받지 않습니다.',
    };
  }
  if (!presentedSecret || !sameSecret(presentedSecret, expected)) {
    return { status: 401, code: 'INVALID_WEBHOOK_SECRET', message: 'Invalid webhook secret' };
  }
  return null;
}

/** 길이가 달라도 같은 시간에 비교한다 — 응답 시간으로 비밀키를 한 글자씩 맞혀 볼 수 없게 */
function sameSecret(presented: string, expected: string): boolean {
  const digest = (s: string) => createHash('sha256').update(s, 'utf8').digest();
  return timingSafeEqual(digest(presented), digest(expected));
}
