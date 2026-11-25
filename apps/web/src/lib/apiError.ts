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

/**
 * 서버가 사람에게 준 오류 문구(할 일이 적혀 있다) — 없거나 서버 기본 문구('Internal server error')면 null.
 * 입력 검증 실패처럼 배열이면 첫 문구.
 */
export function serverMessage(err: unknown): string | null {
  const message = (err as { response?: { data?: { message?: unknown } } } | null)?.response?.data?.message;
  const first = Array.isArray(message) ? message[0] : message;
  return typeof first === 'string' && first && first !== 'Internal server error' ? first : null;
}

/** 화면이 갈라 처리할 오류 `code`(예: `AI_QA_SCOPE_INVALID`) */
export function errorCode(err: unknown): string | undefined {
  const code = (err as { response?: { data?: { code?: unknown } } } | null)?.response?.data?.code;
  return typeof code === 'string' ? code : undefined;
}
