import { useCallback, useEffect, useReducer } from 'react';
import { isRunning, useRuns } from '../../lib/policyResult';

/**
 * 적용 양식 고르기 상태(T-215) — selected: null 은 아직 서버 값을 받지 않음, '' 는 기본 양식(자동 — 규정에 양식을 지정하지 않음).
 * 1차 검토: 고른 값이 비었다고('') 서버 값을 다시 고르는 동기화가 '자동'을 고른 순간 옛 양식으로 되돌렸다.
 * 8차 검토: 저장 중 표시는 저장하는 규정에 묶는다(savingFor) — 묶지 않으면 앞 규정의 저장이 새 규정의 양식 메뉴를 막았다(그때는 같은
 * 화면을 규정만 바꿔 다시 썼다 — 11차부터 규정마다 화면을 새로 그리지만, 한 화면 안의 규칙으로 남겨 둔다).
 */
export type TemplateSelectionState = { policyId: string | null; server: string | null; selected: string | null; savingFor: readonly string[] };
export type TemplateSelectionAction =
  | { type: 'server'; policyId: string; value: string }
  | { type: 'pick'; policyId: string; id: string; save: boolean }
  | { type: 'saved'; policyId: string }
  | { type: 'failed'; policyId: string };

export const TEMPLATE_SELECTION_INITIAL: TemplateSelectionState = { policyId: null, server: null, selected: null, savingFor: [] };

/** 이 규정의 양식을 저장하는 중인가 — 다른 규정에서 시작한 저장은 이 규정의 메뉴를 막지 않는다 */
export const isSavingTemplate = (state: TemplateSelectionState, policyId: string): boolean => state.savingFor.includes(policyId);

/**
 * - 서버 값이 바뀔 때만(처음 받을 때·저장 뒤 다시 받을 때·다른 규정으로 옮길 때) 고른 값을 서버 값으로 맞춘다. 같은 값을 다시
 *   받으면(창 포커스로 다시 받기 등) 고른 값을 그대로 둔다 — 열람자가 화면에서만 바꾼 양식이 남는다
 * - 그 규정의 양식을 저장하는 동안은 다른 양식을 고르지 않는다(늦게 끝난 실패가 앞선 성공을 덮지 않게)
 * - 저장에 실패하면 그 규정을 아직 보고 있을 때만 서버 값으로 되돌린다(옮긴 뒤면 지금 규정의 고른 값은 그대로)
 */
export function templateSelection(state: TemplateSelectionState, action: TemplateSelectionAction): TemplateSelectionState {
  switch (action.type) {
    case 'server':
      if (action.policyId === state.policyId && action.value === state.server) return state;
      // 저장 중 표시는 저장이 끝날 때(saved·failed)만 끈다 — 저장 중에 다른 값이 와도 메뉴가 풀려 고른 것이 조용히 버려지지 않게
      return { ...state, policyId: action.policyId, server: action.value, selected: action.value };
    case 'pick':
      if (isSavingTemplate(state, action.policyId)) return state;
      return { ...state, selected: action.id, savingFor: action.save ? [...state.savingFor, action.policyId] : state.savingFor };
    case 'saved':
      return { ...state, savingFor: state.savingFor.filter((p) => p !== action.policyId) };
    case 'failed':
      return {
        ...state,
        savingFor: state.savingFor.filter((p) => p !== action.policyId),
        selected: state.policyId === action.policyId ? state.server : state.selected,
      };
  }
}

/**
 * 메뉴에 고른 것으로 그릴 양식 id — 저장 중이면 보낸 양식(다시 그린 화면도 저장소에서 안다, 12차 #2), 아니면 고른 값. 서버 값이
 * 바뀌었는데 상태가 아직 따라오지 않은 그리기(동기화 효과는 그린 뒤에 돈다)에는 서버 값 — 다른 화면이 시작한 저장이 끝나 보낸 값이
 * 빠지는 그리기에 옛 양식이 한 번 그려지지 않게(13차 #5)
 */
export function shownTemplateId(state: TemplateSelectionState, policyId: string | undefined, serverValue: string | null, pending: string | undefined): string {
  const synced = state.policyId === (policyId ?? '') && state.server === serverValue;
  return pending ?? (synced ? state.selected : serverValue) ?? '';
}

/** 화면에 입힐 양식 — 고른 양식, '' 이거나 목록에 없으면 회사 기본 양식 */
export function pickActiveTemplate<T extends { id: string; isDefault?: boolean }>(templates: T[], selectedId: string): T | null {
  if (!templates.length) return null;
  const matched = selectedId ? templates.find((row) => row.id === selectedId) : undefined;
  return matched ?? templates.find((row) => row.isDefault) ?? null;
}

/**
 * 규정 상세의 적용 양식(보기 설정 메뉴의 radio). 관리자·편집자는 고르면 저장하고, 열람자는 화면에서만 바꾼다.
 * 저장은 규정마다 한 번에 하나(같은 그리기 안에서 두 번 골라도) — 진행은 화면 밖 저장소에 둔 규정별 작업('template', useRuns)이라
 * 다른 규정에 들렀다 돌아와 화면을 새로 그려도 저장 중 표시와 막음이 이어진다(12차).
 *
 * @param serverValue 규정의 양식 id(없으면 ''), 규정을 아직 받지 않았으면 null
 */
export function useTemplateSelection(opts: {
  policyId: string | undefined;
  serverValue: string | null;
  canSave: boolean;
  save: (templateId: string) => Promise<void>;
  onError: (err: unknown) => void;
}) {
  const { policyId, serverValue, canSave, save, onError } = opts;
  const [state, dispatch] = useReducer(templateSelection, TEMPLATE_SELECTION_INITIAL);
  const { running, start, end, targetOf } = useRuns();

  useEffect(() => {
    if (serverValue !== null) dispatch({ type: 'server', policyId: policyId ?? '', value: serverValue });
  }, [policyId, serverValue]);

  const change = useCallback(
    async (templateId: string) => {
      const pid = policyId ?? '';
      if (!canSave) {
        dispatch({ type: 'pick', policyId: pid, id: templateId, save: false });
        return;
      }
      if (!start('template', pid, templateId)) return;
      dispatch({ type: 'pick', policyId: pid, id: templateId, save: true });
      try {
        await save(templateId);
        dispatch({ type: 'saved', policyId: pid });
      } catch (err) {
        dispatch({ type: 'failed', policyId: pid });
        onError(err);
      } finally {
        end('template', pid);
      }
    },
    [canSave, save, onError, start, end, policyId],
  );

  // 새로 그린 화면은 앞 화면이 시작한 저장을 상태(savingFor·selected)로 모른다 — 저장소의 진행과 보낸 양식으로 그린다(옛 양식에
  // '저장 중'을 붙이지 않게, 12차 #2). 저장이 끝나면 보낸 값이 빠지고 서버 값을 다시 받는다
  const saving = isSavingTemplate(state, policyId ?? '') || isRunning(running, 'template', policyId);
  const pending = saving ? targetOf('template', policyId) : undefined;
  return { selectedId: shownTemplateId(state, policyId, serverValue, pending), saving, change };
}
