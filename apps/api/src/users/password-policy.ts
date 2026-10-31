/**
 * 새 비밀번호 규칙 중 DTO(class-validator)로 표현하기 어려운 것.
 *
 * bcrypt 는 **72바이트**까지만 해시한다. 한글은 글자당 3바이트라 24자만 넘어도
 * 뒷부분이 조용히 무시되어, "긴 비밀번호"를 정했는데 앞 24자만 맞아도 로그인되는 상태가 된다.
 */
export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_BYTES = 72;

/** 문제가 있으면 사용자에게 보일 문구, 없으면 null */
export function passwordProblem(next: string, current?: string): string | null {
  if (next.length < PASSWORD_MIN_LENGTH) {
    return `비밀번호는 ${PASSWORD_MIN_LENGTH}자 이상이어야 합니다.`;
  }
  if (Buffer.byteLength(next, 'utf8') > PASSWORD_MAX_BYTES) {
    return `비밀번호가 너무 깁니다(${PASSWORD_MAX_BYTES}바이트 이하 — 한글은 글자당 3바이트).`;
  }
  if (current !== undefined && next === current) {
    return '새 비밀번호가 현재 비밀번호와 같습니다.';
  }
  return null;
}
