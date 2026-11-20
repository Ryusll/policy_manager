import { useCallback, useState, type Dispatch, type SetStateAction } from 'react';

/**
 * 잠깐 보인 알림을 지울 때가 됐는가(T-215, 규정 상세 도구 줄의 상태 영역) — 그사이 다른 알림(실패 문구 등)으로 바뀌었거나
 * 같은 알림을 다시 띄웠으면(뒤에 띄운 것이 제 시간을 갖는다) 지우지 않는다.
 *
 * @param current 지금 보이는 알림
 * @param flashed 이 타이머가 띄운 알림
 * @param latestSeq 가장 최근에 띄운 잠깐 알림의 번호
 * @param mySeq 이 타이머가 띄운 알림의 번호
 */
export function shouldClearFlash(current: string, flashed: string, latestSeq: number, mySeq: number): boolean {
  return latestSeq === mySeq && current === flashed;
}

/**
 * 알림을 띄우고 ms 뒤에 지운다(shouldClearFlash 가 허락할 때만). 띄운 번호는 그리기와 상관없어 닫힌 객체에 둔다 —
 * ref 로 두면 이 함수를 그리기 중에 넘기는 자리(메뉴 항목)가 '렌더 중 ref 접근' 검사에 걸린다. 돌려주는 함수는 늘 같다.
 */
export function useFlashMessage(setMessage: Dispatch<SetStateAction<string>>) {
  const [counter] = useState(() => ({ seq: 0 }));
  return useCallback(
    (msg: string, ms: number) => {
      const mine = ++counter.seq;
      setMessage(msg);
      setTimeout(() => {
        const latest = counter.seq;
        setMessage((m) => (shouldClearFlash(m, msg, latest, mine) ? '' : m));
      }, ms);
    },
    [counter, setMessage],
  );
}
