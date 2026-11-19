/**
 * 이어서 묻기(T-220, SRS SEARCH-12) — 질문 화면의 잇기 칩이 가리키는 앞 질문과 그 바뀜. 다음 질문은 이 앞 질문의 답에 잇는다
 * (서버가 그 답의 근거 조문을 이어받는다 — 앞 질문·답의 글은 보내지 않는다).
 */
export interface FollowUp {
  id: string;
  question: string;
}

/** 답이 오면 — 답을 냈으면 그 답으로 옮기고, 답하지 못했으면 앞 잇기를 그대로 둔다(다시 물을 수 있게) */
export function followUpAfterAnswer(current: FollowUp | null, result: { answerable: boolean; id: string }, question: string): FollowUp | null {
  return result.answerable ? { id: result.id, question } : current;
}

/** 보내지 못했으면 — 앞 질문을 그사이 쓸 수 없게 됐을 때(400 AI_QA_PARENT_INVALID)만 걷고, 다른 오류(한도·잠시 오류)는 둔다 */
export function followUpAfterError(current: FollowUp | null, code: string | undefined): FollowUp | null {
  return code === 'AI_QA_PARENT_INVALID' ? null : current;
}

/** 지난 답에서 이을 수 있는가 — 답을 냈고, 물은 때의 근거를 남겼고, 그 근거에 회사 조문이 있는 기록만(서버 규칙과 같다) */
export function canFollowUpFrom(detail: { snapshot: boolean; result: { answerable: boolean; citations: readonly unknown[] } | null }): boolean {
  return !!detail.result?.answerable && detail.snapshot && detail.result.citations.length > 0;
}
