import { describe, it, expect } from 'vitest';
import {
  createGoogleOAuthState,
  parseGoogleOAuthState,
  OAUTH_STATE_TTL_MS,
} from '../apps/api/src/auth/oauth-state';

/**
 * OAuth `state` 검증 (T-42).
 *
 * 감사 전에는 `state` 가 `base64url(JSON)` 이 전부였다 — 서명도 난수도 없어서
 * 누구나 지어낼 수 있었고, 브라우저와 아무 연결이 없었다. 그 상태에서 가능한
 * 공격이 **로그인 CSRF** 다: 공격자가 자기 계정으로 구글 인증을 시작해 콜백
 * URL 을 손에 넣고, 피해자에게 그 주소를 열게 하면 피해자의 브라우저에
 * **공격자의 토큰**이 심긴다. 그 뒤 피해자가 올리는 규정은 공격자 조직으로 들어간다.
 *
 * 여기서는 서명·유효시간·브라우저 연결 셋을 각각 무너뜨려 본다.
 */

const SECRET = 'unit-test-secret-value-long-enough-32-chars';
const PAYLOAD = { mode: 'login' as const, tenantSlug: 'acme', tenantName: 'Acme' };

describe('OAuth state (T-42)', () => {
  it('발급한 state 는 같은 쿠키와 함께면 통과한다', () => {
    const { state, nonce } = createGoogleOAuthState(PAYLOAD, SECRET);
    expect(parseGoogleOAuthState(state, SECRET, nonce)).toEqual(PAYLOAD);
  });

  it('난수는 발급할 때마다 다르다', () => {
    const a = createGoogleOAuthState(PAYLOAD, SECRET);
    const b = createGoogleOAuthState(PAYLOAD, SECRET);
    expect(a.nonce).not.toBe(b.nonce);
    expect(a.state).not.toBe(b.state);
  });

  describe('위조', () => {
    /** 감사 전 형식 그대로다. 이것이 통과하면 아무것도 막지 못한 것이다. */
    it('예전 형식(서명 없는 base64 JSON)은 통과하지 못한다', () => {
      const forged = Buffer.from(
        JSON.stringify({ mode: 'login', tenantSlug: 'acme', tenantName: 'Acme' }),
      ).toString('base64url');
      expect(parseGoogleOAuthState(forged, SECRET, 'any-nonce')).toBeNull();
    });

    it('본문을 바꾸면 서명이 맞지 않는다', () => {
      const { state, nonce } = createGoogleOAuthState(PAYLOAD, SECRET);
      const [body, sig] = [state.slice(0, state.lastIndexOf('.')), state.slice(state.lastIndexOf('.') + 1)];
      const decoded = JSON.parse(Buffer.from(body, 'base64url').toString());
      // 남의 조직으로 바꿔치기
      decoded.s = 'victim-corp';
      const tampered = Buffer.from(JSON.stringify(decoded)).toString('base64url');
      expect(parseGoogleOAuthState(`${tampered}.${sig}`, SECRET, nonce)).toBeNull();
    });

    it('서명을 바꾸면 통과하지 못한다', () => {
      const { state, nonce } = createGoogleOAuthState(PAYLOAD, SECRET);
      const body = state.slice(0, state.lastIndexOf('.'));
      expect(parseGoogleOAuthState(`${body}.AAAA`, SECRET, nonce)).toBeNull();
    });

    it('다른 시크릿으로 만든 state 는 통과하지 못한다', () => {
      const { state, nonce } = createGoogleOAuthState(PAYLOAD, 'another-secret-value-long-enough-32ch');
      expect(parseGoogleOAuthState(state, SECRET, nonce)).toBeNull();
    });

    it('형식이 아예 어긋나도 예외가 아니라 null 이다', () => {
      for (const raw of ['', 'nodot', '.', 'a.', Buffer.from('{').toString('base64url') + '.x']) {
        expect(parseGoogleOAuthState(raw, SECRET, 'nonce')).toBeNull();
      }
    });
  });

  describe('브라우저 연결 — 로그인 CSRF 방어', () => {
    /**
     * 공격자가 만든 state 를 피해자가 여는 상황. 서명은 진짜지만
     * 피해자 브라우저에는 그 난수 쿠키가 없다.
     */
    it('쿠키가 없으면 통과하지 못한다', () => {
      const { state } = createGoogleOAuthState(PAYLOAD, SECRET);
      expect(parseGoogleOAuthState(state, SECRET, undefined)).toBeNull();
    });

    it('다른 난수 쿠키로는 통과하지 못한다', () => {
      const { state } = createGoogleOAuthState(PAYLOAD, SECRET);
      const other = createGoogleOAuthState(PAYLOAD, SECRET);
      expect(parseGoogleOAuthState(state, SECRET, other.nonce)).toBeNull();
    });

    /** 콜백이 쿠키를 지우므로 두 번째 사용은 "쿠키 없음"이 된다 */
    it('재사용 — 쿠키를 지운 뒤에는 같은 state 도 통과하지 못한다', () => {
      const { state, nonce } = createGoogleOAuthState(PAYLOAD, SECRET);
      expect(parseGoogleOAuthState(state, SECRET, nonce)).toEqual(PAYLOAD);
      expect(parseGoogleOAuthState(state, SECRET, undefined)).toBeNull();
    });
  });

  describe('유효시간', () => {
    it('10분이 지나면 통과하지 못한다', () => {
      const issued = 1_700_000_000_000;
      const { state, nonce } = createGoogleOAuthState(PAYLOAD, SECRET, issued);
      expect(parseGoogleOAuthState(state, SECRET, nonce, issued + OAUTH_STATE_TTL_MS - 1)).toEqual(PAYLOAD);
      expect(parseGoogleOAuthState(state, SECRET, nonce, issued + OAUTH_STATE_TTL_MS + 1)).toBeNull();
    });

    it('미래에서 온 state 는 받지 않는다', () => {
      const issued = 1_700_000_000_000;
      const { state, nonce } = createGoogleOAuthState(PAYLOAD, SECRET, issued);
      expect(parseGoogleOAuthState(state, SECRET, nonce, issued - 5 * 60_000)).toBeNull();
    });
  });

  it('register 모드와 조직 이름이 그대로 돌아온다', () => {
    const payload = { mode: 'register' as const, tenantSlug: 'newco', tenantName: '새 회사' };
    const { state, nonce } = createGoogleOAuthState(payload, SECRET);
    expect(parseGoogleOAuthState(state, SECRET, nonce)).toEqual(payload);
  });
});
