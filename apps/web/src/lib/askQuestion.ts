/**
 * 규정 질문의 입력 규칙 — 질문 화면·대시보드 입구·넘겨받은 질문이 같은 함수를 쓴다(T-217, SRS SEARCH-9).
 *
 * 길이는 서버 `AskDto` 와 같다: 앞뒤 공백을 뗀 뒤 2~500자. 화면이 먼저 막아 두면 서버 400 을 보지 않는다.
 */
export const ASK_MIN_CHARS = 2;
export const ASK_MAX_CHARS = 500;

/** 대시보드 입구가 질문을 넘기는 라우터 state 의 이름 */
export const ASK_ONCE_STATE = 'askOnce';

export function normalizeQuestion(raw: string): string {
  return raw.trim();
}

/** 보낼 수 있는 질문인가 */
export function canSubmitQuestion(raw: string): boolean {
  const q = normalizeQuestion(raw);
  return q.length >= ASK_MIN_CHARS && q.length <= ASK_MAX_CHARS;
}

/** 지금 물을 수 있는가 — 서버에 AI 가 있고, 회사가 켰다(동의한 고지 판이 지금 판일 때만 enabled) */
export function canAskNow(status: { configured: boolean; enabled: boolean } | null | undefined): boolean {
  return !!status?.configured && !!status?.enabled;
}

/**
 * 다른 화면에서 넘겨받은 질문. 대시보드 입구는 라우터 state 로 넘기고(보낸다), 주소의 `?q=` 는 채우기만 한다.
 * 주소는 누구나 링크로 만들어 퍼뜨릴 수 있다 — 링크를 누르는 것만으로 고지도 보기 전에 남이 쓴 글이 외부 AI 로 나가고
 * 내 한도를 쓰면 안 된다(SEARCH-6·9). 라우터 state 는 이 앱 안에서 이동할 때만 생긴다.
 */
export function incomingQuestion(state: unknown, search: string): { text: string | null; autoSend: boolean } {
  const once = state && typeof state === 'object' ? (state as Record<string, unknown>)[ASK_ONCE_STATE] : undefined;
  if (typeof once === 'string') return { text: once, autoSend: true };
  return { text: new URLSearchParams(search).get('q'), autoSend: false };
}

/** 넘겨받은 질문을 어떻게 할지 */
export type IncomingQuestionAction =
  /** 넘겨받은 질문이 없다 */
  | { kind: 'none' }
  /** 아직 판단할 수 없다(상태를 받는 중이거나 보내는 중) — 그대로 두고 기다린다 */
  | { kind: 'wait' }
  /** 지우기만 한다 — 이미 처리했거나, 너무 짧거나, 지금 물을 수 없다 */
  | { kind: 'clear' }
  /** 지우고 입력칸에만 채운다 — 주소로 왔거나 너무 길다(잘라서 보이고 직원이 보고 보낸다) */
  | { kind: 'fill'; question: string }
  /** 지우고 한 번 보낸다 */
  | { kind: 'send'; question: string };

/**
 * 넘겨받은 질문은 **한 번만** 처리한다(SEARCH-9 ③). 처리하는 순간 지우므로 새로고침·뒤로·앞으로 가기로는 다시 처리하지 않고,
 * 같은 이동을 이미 처리했으면(`handled`) 지우기만 한다.
 */
export function decideIncomingQuestion(input: {
  text: string | null;
  autoSend: boolean;
  handled: boolean;
  statusReady: boolean;
  canAsk: boolean;
  pending: boolean;
}): IncomingQuestionAction {
  const { text, autoSend, handled, statusReady, canAsk, pending } = input;
  if (text === null) return { kind: 'none' };
  if (handled) return { kind: 'clear' };
  if (!statusReady || pending) return { kind: 'wait' };
  const question = normalizeQuestion(text);
  if (question.length < ASK_MIN_CHARS) return { kind: 'clear' };
  if (!autoSend || question.length > ASK_MAX_CHARS) return { kind: 'fill', question: question.slice(0, ASK_MAX_CHARS) };
  if (!canAsk) return { kind: 'clear' };
  return { kind: 'send', question };
}
