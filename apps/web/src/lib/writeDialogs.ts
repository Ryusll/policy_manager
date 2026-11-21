import { useCallback, useLayoutEffect, useState } from 'react';

/*
 * 쓰기 창 등록부(T-224 단계 B, 설계 E1) — 지금 열려 있는 규정 화면의 쓰기 창(판 승인·반려·폐지·철회 등)을 규정·종류별로 건다. 창을 열
 * 때마다 번호(token)를 새로 매기고, 쓰기(lib/policyWrite runWrite)는 시작할 때 그 번호를 잡아 끝났을 때 같은 번호의 창이 아직 열려
 * 있을 때만 창을 닫거나 창 안에 실패를 보인다 — 진행 중에 창을 닫았거나, 규정을 옮겼다 돌아와 화면을 새로 그렸거나(창이 없다), 다른
 * 대상으로 창을 다시 열었으면 결과는 조문 배너·도구 줄·이름 붙은 알림으로 간다. 해제는 자기가 건 것일 때만 뺀다(registerOpenDialog 와
 * 같은 꼴).
 */

export type WriteDialogControls = { token: number; setError: (message: string | null) => void; close: () => void };

const dialogs = new Map<string, WriteDialogControls>();
const keyOf = (policyId: string, kind: string) => `${kind}:${policyId}`;
let seq = 0;

/** 창을 열 때마다 새 번호 — 같은 창을 닫았다 다시 열어도 앞 쓰기의 결과가 새 창을 닫거나 새 창에 실패를 보이지 않게 */
export const nextDialogToken = () => ++seq;

/** 지금 열려 있는 그 규정·종류의 창(없으면 undefined) */
export const writeDialogFor = (policyId: string, kind: string): WriteDialogControls | undefined => dialogs.get(keyOf(policyId, kind));

/** 그 번호의 창이 아직 열려 있으면 그 창 — 쓰기가 시작할 때 잡은 번호와 견준다 */
export function sameDialog(policyId: string, kind: string, token: number | null | undefined): WriteDialogControls | undefined {
  const d = token == null ? undefined : writeDialogFor(policyId, kind);
  return d && d.token === token ? d : undefined;
}

export function registerWriteDialog(policyId: string, kind: string, controls: WriteDialogControls): () => void {
  const key = keyOf(policyId, kind);
  dialogs.set(key, controls);
  return () => {
    if (dialogs.get(key) === controls) dialogs.delete(key);
  };
}

/**
 * 쓰기 창 하나의 상태 — 대상(target)·번호(token)·창 안 실패(error). 열면 실패를 비우고 새 번호를 매기며(E14), 열려 있는 동안 등록부에
 * 건다(그린 직후 — 쓰기가 끝나는 때보다 늦지 않게). close 는 늘 같은 함수다.
 */
export function useWriteDialogState<T>(kind: string, policyId: string | undefined) {
  const [state, setState] = useState<{ target: T; token: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const open = useCallback((target: T) => {
    setError(null);
    setState({ target, token: nextDialogToken() });
  }, []);
  const close = useCallback(() => {
    setState(null);
    setError(null);
  }, []);
  const token = state?.token ?? null;
  useLayoutEffect(() => {
    if (!policyId || token === null) return undefined;
    return registerWriteDialog(policyId, kind, { token, setError, close });
  }, [kind, policyId, token, close]);
  return { target: state?.target ?? null, token, error, open, close };
}
