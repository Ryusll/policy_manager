import { focusManager, onlineManager, type QueryClient } from '@tanstack/react-query';
import { policiesApi } from '../api/policies';
import { currentAuthEpoch } from './authScope';

/** 다시 받은 규정 — 순서 판정에 쓰는 장만 본다 */
export type PolicyData = { chapters?: unknown[] };

/**
 * 지금 인증 주체에 묶는 표(T-181). 로그아웃·다른 사용자 로그인 뒤에는 거짓 — 그 뒤에 끝난 작업의 결과는 알리지 않는다. 화면 알림
 * 저장소는 주체가 바뀔 때 비우므로(lib/sessionReset), 그 뒤에 띄운 알림에는 앞 사람의 규정 이름이 다음 화면에 남는다(T-215 16차).
 */
export function authScopeGuard(): () => boolean {
  const epoch = currentAuthEpoch();
  return () => currentAuthEpoch() === epoch;
}

/**
 * 끊겨 다시 잇는 횟수 상한(follow) — 겹침은 거의 둘·셋이다. 그보다 많으면 받지 못한 것으로 끝낸다(누가 끝없이 다시 받기를 걸어도
 * 진행이 풀리게). fetchPolicyNow 는 받기 함수의 약속을 넘겨 첫 끊김을 TanStack 이 이어 주므로 여섯 번 끊겨도 따라가고 일곱째에,
 * refetchReceived 는 받기의 약속(query.promise)을 바로 따라가므로 다섯 번까지 따라가고 여섯째에 그만둔다
 */
const CHASE_LIMIT = 5;

type Waited = 'done' | 'failed' | 'paused';
/** 지켜보는 조회 — 받기 상태와 지금 받기의 약속만 본다(데이터 형식을 묻지 않게) */
type Watched = {
  readonly state: { readonly fetchStatus: string; readonly fetchFailureCount: number; readonly data?: unknown };
  readonly promise?: Promise<unknown>;
};

/**
 * 이 조회의 받기가 멈췄는가. TanStack 받기는 시작할 때 오프라인이거나(networkMode online — 앱 기본값), 실패 뒤 재시도를 앞두고
 * 오프라인·탭 가림일 때만 멈추고, 온라인이면서 탭이 보여야 다시 이어진다(query-core retryer.js canStart·canContinue). 그래서
 * 온라인인데 아직 실패하지 않은 받기의 멈춤 표시는 끊긴 옛 받기가 재시도 대기 끝에 낸 것이다 — 끊긴 받기도 대기 사슬은 돌아 탭이
 * 가려져 있으면 조회에 멈춤을 알리고, 그 표시는 지금 받기가 끝날 때까지 남는다. 그때 지금 받기는 그대로 돈다(T-227 검토 #2). 판정은
 * 기다리기 시작할 때와 이 조회의 멈춤 알림 때만 한다(settleOrPause) — 남은 표시가 있는 채 지금 받기가 한 번 실패해도 그 실패
 * 알림으로는 다시 보지 않고, 재시도 앞에서 정말 멈추면 그때 멈춤 알림이 온다(재검토·마지막 검토). 기다리기를 시작하는 때는 늘 새 받기
 * 직후라 실패 횟수가 0이다 — 받던 받기를 끊고 시작해도 'fetch' 알림이 실패 횟수를 0으로 되돌린다(query.js 261 — fetchMeta null 과
 * 넘기는 meta undefined 가 달라 늘 보낸다, 5.101.4). 남는 한계: 옛 받기의 멈춤 알림이 지금 받기의 첫 재시도 대기 중(실패 1회)에
 * 탭이 가려진 채 오면 멈춤으로 보아 그 대기만큼 일찍 받지 못한 것으로 끝낸다 — 그 사이 탭이 다시 보이면 지금 받기는 이어 받는다
 */
function isPaused(query: Watched): boolean {
  const { fetchStatus, fetchFailureCount } = query.state;
  return fetchStatus === 'paused' && (!onlineManager.isOnline() || fetchFailureCount > 0);
}

/**
 * 값 없는 첫 받기가 멈췄는가 — 값이 없는 조회의 받기는 다른 받기에 끊기지 않고 합류만 시키므로 끊긴 옛 받기의 표시가 생기지 않는다.
 * 그래서 멈춤 표시가 있고 이어질 수 없는 때(오프라인이거나 탭 가림)면 멈춤으로 본다. 오프라인에서 멈춘 뒤 탭이 가려진 채 다시
 * 연결되면 실패 횟수 0·온라인인데도 탭이 돌아올 때까지 멈춰 있다(재검토)
 */
