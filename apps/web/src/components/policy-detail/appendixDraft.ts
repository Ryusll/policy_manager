/** 부칙·별표·서식 창의 입력(T-224 단계 C) — 창(AppendixDialog)과 쓰기(useBodyWrites)가 같이 쓴다 */
export type AppendixKind = 'supplementary' | 'annex' | 'form';
export type AppendixDraft = { kind: AppendixKind; title: string; body: string; sortOrder: string };

/** 길이 상한 — 서버 DTO(Create·UpdatePolicyAppendixDto MaxLength)와 같다. 넘기면 서버의 영문 검증 문구로 거절돼 까닭을 알 수 없다 */
export const APPENDIX_TITLE_MAX = 500;
export const APPENDIX_BODY_MAX = 500000;

/** 창 입력을 보낼 값으로 — 제목은 앞뒤 공백을 빼고, 정렬 순서는 비우면 없음(서버가 0), 아니면 0 이상의 정수 */
export function appendixPayload(draft: AppendixDraft) {
  const sortOrder = draft.sortOrder.trim() === '' ? undefined : Math.max(0, Math.floor(Number(draft.sortOrder)) || 0);
  return { kind: draft.kind, title: draft.title.trim(), body: draft.body, sortOrder };
}
