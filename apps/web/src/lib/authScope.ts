/**
 * 인증 주체(회사·사용자)의 구간 (T-181).
 *
 * 로그아웃·로그인은 화면 이동이라 메모리에 앞 사용자의 것이 남는다 — 화면 캐시, 아직 오지 않은
 * 응답, 진행 중인 토큰 갱신. 주체가 바뀔 때마다 구간 번호를 하나 올리고 그 구간의 요청을 모두
 * 끊어, 앞 주체의 응답·갱신·재시도가 다음 주체의 화면과 토큰을 건드리지 못하게 한다.
 */

export interface AuthIdentitySource {
  isAuthenticated: boolean;
  user: { id: string; tenantId: string } | null;
}

/** 같은 사람의 토큰 갱신·이름·역할 변경은 같은 주체다 — 회사와 사용자 id 만 본다 */
export function authIdentity(state: AuthIdentitySource): string | null {
  return state.isAuthenticated && state.user ? `${state.user.tenantId}:${state.user.id}` : null;
}

/**
 * 다른 탭이 이 탭을 거치지 않고 다른 사람으로 바꿨다(로그아웃과 로그인이 한 번에 들어옴).
 * 이 탭의 화면은 언마운트되지 않고 앞 사람의 화면 상태를 들고 있으므로 새로 연다.
 */
export function needsReloadOnIdentityChange(before: string | null, after: string | null): boolean {
  return before !== null && after !== null && before !== after;
}

let epoch = 0;
let controller = new AbortController();
/** 새로 여는 중인 구간 — 이 구간에서는 요청을 보내지도, 결과를 넘기지도 않는다 */
let closedEpoch = -1;

export function currentAuthEpoch(): number {
  return epoch;
}

/** 지금 구간의 요청에 붙일 신호 — 주체가 바뀌면 끊긴다 */
export function authScopeSignal(): AbortSignal {
  return controller.signal;
}

/** 주체가 바뀌었다 — 구간을 닫고(진행 중 요청을 끊고) 새 구간을 연다 */
export function endAuthScope(): void {
  epoch += 1;
  controller.abort();
  controller = new AbortController();
}

/**
 * 화면을 새로 열기로 했다(다른 탭이 바로 다른 사람이 됨) — 새로 열릴 때까지 이 탭은 아무 요청도
 * 끝내지 않는다. 그 사이 앞 사람의 화면이 보낸 요청이 토큰 갱신·`setUser` 로 저장소에 쓰면, 이미
 * 다른 사람이 든 저장소를 앞 사람으로 덮어 다른 탭까지 되돌린다.
 * 닫힌 구간은 다음 주체 변경(`endAuthScope`)이 다시 연다 — 실제로는 새로 열려 사라진다. 그래서 떠나기
 * 전 확인(`beforeunload`)으로 새로 열기를 막으면 이 탭은 아무 요청도 끝내지 못한다 — 붙이지 않는다.
 */
export function closeAuthScopeForReload(): void {
  endAuthScope();
  closedEpoch = epoch;
  controller.abort();
}

/** 지금 구간에서 요청을 주고받아도 되는가(새로 여는 중이 아닌가) */
export function authScopeOpen(): boolean {
  return epoch !== closedEpoch;
}

interface IdentityStore<S extends AuthIdentitySource> {
  getState: () => S;
  subscribe: (listener: (state: S) => void) => () => void;
}

/** 저장소의 주체가 바뀔 때마다 `onChange` 를 부른다(같은 주체의 변경은 부르지 않는다) */
export function watchAuthIdentity<S extends AuthIdentitySource>(
  store: IdentityStore<S>,
  onChange: (before: string | null, after: string | null) => void,
): () => void {
  let current = authIdentity(store.getState());
  return store.subscribe((state) => {
    const next = authIdentity(state);
    if (next === current) return;
    const before = current;
    current = next;
    onChange(before, next);
  });
}
