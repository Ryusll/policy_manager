import type { QueryClient } from '@tanstack/react-query';
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
 * 시작한 규정의 본문을 지금 다시 받는다(T-215 15~20차). 저장·전환·시행·순서 저장이 끝난 뒤 진행을 풀기 전에 부른다. 저장 뒤에 시작한
 * 받기의 결과만 돌려준다 — 받지 못했으면 null.
 *
 * 캐시에 손으로 값을 넣지 않고 TanStack 의 다시 받기 하나로 한다(16~20차에 따로 받아 넣는 길을 고칠 때마다 겹친 받기에서 옛 값이
 * 이기는 순서가 새로 나왔다 — query-core 5.101.4 query.js 183-196 받기 시작·끊기, 309-311 조용히 끊긴 받기가 새 받기로 이어짐,
 * 312-316 되돌려 끊긴 받기):
 * - 본 조회를 지금 다시 받는다. 진행 중인 받기(저장 전에 시작했을 수 있다)는 조용히 끊고 새로 시작하며(cancelRefetch), 끊긴 받기를
 *   시작한 쪽(무효화로 다시 받던 화면 등)은 그 새 받기의 약속으로 이어진다. 이 받기가 뒤에 다른 다시 받기에 끊기면 그 받기로 한 번
 *   이어진다 — 이어진 받기마저 끊기면 더 따라가지 않고 null 이다(21차, 받기 한 번 사이에 따로 두 번 끊겨야 한다 — 곧 뒤 받기가 새 본문을
 *   그린다). 그래서 돌려주는 값은 늘 이 저장 뒤에 시작한 받기의 것이다
 * - 값이 없는 채 받는 중이면(캐시가 지워졌다 다시 그린 첫 받기 — 저장 전에 시작했을 수 있다) 끊고 새로 받는다. 합류하면 그 받기의 옛 값을
 *   받는다. 끊긴 쪽이 이 함수였으면 그쪽은 null 로 끝난다(21차, 값 없는 규정에서 두 작업이 겹칠 때)
 * - 성공으로 끝났고 이 받기를 시작한 뒤 값이 바뀌었을 때만 그 값을 돌려준다(실패면 TanStack 이 본 조회를 낡았다고 표시해 다음에 보는
 *   화면이 다시 받는다). 이 받기는 다시 시도하지 않는다. 이어진 받기는 그 받기를 시작한 쪽의 옵션으로 돈다 — 다른 작업의 이 함수면
 *   재시도 없음, 화면 조회면 앱 기본값(재시도 1번), 무효화면 그때 조회에 남은 옵션이다. 이 함수의 retry false 는 화면이 다시 그려
 *   되돌리기 전까지 본 조회에 남는다(21·22차 — 화면 동작은 같다)
 * - 시작할 때 오프라인이라 받기가 멈췄으면 기다리지 않고 null — 받기는 다시 연결되면 이어진다. 이어진 받기가 멈추면(오프라인에서
 *   시작했거나, 재시도를 앞두고 오프라인이거나 탭이 가려졌을 때) 다시 이어져 끝날 때까지 기다린다(21차 — 남긴 것). 요청 시간 상한은
 *   두지 않았다 — API 가 응답하지 않으면 앞단 nginx 가 120초 뒤 504 로 끝내고, 연결이 조용히 끊기면 브라우저가 포기할 때까지 기다린다
 * - 그 아래 조회(시행일 목록·시점 본문·비교 창)는 바로 다시 받게 하되 기다리지 않는다 — 느린 곁 조회가 진행을 붙잡지 않게
 * 인증 주체가 바뀌었으면 null(로그아웃은 캐시를 비우며 이 받기를 끊는다 — 그 뒤 결과는 알리지 않는다).
 */
export async function fetchPolicyNow(qc: QueryClient, id: string, inScope: () => boolean): Promise<PolicyData | null> {
  const key = ['policy', id];
  void qc.invalidateQueries({ queryKey: key, predicate: (q) => q.queryKey.length > 2 });
  const options = qc.defaultQueryOptions({ queryKey: key, queryFn: () => policiesApi.get(id) as Promise<PolicyData>, retry: false });
  const query = qc.getQueryCache().build(qc, options);
  if (query.state.data === undefined && query.state.fetchStatus !== 'idle') await query.cancel({ revert: true });
  const seen = query.state.dataUpdateCount;
  const fetching = query.fetch(options, { cancelRefetch: true }).catch(() => undefined);
  if (query.state.fetchStatus !== 'paused') await fetching;
  if (!inScope()) return null;
  const { status, dataUpdateCount, data } = query.state;
  return status === 'success' && dataUpdateCount > seen && data !== undefined ? data : null;
}