function isFirstFetchPaused(query: Watched): boolean {
  return query.state.fetchStatus === 'paused' && (!onlineManager.isOnline() || !focusManager.isFocused());
}

/**
 * 받기 약속이 끝나거나(성공 done·실패나 끊김 failed) 그 조회가 멈출 때까지(paused) 기다린다. 멈춤은 캐시 알림으로 안다 — 기다리는 사이
 * 이어진 받기가 멈춰도 진행이 다시 연결될 때까지 붙잡히지 않게(T-227). 약속의 결과는 먼저 받아 둔다 — 멈춤으로 끝낸 뒤에 오는 거절도
 * 받아 받지 않은 거절이 남지 않게(검토 #1). 멈춤은 이 조회의 멈춤 알림(pause) 때만 판정한다 — 받기는 시작할 때든 재시도 앞에서든
 * 멈추면 늘 pause 를 낸다(retryer.js pause → onPause). 화면이 다시 그려질 때마다 오는 옵션·무효화 알림이나 다른 조회의 알림, 실패
 * 횟수만 바꾸는 알림에서 다시 보면 이어진 받기의 다음 요청이 도는 사이 탭만 가려져도 남은 옛 표시를 멈춤으로 볼 수 있다(마지막 검토 #2,
 * 다시 검토 #1). 두 번 끝나도 해가 없다(약속은 처음 값으로 남고, 구독 끊기는 여러 번 불러도 된다)
 */
function settleOrPause(qc: QueryClient, query: Watched, promise: Promise<unknown>, paused: (q: Watched) => boolean = isPaused): Promise<Waited> {
  return new Promise((resolve) => {
    let unsubscribe = () => {};
    const finish = (how: Waited) => {
      unsubscribe();
      resolve(how);
    };
    promise.then(
      () => finish('done'),
      () => finish('failed'),
    );
    if (paused(query)) {
      finish('paused');
      return;
    }
    unsubscribe = qc.getQueryCache().subscribe((event) => {
      if (event.type !== 'updated' || (event.query as Watched) !== query) return;
      if (event.action.type === 'pause' && paused(query)) finish('paused');
    });
  });
}

/**
 * 받기를 끝날 때까지 따라간다(T-227) — 다른 다시 받기에 끊기면(실패로 끝났는데 아직 받는 중) 지금 받는 것(query.promise)에 다시 잇는다.
 * 끊긴 받기의 약속은 한 번만 이어지므로(이어진 받기마저 끊기면 거절된다) 직접 다시 잇는다. CHASE_LIMIT 번까지 — 넘으면 그대로 끝내고
 * 부른 쪽이 받지 못한 것으로 본다(값이 바뀌지 않았다). 성공으로 끝났으면 그 뒤에 시작한 받기는 기다리지 않는다. 로그아웃으로 지워진
 * 조회는 받는 중으로 남아 같은 거절을 상한까지 다시 볼 뿐이다
 */
async function follow(qc: QueryClient, query: Watched, promise: Promise<unknown>): Promise<Waited> {
  let waiting = promise;
  for (let i = 0; ; i++) {
    const how = await settleOrPause(qc, query, waiting);
    const next = query.state.fetchStatus === 'fetching' ? query.promise : undefined;
    if (how !== 'failed' || !next || i >= CHASE_LIMIT) return how;
    waiting = next;
  }
}

/**
 * 값 없이 받는 중인 첫 받기(캐시를 비운 뒤 다시 그린 화면 — 저장·올리기 전에 보냈을 수 있다)를 끊지도 합류하지도 않고 끝나기를
 * 기다린다(21차, T-227). 끊으면 그 받기를 기다리던 다른 작업이 받지 못한 것으로 끝나고, 합류하면 부르기 전에 보낸 받기의 값을 받은
 * 것으로 본다. 'paused' 면 멈춰 있다 — 합류하면 화면이 내려가며 TanStack 이 거둔 재시도를 되살리므로(continueRetry, 검토 #4) 기다리지
 * 않는다. 그런 받기가 없으면 undefined(기다리지 않는다 — 바로 다시 받기를 시작해 겹친 다시 받기의 차례를 바꾸지 않게). 기다린 뒤에
 * 받는 중인 받기는 부른 뒤에 시작했으므로 합류해도 된다(값이 없으면 TanStack 이 합류시킨다)
 */
function waitFirstFetch(qc: QueryClient, query: Watched): Promise<Waited> | undefined {
  const first = query.state.data === undefined && query.state.fetchStatus !== 'idle' ? query.promise : undefined;
  return first ? settleOrPause(qc, query, first, isFirstFetchPaused) : undefined;
}

