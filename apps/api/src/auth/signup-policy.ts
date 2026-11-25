/**
 * 공개 회원가입 — 누구나 로그인 화면에서 새 회사(조직)를 만드는 경로 — 을 열지 (T-122).
 *
 * **기본은 닫힘.** 이 제품은 아스트룸이 계약한 고객사를 통합 관리자 콘솔에서 개설하고, 그 회사의
 * 마스터가 직원 계정을 발급하는 방식이다. 운영 서버는 인터넷에 열려 있어, 열어 두면 아무나 회사를
 * 만들어 데이터를 쌓을 수 있다. 개발·통합 테스트(docker-compose.yml)만 `ALLOW_PUBLIC_SIGNUP=true`
 * 로 연다 — 테스트가 가입으로 회사를 만든다.
 */
export function publicSignupEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return String(env.ALLOW_PUBLIC_SIGNUP ?? '').trim().toLowerCase() === 'true';
}

export const SIGNUP_CLOSED_MESSAGE =
  '회원가입은 아스트룸을 통해서만 진행됩니다. 계정이 필요하면 회사 관리자에게 요청하세요.';
