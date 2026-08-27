import { describe, it, expect } from 'vitest';
import {
  resolveGoogleAccount,
  type GoogleResolutionInput,
} from '../apps/api/src/auth/google-account-resolution';

/**
 * 구글 콜백이 계정에 대해 내리는 판단 (T-42).
 *
 * 이 경로는 구글 없이는 통합 테스트로 재현할 수 없다. 그래서 판단만 순수 함수로
 * 떼어 내 여기서 전수로 확인한다.
 *
 * 감사에서 막은 두 가지가 이 파일의 중심이다.
 *  - `mode=login` 이 초대 없이 남의 조직에 `viewer` 계정을 만들어 줬다.
 *  - 구글이 확인하지 않은 이메일(`email_verified: false`)을 그대로 믿었다.
 */

const IDENTITY = {
  email: 'someone@gmail.com',
  name: '아무개',
  googleId: 'google-sub-1',
  emailVerified: true,
};

const base = (over: Partial<GoogleResolutionInput> = {}): GoogleResolutionInput => ({
  identity: IDENTITY,
  mode: 'login',
  tenantSlug: 'acme',
  tenantName: '',
  linkedUser: null,
  tenant: { id: 'tenant-acme' },
  userInTenant: null,
  ...over,
});

describe('구글 계정 판단 (T-42)', () => {
  describe('확인되지 않은 이메일', () => {
    /**
     * 구글이 소유를 확인해 주지 않은 주소는 신원의 근거가 못 된다.
     * 이걸 믿으면 남의 이메일을 주장해 기존 계정에 붙을 수 있다.
     */
    it('무엇보다 먼저 거부한다 — 붙을 계정이 있어도', () => {
      const r = resolveGoogleAccount(
        base({
          identity: { ...IDENTITY, emailVerified: false },
          userInTenant: { id: 'u1', oauthSub: null },
        }),
      );
      expect(r).toEqual({ kind: 'reject', code: 'email_unverified', message: expect.any(String) });
    });

    it('이미 연결된 계정이어도 거부한다', () => {
      const r = resolveGoogleAccount(
        base({
          identity: { ...IDENTITY, emailVerified: false },
          linkedUser: { id: 'u1', tenantSlug: 'acme' },
        }),
      );
      expect(r).toMatchObject({ kind: 'reject', code: 'email_unverified' });
    });
  });

  describe('mode=login — 초대받지 않은 사람', () => {
    /**
     * **감사 전에는 여기서 `viewer` 사용자를 새로 만들었다.**
     * 구글 계정이 있는 누구나 조직 코드만 알면 남의 회사 규정을 열람할 수 있었다.
     */
    it('그 조직에 계정이 없으면 거부한다 (예전에는 만들어 줬다)', () => {
      const r = resolveGoogleAccount(base({ userInTenant: null }));
      expect(r).toMatchObject({ kind: 'reject', code: 'not_invited' });
    });

    /** 다르게 답하면 조직 코드가 실재하는지를 밖에서 확인할 수 있다 */
    it('조직이 없을 때와 초대받지 않았을 때의 답이 같다', () => {
      const noTenant = resolveGoogleAccount(base({ tenant: null, userInTenant: null }));
      const notInvited = resolveGoogleAccount(base({ userInTenant: null }));
      expect(noTenant).toEqual(notInvited);
    });
  });

  describe('mode=login — 초대받은 사람', () => {
    it('비밀번호 계정이 있으면 구글 신원을 붙인다', () => {
      const r = resolveGoogleAccount(base({ userInTenant: { id: 'u1', oauthSub: null } }));
      expect(r).toEqual({ kind: 'link', userId: 'u1' });
    });

    it('같은 구글 계정이 이미 붙어 있으면 그대로 로그인', () => {
      const r = resolveGoogleAccount(
        base({ userInTenant: { id: 'u1', oauthSub: 'google-sub-1' } }),
      );
      expect(r).toEqual({ kind: 'authenticate', userId: 'u1' });
    });

    it('그 이메일이 다른 구글 계정에 붙어 있으면 거부한다', () => {
      const r = resolveGoogleAccount(
        base({ userInTenant: { id: 'u1', oauthSub: 'google-sub-OTHER' } }),
      );
      expect(r).toMatchObject({ kind: 'reject', code: 'email_linked_elsewhere' });
    });
  });

  describe('이미 이 구글 계정으로 만든 사용자가 있을 때', () => {
    it('같은 조직이면 로그인', () => {
      const r = resolveGoogleAccount(base({ linkedUser: { id: 'u9', tenantSlug: 'acme' } }));
      expect(r).toEqual({ kind: 'authenticate', userId: 'u9' });
    });

    /** 조직 코드를 바꿔 넣어도 소속이 옮겨 가지 않는다 */
    it('다른 조직 소속이면 거부한다', () => {
      const r = resolveGoogleAccount(
        base({ tenantSlug: 'victim-corp', linkedUser: { id: 'u9', tenantSlug: 'acme' } }),
      );
      expect(r).toMatchObject({ kind: 'reject', code: 'other_organization' });
    });

    it('가입 모드로 다시 오면 거부한다', () => {
      const r = resolveGoogleAccount(
        base({ mode: 'register', tenantName: '새 회사', linkedUser: { id: 'u9', tenantSlug: 'acme' } }),
      );
      expect(r).toMatchObject({ kind: 'reject', code: 'already_registered' });
    });
  });

  describe('mode=register', () => {
    const reg = (over: Partial<GoogleResolutionInput> = {}) =>
      resolveGoogleAccount(
        base({ mode: 'register', tenantSlug: 'newco', tenantName: '새 회사', tenant: null, ...over }),
      );

    it('새 조직과 첫 관리자를 만든다', () => {
      expect(reg()).toEqual({ kind: 'createTenant', tenantSlug: 'newco', tenantName: '새 회사' });
    });

    /** 남의 조직 코드로 가입해 들어가면 안 된다 */
    it('이미 있는 조직 코드는 거부한다', () => {
      expect(reg({ tenant: { id: 'tenant-newco' } })).toMatchObject({
        kind: 'reject',
        code: 'slug_taken',
      });
    });

    it('조직 코드 길이를 벗어나면 거부한다', () => {
      expect(reg({ tenantSlug: 'a' })).toMatchObject({ kind: 'reject', code: 'invalid_slug' });
      expect(reg({ tenantSlug: 'x'.repeat(41) })).toMatchObject({
        kind: 'reject',
        code: 'invalid_slug',
      });
    });

    it('조직 이름이 비면 거부한다', () => {
      expect(reg({ tenantName: '   ' })).toMatchObject({
        kind: 'reject',
        code: 'missing_tenant_name',
      });
    });

    it('조직 이름의 앞뒤 공백은 정리해서 넘긴다', () => {
      expect(reg({ tenantName: '  새 회사  ' })).toMatchObject({ tenantName: '새 회사' });
    });
  });
});