/**
 * 조회를 무효화해 다시 받고 받았는지 알려 준다(T-227 — 첨부 목록처럼 값은 돌려받지 않고 받았는지만 보는 곳). fetchPolicyNow 와 같은
 * 규칙이다: 값 없이 받는 중이면 먼저 그 받기가 끝나기를 기다리고(waitFirstFetch, 마지막 검토 #1), 무효화가 시작한 받기를 끊겨도
 * 따라가며(follow — 무효화 약속은 끊기면 한 번만 이어지고 그 뒤 끊김은 삼켜 받은 것처럼 끝난다, 다시 검토 #3), 부른 뒤 값이 바뀌었을
 * 때만 받은 것이다(오류·멈춤·상한은 받지 못함). 보는 화면이 없으면(처음부터, 또는 기다리는 사이 그 규정을 떠났으면) 받은 것으로
 * 본다 — 다음에 보는 화면이 다시 받는다(무효로 표시해 두거나, 값이 없으면 붙을 때 받는다). 남은 멈춤·오류는 이번 일이 아니다(다시
 * 검토 #2)
 */
export async function refetchReceived(qc: QueryClient, queryKey: readonly unknown[]): Promise<boolean> {
  const find = () => qc.getQueryCache().find({ queryKey, exact: true });
  const watched = () => find()?.isActive() === true;
  const seen = find();
  const first = seen?.isActive() ? waitFirstFetch(qc, seen) : undefined;
  // 기다리는 사이 그 규정을 떠났으면 받은 것으로 본다 — 값이 없어 다음에 보는 화면이 붙을 때 받는다
  if (first && (await first) === 'paused') return !watched();
  const before = find()?.state.dataUpdateCount ?? 0;
  const refetch = qc.invalidateQueries({ queryKey });
  const query = find();
  if (!query?.isActive()) return refetch.then(() => true);
  await follow(qc, query, query.promise ?? refetch); // 멈추거나 오류·상한으로 끝나면 값이 바뀌지 않았다
  // 받는 사이 떠났으면 받은 것으로 본다 — 무효로 표시돼 있어(오류·멈춤도 그대로) 다음에 보는 화면이 다시 받는다(마지막 다시 검토 #2)
  return query.state.dataUpdateCount > before || !watched();
}

/**
 * 시작한 규정의 본문을 지금 다시 받는다(T-215 15~23차, T-227). 저장·전환·시행·순서 저장이 끝난 뒤 진행을 풀기 전에 부른다. 저장 뒤에
 * 시작한 받기의 결과만 돌려준다 — 받지 못했으면 null.
 *
 * 캐시에 손으로 값을 넣지 않고 TanStack 의 다시 받기 하나로 한다(16~20차에 따로 받아 넣는 길을 고칠 때마다 겹친 받기에서 옛 값이
 * 이기는 순서가 새로 나왔다 — query-core 5.101.4 query.js 183-196 받기 시작·끊기, 309-311 조용히 끊긴 받기가 새 받기로 이어짐,
 * 312-316 되돌려 끊긴 받기):
 * - 본 조회를 지금 다시 받는다. 진행 중인 받기(저장 전에 시작했을 수 있다)는 조용히 끊고 새로 시작하며(cancelRefetch), 끊긴 받기를
 *   시작한 쪽(무효화로 다시 받던 화면 등)은 그 새 받기의 약속으로 이어진다. 이 받기가 뒤에 다른 다시 받기에 끊기면 지금 받는 것에
 *   다시 이어 기다린다(follow — 끊긴 받기의 약속은 한 번만 이어지므로 query.promise 로 다시 잇는다, T-227 — 여러 번 끊겨도 저장
 *   뒤 받기의 값으로 끝난다). 나중 받기는 모두 이 받기를 시작한 뒤에 시작했으므로 그 값은 저장 뒤 값이다
 * - 값이 없는 채 받는 중이면(캐시가 지워졌다 다시 그린 첫 받기 — 저장 전에 시작했을 수 있다) 끊지 않고 끝나기를 기다린 뒤 새로 받는다.
 *   끊으면 그 받기를 기다리던 쪽(다른 작업의 이 함수)이 받지 못한 것으로 끝났다(21차, T-227). 합류해 그 값을 쓰면 저장 전 값일 수
 *   있다. 기다린 뒤에 받는 중인 받기는 이 함수를 부른 뒤에 시작했으므로 합류해도 된다(값이 없으면 TanStack 이 합류시킨다)
 * - 성공으로 끝났고 이 받기를 시작한 뒤 값이 바뀌었을 때만 그 값을 돌려준다(실패면 TanStack 이 본 조회를 낡았다고 표시해 다음에 보는
 *   화면이 다시 받는다). 이 받기는 다시 시도하지 않는다. 이어진 받기는 그 받기를 시작한 쪽의 옵션으로 돈다 — 다른 작업의 이 함수면
 *   재시도 없음, 화면 조회면 앱 기본값(재시도 1번), 무효화면 그때 조회에 남은 옵션이다. 이 함수의 retry false 는 화면이 다시 그려
 *   되돌리기 전까지 본 조회에 남는다(21·22차 — 화면 동작은 같다)
 * - 받기가 멈추면(isPaused — 시작할 때 오프라인, 이어진 받기가 실패 뒤 재시도를 앞두고 오프라인·탭 가림. 값 없는 첫 받기는
 *   isFirstFetchPaused) 기다리지 않고 null — 받기는 다시 연결되거나 탭으로 돌아오면 이어져 화면이 새 본문을 그린다(T-227). 끊긴 옛
 *   받기가 남긴 멈춤 표시는 멈춤으로 보지 않는다(isPaused 주석). 값 없는 첫 받기가 멈췄으면 합류하지 않는다 —
 *   합류하면 화면이 내려가며 TanStack 이 거둔 재시도를 되살린다(continueRetry, 검토 #4). 요청 시간 상한은 두지 않았다 — API 가
 *   응답하지 않으면 앞단 nginx 가 요청마다 120초 뒤 504 로 끝내고, 연결이 조용히 끊기면 브라우저가 포기할 때까지 기다린다
 * - 끊겨 이어 기다리기는 CHASE_LIMIT 번까지(첫 끊김은 TanStack 이 이어 주므로 여섯 번 끊겨도 따라간다) — 넘으면 null. 성공으로
 *   끝났으면 그 뒤에 시작한 다시 받기는 기다리지 않는다
 * - 그 아래 조회(시행일 목록·시점 본문·비교 창)는 바로 다시 받게 하되 기다리지 않는다 — 느린 곁 조회가 진행을 붙잡지 않게
 * 인증 주체가 바뀌었으면 null(로그아웃은 캐시를 비우며 이 받기를 끊는다 — 그 뒤 결과는 알리지 않고, 다음 사용자로 다시 받지 않는다).
 */
