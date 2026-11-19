/**
 * 로그인 화면의 안내 문구 고르기 — T-212, SRS NFR-9.
 *
 * 공개 회원가입이 닫힌 서버(운영)에서는 데모 기관(demo)·회원가입·시드 안내를 보이지 않는다.
 * 서버 설정(`GET /auth/options`)을 받기 전이나 받지 못했을 때도 닫힌 쪽으로 그린다 —
 * 운영 화면에 개발용 안내가 잠깐이라도 비치지 않게. 가입이 열린 서버(개발·시험)는 지금처럼 demo 를 안내한다.
 */

export interface LoginCopy {
  /** 공개 회원가입이 열린 서버인가 */
  open: boolean;
  /** 기관 코드 칸의 처음 값(사용자가 아직 손대지 않았을 때) */
  defaultTenant: string;
  tenantHintKey: string;
  tenantPlaceholderKey: string;
  emailPlaceholderKey: string;
  /** 서버 오류 'Tenant not found' 를 옮길 문구 키 */
  tenantNotFoundKey: string;
  /** 서버 오류 'Invalid credentials' 를 옮길 문구 키 */
  invalidCredentialsKey: string;
}

const OPEN: LoginCopy = {
  open: true,
  defaultTenant: 'demo',
  tenantHintKey: 'login.tenantHint',
  tenantPlaceholderKey: 'login.tenantPlaceholderDemo',
  emailPlaceholderKey: 'login.emailPlaceholderDemo',
  tenantNotFoundKey: 'login.tenantNotFound',
  invalidCredentialsKey: 'login.invalidCredentials',
};

const CLOSED: LoginCopy = {
  open: false,
  defaultTenant: '',
  tenantHintKey: 'login.tenantHintClosed',
  tenantPlaceholderKey: 'login.tenantPlaceholder',
  emailPlaceholderKey: 'login.emailPlaceholder',
  tenantNotFoundKey: 'login.tenantNotFoundClosed',
  invalidCredentialsKey: 'login.invalidCredentialsClosed',
};

export function loginCopy(publicSignup: boolean | undefined): LoginCopy {
  return publicSignup === true ? OPEN : CLOSED;
}

/**
 * 로그인 실패 문구 키 — 서버 문구를 그대로 내보이지 않는다(T-212, NFR-9).
 * 로그인 API 가 사람에게 보일 뜻으로 돌려주는 것은 두 가지(기관 코드 없음·자격 증명 틀림)뿐이고, 나머지 —
 * 요청 한도(429, 'ThrottlerException: …'), 입력 검증(400, 필드 이름이 든 영어), 서버 오류 — 는 영어 원문이라 화면 문구로 바꾼다.
 * 비밀번호 미설정(PASSWORD_NOT_SET)은 화면이 `code` 로 먼저 가른다.
 */
export function loginErrorKey(copy: LoginCopy, status: number | undefined, serverMessage: unknown): string {
  const raw = typeof serverMessage === 'string' ? serverMessage : Array.isArray(serverMessage) ? String(serverMessage[0]) : '';
  if (raw === 'Tenant not found') return copy.tenantNotFoundKey;
  if (raw === 'Invalid credentials') return copy.invalidCredentialsKey;
  if (status === 429) return 'login.tooMany';
  return 'login.error';
}
