import { create } from 'zustand';

/**
 * 규정 상세에서 진행 중인 작업 — 내보내기(PDF·한/글)·초안 일괄 시행·시행 상태 전환·규정 정보 저장·적용 양식 저장(T-215), 첨부·조 순서,
 * 판 전환(T-224 — 종류는 lib/policyResult RunKind).
 * 이름은 `작업:규정 id`(lib/policyResult runKey)라 다른 규정의 작업은 서로 막지 않는다.
 *
 * 화면 밖 저장소에 두는 까닭(12차 검토): 규정 상세는 규정마다 새로 그린다(PolicyDetailView key). 진행 표시를 화면 상태에 두면 A 에서
 * 시작한 작업이 끝나기 전에 다른 규정에 들렀다 A 로 돌아왔을 때 표시가 사라져, 같은 작업을 또 시작할 수 있었다.
 * 시작 판정은 저장소의 지금 값(get)으로 한다 — 한 번 그리는 사이에 두 번 눌려도 겹치지 않는다(상태 값은 다음 그리기까지 옛 값이다).
 * 로그아웃·다른 사용자 로그인 때 비운다(lib/sessionReset — 끊긴 요청이 끝을 알리지 못해도 다음 사용자에게 남지 않게).
 */
type PolicyRunsState = {
  running: string[];
  /** 진행 중인 작업이 보낸 값(적용 양식 저장의 양식 id) — 새로 그린 화면이 무엇을 저장 중인지 그린다(12차 #2) */
  targets: Record<string, string>;
  /** 이 이름의 작업을 시작할 수 있으면 진행 중으로 두고 true, 이미 진행 중이면 false */
  start: (key: string, target?: string) => boolean;
  /** 끝났다(성공·실패 모두 — finally·onSettled 에서 부른다) */
  end: (key: string) => void;
  clear: () => void;
};

export const usePolicyRunsStore = create<PolicyRunsState>((set, get) => ({
  running: [],
  targets: {},
  start: (key, target) => {
    if (get().running.includes(key)) return false;
    set((s) => ({ running: [...s.running, key], targets: target === undefined ? s.targets : { ...s.targets, [key]: target } }));
    return true;
  },
  end: (key) =>
    set((s) => ({ running: s.running.filter((k) => k !== key), targets: Object.fromEntries(Object.entries(s.targets).filter(([k]) => k !== key)) })),
  clear: () => set({ running: [], targets: {} }),
}));