export async function fetchPolicyNow(qc: QueryClient, id: string, inScope: () => boolean): Promise<PolicyData | null> {
  return (await fetchPolicyNowSince(qc, id, inScope)).fresh;
}

/**
 * fetchPolicyNow 와 같고, 이 함수의 받기를 시작한 때(since — 값 없이 받는 중인 첫 받기를 기다린 뒤, Date.now())를 함께 돌려준다(T-224).
 * 받기 실패를 알릴 때 그 뒤에 끝난 받기만 받은 것으로 보게 한다(stillStale — 저장 전에 보냈을 수 있는 첫 받기의 값은 받은 것으로 치지
 * 않는다. 이 받기는 그 전 받기를 끊고 시작하므로 since 뒤의 성공은 이 받기이거나 그 뒤에 시작한 받기다)
 */
export async function fetchPolicyNowSince(qc: QueryClient, id: string, inScope: () => boolean): Promise<{ fresh: PolicyData | null; since: number }> {
  let since = Date.now();
  // 그 사이 로그아웃·다른 사용자 로그인이 있었으면 받지 않는다(T-224 — 비운 캐시에 앞 규정을 다음 범위로 다시 만들어 받지 않게)
  if (!inScope()) return { fresh: null, since };
  const key = ['policy', id];
  void qc.invalidateQueries({ queryKey: key, predicate: (q) => q.queryKey.length > 2 });
  const options = qc.defaultQueryOptions({ queryKey: key, queryFn: () => policiesApi.get(id) as Promise<PolicyData>, retry: false });
  let query = qc.getQueryCache().build(qc, options);
  // 값 없이 받는 중이면 끝나기를 기다린다. 멈췄으면 합류하지 않고 null
  const first = waitFirstFetch(qc, query);
  if (first) {
    if ((await first) === 'paused' || !inScope()) return { fresh: null, since }; // 로그아웃했으면 다음 사용자로 받지 않는다
    query = qc.getQueryCache().build(qc, options); // 기다리는 사이 지워졌으면 새 조회(화면이 보는 캐시에 받게)
  }
  since = Date.now();
  const seen = query.state.dataUpdateCount;
  await follow(qc, query, query.fetch(options, { cancelRefetch: true }));
  if (!inScope()) return { fresh: null, since };
  const { status, dataUpdateCount, data } = query.state;
  return { fresh: status === 'success' && dataUpdateCount > seen && data !== undefined ? data : null, since };
}
