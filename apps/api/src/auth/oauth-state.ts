import { createHmac, randomBytes, timingSafeEqual } from 'crypto';

/**
 * Google OAuth 의 `state` (T-42).
 *
 * 예전에는 `base64url(JSON)` 이 전부였다 — 서명도, 난수도, 브라우저와의 연결도 없었다.
 * 누구나 값을 만들 수 있고, 서버는 형식만 맞으면 받아들였다. `state` 는 원래
 * **CSRF 방어 장치**(RFC 6749 §10.12)인데 그 역할을 전혀 하지 못했다.
 *
 * 지금은 세 가지를 함께 본다.
 *  1. **서명** — HMAC-SHA256. 값을 지어내면 서명이 맞지 않는다.
 *  2. **유효시간** — 발급 후 10분. 오래된 콜백은 받지 않는다.
 *  3. **브라우저 연결** — 발급할 때 난수를 쿠키(httpOnly)에도 심고, 콜백에서
 *     state 안의 난수와 대조한다. 다른 사람의 콜백 URL 을 받아 열어도
 *     그 브라우저에는 쿠키가 없으므로 통과하지 못한다.
 *
 * 쿠키는 콜백에서 지운다. 같은 state 를 두 번 쓰면 두 번째는 대조할 쿠키가 없어
 * 실패한다 — 재사용 방어가 여기서 나온다.
 *
 * `SameSite=Lax` 로 충분한 이유: 콜백은 accounts.google.com 에서 넘어오는
 * **최상위 GET 이동**이고, Lax 는 그 경우 쿠키를 보낸다.
 */

export interface GoogleOAuthState {
  mode: 'login' | 'register';
  tenantSlug: string;
  tenantName: string;
}

export const OAUTH_STATE_COOKIE = 'oauth_state';

/** 사람이 구글 화면에서 계정을 고르는 시간. 넉넉하되 무한하지 않게. */
export const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;

/** JWT 와 같은 열쇠를 쓰되 용도를 분리한다(같은 키로 다른 서명을 만들지 않도록). */
const HMAC_DOMAIN = 'policy-manager:oauth-state:v1';

/**
 * JWT 와 같은 열쇠를 쓴다. 새 시크릿을 만들면 아무도 회전시키지 않는 값이 하나 더
 * 늘 뿐이고, 시크릿 가드(`secrets-guard.ts`)가 이미 JWT_SECRET 을 지키고 있다.
 * 용도는 HMAC_DOMAIN 으로 분리했다.
 */
export function getOAuthStateSecret(): string {
  return process.env.JWT_SECRET || 'secret';
}

type StateBody = {
  m: 'login' | 'register';
  s: string;
  n: string;
  /** 브라우저 쿠키와 대조할 난수 */
  c: string;
  /** 발급 시각(ms) */
  t: number;
};

function sign(body: string, secret: string): string {
  return createHmac('sha256', `${HMAC_DOMAIN}:${secret}`).update(body).digest('base64url');
}

/** 길이가 다르면 timingSafeEqual 이 던진다. 먼저 길이를 보고 나서 비교한다. */
function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

export function createGoogleOAuthState(
  state: GoogleOAuthState,
  secret: string,
  now: number = Date.now(),
): { state: string; nonce: string } {
  const nonce = randomBytes(24).toString('base64url');
  const body: StateBody = {
    m: state.mode,
    s: state.tenantSlug,
    n: state.tenantName,
    c: nonce,
    t: now,
  };
  const encoded = Buffer.from(JSON.stringify(body)).toString('base64url');
  return { state: `${encoded}.${sign(encoded, secret)}`, nonce };
}

/**
 * 콜백에서 받은 state 를 검증한다. 하나라도 어긋나면 null —
 * 어디서 틀렸는지 호출자에게 알려 주지 않는다(공격자에게도 알려 주는 셈이라).
 */
export function parseGoogleOAuthState(
  raw: string | undefined,
  secret: string,
  cookieNonce: string | undefined,
  now: number = Date.now(),
): GoogleOAuthState | null {
  if (!raw || !cookieNonce) return null;

  const dot = raw.lastIndexOf('.');
  if (dot <= 0) return null;
  const encoded = raw.slice(0, dot);
  const signature = raw.slice(dot + 1);
  if (!safeEqual(signature, sign(encoded, secret))) return null;

  let body: StateBody;
  try {
    body = JSON.parse(Buffer.from(encoded, 'base64url').toString()) as StateBody;
  } catch {
    return null;
  }

  if (typeof body?.c !== 'string' || !safeEqual(body.c, cookieNonce)) return null;
  if (typeof body.t !== 'number' || !Number.isFinite(body.t)) return null;
  // 미래에서 온 state 도 받지 않는다(시계가 어긋났거나 값이 조작된 것)
  if (body.t > now + 60_000) return null;
  if (now - body.t > OAUTH_STATE_TTL_MS) return null;

  return {
    mode: body.m === 'register' ? 'register' : 'login',
    tenantSlug: typeof body.s === 'string' ? body.s : '',
    tenantName: typeof body.n === 'string' ? body.n : '',
  };
}
