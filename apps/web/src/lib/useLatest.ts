import { useLayoutEffect, useState } from 'react';

/**
 * 가장 최근 값을 담은 상자 — 클릭으로 시작한 비동기 작업이 끝났을 때 '그 창이 아직 그 규정의 것인가' 같은 지금 상태를 본다(T-215).
 * ref 로 두면 그 작업 함수를 그리기 중에 넘기는 자리(메뉴 항목)가 '렌더 중 ref 접근' 검사에 걸려 useState 로 고정한 객체에 둔다
 * (useShownPolicy·useFlashMessage 와 같은 방식). 값은 그린 직후(useLayoutEffect — 그리기와 같은 동기 구간)에 바뀐다 — 그 사이에
 * 끝난 응답이 옛 값을 보지 않게. 그리는 중에는 읽지 않는다.
 */
export function useLatest<T>(value: T): { readonly current: T } {
  const [box] = useState(() => ({ current: value }));
  useLayoutEffect(() => {
    box.current = value;
  });
  return box;
}
