/**
 * "이 구글 계정으로 무엇을 해 줄 것인가" 를 정하는 순수 함수 (T-42).
 *
 * 서비스 안에 흩어져 있던 분기를 한곳에 모았다. DB 없이 검사할 수 있어야
 * 각 분기를 실제로 확인할 수 있기 때문이다 — OAuth 콜백은 구글 없이는
 * 통합 테스트로 재현할 수 없는 경로라 더욱 그렇다.
 *
 * **감사에서 바꾼 것 두 가지**
 *
 * 1. `mode=login` 이 남의 회사에 계정을 만들어 줬다. 예전에는 조직 코드만 맞으면
 *    그 조직에 없던 이메일에도 `viewer` 사용자를 새로 만들었다. 구글 계정이 있는
 *    누구나 `?mode=login&tenantSlug=<남의회사>` 로 들어가 열람 권한을 얻을 수
 *    있었다는 뜻이다. 초대(관리자의 사용자 생성)를 거친 계정만 들어온다.
 *
 * 2. 구글이 확인해 주지 않은 이메일을 그대로 믿었다. `email_verified` 가 거짓인
 *    계정으로 남의 이메일 주소를 주장하면 그 사람의 기존 계정에 연결됐다.
 */

export interface GoogleIdentity {
  email: string;
  name: string;
  googleId: string;
  /** 구글이 이 주소의 소유를 확인했는가(`email_verified`) */
  emailVerified: boolean;
}

export interface GoogleResolutionInput {
  identity: GoogleIdentity;
  mode: 'login' | 'register';
  /** 이미 정규화된 조직 코드 */
  tenantSlug: string;
  tenantName: string;
  /** oauthSub 로 찾은 사용자 (다른 조직일 수 있다) */
  linkedUser: { id: string; tenantSlug: string } | null;
  /** tenantSlug 로 찾은 조직 */
  tenant: { id: string } | null;
  /** 그 조직 안에서 같은 이메일을 쓰는 사용자 */
  userInTenant: { id: string; oauthSub: string | null } | null;
}

export type GoogleResolution =
  /** 그대로 로그인시킨다 */
  | { kind: 'authenticate'; userId: string }
  /** 기존(비밀번호) 계정에 구글 신원을 붙이고 로그인시킨다 */
  | { kind: 'link'; userId: string }
  /** 새 조직과 첫 관리자를 만든다 */
  | { kind: 'createTenant'; tenantSlug: string; tenantName: string }
  | { kind: 'reject'; code: RejectCode; message: string };

export type RejectCode =
  | 'email_unverified'
  | 'already_registered'
  | 'other_organization'
  | 'invalid_slug'
  | 'missing_tenant_name'
  | 'slug_taken'
  | 'not_invited'
  | 'email_linked_elsewhere';

const SLUG_MIN = 2;
const SLUG_MAX = 40;

/**
 * 조직이 없는 경우와 초대받지 않은 경우에 **같은 답을 준다.** 다르게 답하면
 * 조직 코드가 실재하는지를 외부에서 확인할 수 있다.
 */
const NOT_INVITED =
  '이 조직에 등록된 계정이 아닙니다. 조직 관리자에게 계정 생성을 요청하세요.';

export function resolveGoogleAccount(input: GoogleResolutionInput): GoogleResolution {
  const { identity, mode, tenantSlug, tenantName, linkedUser, tenant, userInTenant } = input;

  // 구글이 확인하지 않은 주소는 신원의 근거가 되지 못한다. 다른 모든 판단보다 먼저 본다.
  if (!identity.emailVerified) {
    return {
      kind: 'reject',
      code: 'email_unverified',
      message: '구글에서 이메일 확인이 끝나지 않은 계정입니다.',
    };
  }

  // 이미 이 구글 계정으로 만든 사용자가 있다
  if (linkedUser) {
    if (mode === 'register') {
      return {
        kind: 'reject',
        code: 'already_registered',
        message: '이미 가입된 구글 계정입니다. 로그인해 주세요.',
      };
    }
    if (linkedUser.tenantSlug !== tenantSlug) {
      return {
        kind: 'reject',
        code: 'other_organization',
        message: `이 구글 계정은 "${linkedUser.tenantSlug}" 조직 소속입니다.`,
      };
    }
    return { kind: 'authenticate', userId: linkedUser.id };
  }

  if (mode === 'register') {
    if (tenantSlug.length < SLUG_MIN || tenantSlug.length > SLUG_MAX) {
      return { kind: 'reject', code: 'invalid_slug', message: '조직 코드가 올바르지 않습니다.' };
    }
    if (!tenantName.trim()) {
      return { kind: 'reject', code: 'missing_tenant_name', message: '조직 이름이 필요합니다.' };
    }
    if (tenant) {
      return { kind: 'reject', code: 'slug_taken', message: '이미 사용 중인 조직 코드입니다.' };
    }
    return { kind: 'createTenant', tenantSlug, tenantName: tenantName.trim() };
  }

  // mode === 'login'
  if (!tenant || !userInTenant) {
    return { kind: 'reject', code: 'not_invited', message: NOT_INVITED };
  }

  if (userInTenant.oauthSub) {
    if (userInTenant.oauthSub !== identity.googleId) {
      return {
        kind: 'reject',
        code: 'email_linked_elsewhere',
        message: '이 이메일은 다른 구글 계정에 연결돼 있습니다.',
      };
    }
    return { kind: 'authenticate', userId: userInTenant.id };
  }

  return { kind: 'link', userId: userInTenant.id };
}

/**
 * 거부 사유를 코드째 위로 올린다. 콜백은 화면으로 리다이렉트만 하므로
 * 상태 코드로는 이유를 전달할 수 없고, 이유를 잃으면 사용자는 "실패했습니다"만
 * 보고 같은 실패를 반복하게 된다.
 */
export class GoogleOAuthRejection extends Error {
  constructor(
    readonly code: RejectCode,
    message: string,
  ) {
    super(message);
    this.name = 'GoogleOAuthRejection';
  }
}
