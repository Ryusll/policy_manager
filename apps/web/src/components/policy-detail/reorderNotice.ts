/*
 * 조 순서 창 위 안내 칸의 규칙(T-215·T-225) — 순수 함수만. 훅(useReorderSave)이 상태를 바꾸고, 페이지가 reorderNotice 를 창에 펼친다.
 * - 거절 안내(409 POLICY_JO_ORDER_STALE): 그 순서를 그린 창에 하나만, role=alert
 * - 다시 열기 안내: 기준(연 때·저장을 시작한 때·거절 안내를 단 때) 뒤에 창이 새로 그려졌으면, 저장 중이 아닐 때, role=status
 */

/** 거절 안내(T-225) — 그 순서(서명)를 그린 창의 위 안내 칸에 다시 열기 안내 대신 보인다 */
export type ReorderNote = { sig: string; message: string };

/**
 * 순서 창 위 안내 칸(순수 함수, 창에 그대로 펼친다) — 거절 안내가 지금 그린 순서의 것이면 그것 하나(다시 받은 순서로 새로 그린 창에
 * '다시 열었습니다'를 따로 띄우지 않는다). 저장이 반영되지 않았다는 알림이라 role=alert — 창이 새로 붙으며 글째 끼워 넣는 status 칸은
 * 화면 낭독기가 읽지 않을 수 있다. 아니면 기준 뒤에 창이 새로 그려졌을 때 다시 열기 안내(T-215, status — 저장 중에는 띄우지 않는다)
 */
export function reorderNotice(
  s: { note: ReorderNote | null; signature: string; redrawn: boolean; saving: boolean },
  t: (key: string) => string,
): { notice?: string; noticeAlert?: boolean } {
  if (s.note && s.note.sig === s.signature) return { notice: s.note.message, noticeAlert: true };
  return !s.saving && s.redrawn ? { notice: t('policyDetail.reorder.reopened'), noticeAlert: false } : {};
}

/** 창 기준 — 사용자가 마지막으로 보고 움직인 순서(연 때·저장을 시작한 때·거절 안내를 단 때)와, 그 뒤에 창이 새로 그려졌는가(T-215·T-225) */
export type ReorderBase = { sig: string | null; redrawn: boolean };
export type ReorderBaseEvent = { type: 'open' | 'save' | 'note' | 'sig'; sig: string } | { type: 'close' };

/**
 * 창 기준의 다음 상태(순수 함수). 열 때·저장을 시작할 때·거절 안내를 달 때 그 순서를 기준으로 잡고 새로 그림 표시를 끈다 — 새로 그려진
 * 창에서 다시 옮겨 저장했다가 코드 없는 4xx 로 끝나면 옮긴 것이 그대로인데 '다시 옮기세요'가 다시 뜨지 않게. 그래서 저장이 끝난 때의
 * 표시는 '이 저장이 도는 동안 새로 그려졌는가'다(거절 문구를 고를 때 본다, staleKey). 창이 열린 동안 그린 순서가 바뀌면 켠다(창은 서명이
 * key — 옮긴 것이 사라진다). 기준과 같은 순서로 돌아와도 끄지 않는다 — 서명이 같은지로 보면 S1→S2→S1·S2→S3→S2 로 돌아와 새로 그릴 때
 * 안내가 없다
 */
export function baseStep(b: ReorderBase, e: ReorderBaseEvent): ReorderBase {
  // 값이 같으면 받은 것을 그대로 돌려준다 — 같은 객체면 React 가 다시 그리지 않는다(창이 닫힌 채 규정을 열 때 규정 상세 전체를 한 번 더
  // 그리지 않게. 열린 창을 닫으면 값이 실제로 바뀌므로 다시 그린다)
  if (e.type === 'close') return b.sig === null && !b.redrawn ? b : { sig: null, redrawn: false };
  if (e.type === 'sig') return b.sig !== null && e.sig !== b.sig ? { sig: e.sig, redrawn: true } : b;
  return b.sig === e.sig && !b.redrawn ? b : { sig: e.sig, redrawn: false };
}

/**
 * 거절 안내의 문구(순수 함수) — 창에 무엇이 남아 있는지에 따라. 창이 다른 순서로 새로 그려졌으면(받았거나 저장하는 동안 다른 받기로 —
 * 같은 순서로 돌아왔어도 옮긴 것은 이미 사라졌다) 지금 순서를 확인하고 다시 옮기라고, 받지 못했고 그대로면 새로 고치라고, 받았고 창이
 * 한 번도 새로 그려지지 않았으면 옮긴 것이 창에 그대로이니 다시 저장하라고 — 창이 열려 있을 때만(닫혔으면 옮긴 것이 없다, 결과 알림)
 */
export function staleKey(s: { toDialog: boolean; fresh: boolean; redrawn: boolean }): string {
  if (s.redrawn) return 'policyDetail.reorder.stale';
  if (!s.fresh) return 'policyDetail.reorder.staleUnfetched';
  return s.toDialog ? 'policyDetail.reorder.staleSame' : 'policyDetail.reorder.stale';
}

/** 거절 안내를 걷을 때인가(순수 함수) — 안내를 단 순서에서 창이 떠났으면(다시 받기·다른 사람 저장). 같은 순서로 돌아와도 옛 거절 문구를 되살리지 않게(S2→S3→S2) */
export const noteLeft = (note: ReorderNote | null, signature: string) => note !== null && note.sig !== signature;
