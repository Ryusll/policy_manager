/**
 * 서버 오류 응답에서 사람이 읽을 문구를 꺼낸다.
 * 입력 검증 실패(400)는 `message` 가 문자열 배열로 오므로 그대로 화면에 올리면 깨진다.
 */
export function apiErrorMessage(err: unknown, fallback: string): string {
  const message = (err as { response?: { data?: { message?: unknown } } } | null)?.response?.data
    ?.message;
  if (Array.isArray(message)) return message.join(', ');
  return typeof message === 'string' && message ? message : fallback;
}
