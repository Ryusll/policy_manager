import { useLayoutEffect, useMemo, useState, type Dispatch, type SetStateAction } from 'react';
import type { QueryClient, QueryKey } from '@tanstack/react-query';

/*
 * 규정 상세 도구 줄의 상태 칸(T-215 9~12차, T-227 실패 색, T-224 ④ 낡음 표시). 끝난 작업의 실패는 남기고(오류 번호를 옮겨 적게),
 * 사용자의 다음 동작(진행 문구·잠깐 알림)이 바꾼다. 받기 실패를 알리는 줄(낡음 표시)은 그 조회들을 그 뒤에 받거나 그 작업이 성공하면
 * 걷힌다 — 다시 받기에 실패한 뒤 다시 저장해 성공하면 '새로 고침해 확인'이 남지 않게(C-116 ⑥).
 */

/**
 * 작업 이름 — 실패 줄은 같은 이름의 성공이 걷고, 진행 문구는 같은 이름의 결과가 걷는다(T-224). 열린 문자열이면 이름이 겹치거나 틀려도
 * 아무 말 없이 남의 줄을 걷거나 제 줄을 못 걷는다(재검토 #6) — 쓰는 이름을 여기에 모은다. 판 쓰기는 판마다(version:판 id), 편집기의
 * 검토 요청은 조문마다(review:조문 id — 새 초안은 누를 때 id 가 없다)
 */
export type ResultSource = 'info' | 'toggle' | 'publish' | 'pdf' | 'hwpx' | `addArticle:${string}` | `version:${string}` | `review:${string}` | `appendix:${string}` | `comment:${string}`;

/** 도구 줄 상태 한 줄 — 실패는 남기고(오류 번호를 옮겨 적게), 사용자의 다음 동작(진행 문구·잠깐 알림)이 바꾼다 */
export type ToolStatus = {
  /**
   * 진행 문구 등 사용자 동작 — 남긴 실패(낡음 표시 포함)를 바꾼다. source(진행의 주인, 예 'pdf')를 주면 그 이름의 결과(성공·실패)가 올
   * 때까지 진행 문구로 둔다 — 그 사이 끝난 다른 작업의 성공은 칸을 덮지 않고(holds), 다른 작업의 실패가 걷히면 진행 문구로 돌아간다(재검토 #3)
   */
  show: (message: string, source?: ResultSource) => void;
  /**
   * 남기는 실패(끝난 작업의 결과) — 앞 실패가 떠 있으면 덧붙인다(둘 다 남는다, 같은 글은 한 번만 보인다). source(작업 이름, 예 'info')를 주면
   * 같은 작업의 앞 실패 줄을 바꾸고(그 작업의 받기 실패 줄은 남긴다 — 재검토 #1), 그 작업이 뒤에 성공하면(settle) 그 줄들이 걷힌다(T-224 —
   * 저장 실패가 다시 저장해 성공한 뒤에도 남지 않게)
   */
  fail: (message: string, source?: ResultSource) => void;
  /** 사용자 동작의 실패 — 앞에 남은 실패를 바꾸고 남긴다(누를 때마다 길어지지 않게) */
  failNow: (message: string) => void;
  /**
   * 받기 실패를 알리는 남기는 실패(낡음 표시) — keys 는 받지 못한 조회. 그 뒤 그 조회를 모두 받으면(received) 이 줄만 걷힌다(남긴 다른
   * 실패는 둔다). keys 가 비면 fail 과 같다. source 를 주면 그 작업의 앞 줄(실패·낡음 표시)을 모두 이 줄로 바꾼다
   */
  failStale: (message: string, keys: readonly QueryKey[], source?: ResultSource) => void;
  /** 그 작업(source)이 성공했다 — 그 작업이 남긴 실패·낡음 표시 줄과 그 작업의 진행 문구를 걷는다(남긴 다른 실패는 둔다) */
  settle: (source: ResultSource) => void;
  /** 조회 하나를 받았다(받기 성공 알림, subscribeClearStale) — 그 조회를 기다리던 낡음 표시에서 빼고, 다 받은 줄은 걷는다 */
  received: (key: QueryKey) => void;
  /** 잠깐 보이는 알림(사용자 동작의 결과) */
  flash: (message: string, ms: number) => void;
  clear: () => void;
  /** 남긴 실패가 떠 있는가 */
  isSticky: () => boolean;
  /** 칸을 남긴 실패나 진행 문구가 쓰고 있는가 — 끝난 작업의 성공은 이때 칸을 덮지 않고 이름 붙은 알림으로 간다 */
  holds: () => boolean;
};

/** 도구 줄 상태 글의 종류 — 실패는 붉은 계열로 칠한다(T-227, C-116 ⑥: 전에는 실패 문구도 초록색이었다) */
export type ToolStatusKind = 'info' | 'error';

/** 조회 key 를 견주는 글 — 같은 조회면 같다(쿼리 캐시의 key 는 원시값 배열) */
export const queryKeyText = (key: QueryKey) => JSON.stringify(key);

/** 남긴 실패 한 줄 — 낡음 표시면 아직 받지 못한 조회(key 글)를, 작업 이름을 받았으면 그 이름(source)을 든다 */
type Fail = { message: string; pending?: Set<string>; source?: ResultSource };

/**
 * 도구 줄 상태(ToolStatus) — 남긴 실패인지를 상자에 같이 적는다(9차 검토: 같은 규정에서 PDF·한/글을 함께 돌리면 나중에 끝난 성공이
 * 앞의 실패를 덮고 지웠다). 상자는 useState 로 고정한 객체(그리는 중에 넘기는 함수가 닫아 두므로 ref 를 쓰지 않는다 — useShownPolicy 와
 * 같은 방식). 돌려주는 객체는 인자가 같으면 늘 같다. setKind 를 주면 글의 종류(실패·그 밖)를 함께 알린다 — 글은 문자열 그대로 두고 종류만
 * 따로(같은 글에서 종류만 바뀌어도 다시 그리게, T-227)
 */
export function useToolStatus(
  setMsg: Dispatch<SetStateAction<string>>,
  flash: (message: string, ms: number) => void,
  setKind?: (kind: ToolStatusKind) => void,
): ToolStatus {
  // fails — 남긴 실패 줄(덧붙인 차례). 글을 ' / ' 로 잘라 같은지 보면 서버 문구에 ' / ' 가 들면 어긋나 목록으로 둔다(12차 #5)
  const [box] = useState(() => ({ sticky: false, fails: [] as Fail[], progress: null as { message: string; source?: ResultSource } | null }));
  return useMemo(() => {
    const reset = () => {
      box.sticky = false;
      box.fails = [];
      box.progress = null;
      setKind?.('info');
    };
    // 남긴 실패를 그린다 — 같은 글은 한 번만(11차). 남은 줄이 없으면 진행 문구로 돌아가거나(아직 돌고 있다) 비운다
    const render = () => {
      if (box.fails.length === 0) {
        box.sticky = false;
        setKind?.('info');
        setMsg(box.progress?.message ?? '');
        return;
      }
      box.sticky = true;
      setKind?.('error');
      setMsg([...new Set(box.fails.map((f) => f.message))].join(' / '));
    };
    // 남긴 실패가 이미 떠 있으면 덧붙인다 — 나중 실패를 4초짜리 알림으로 보내면 그 까닭(오류 번호)이 사라졌다(10차). 줄마다 걷히는 까닭(작업
    // 이름·기다리는 조회)을 따로 들고 같은 글은 그릴 때 한 번만 보여, 같은 글의 다른 줄이 남아 있으면 한 줄이 걷혀도 그 글은 남는다(검토 #9).
    // 같은 작업(source)의 앞 줄은 새 줄로 바꾼다(다시 해 또 실패해도 줄이 늘지 않게) — 다만 보통 실패는 그 작업의 받기 실패 줄을 남긴다
    // (받기 실패 뒤 다시 저장하다 실패해도 화면이 낡았다는 안내가 사라지지 않게, 재검토 #1). 다른 작업의 실패가 칸을 차지하는 동안 진행
    // 문구는 가려졌다가 그 줄이 걷히면 돌아온다. 진행의 주인이 실패하면 진행은 끝난다 — 그 줄이 걷혀도 끝난 진행 문구가 되살아나지 않게
    // (재검토 3차 #1)
    const add = (f: Fail) => {
      if (f.source && box.progress?.source === f.source) box.progress = null;
      box.fails = [...(f.source ? box.fails.filter((x) => x.source !== f.source || (!f.pending && !!x.pending)) : box.fails), f];
      render();
    };
    return {
      show: (m: string, source?: ResultSource) => {
        reset();
        box.progress = { message: m, source };
        setMsg(m);
      },
      fail: (m: string, source?: ResultSource) => add({ message: m, source }),
      failNow: (m: string) => {
        box.fails = [{ message: m }];
        render();
      },
      failStale: (m: string, keys: readonly QueryKey[], source?: ResultSource) =>
        add({ message: m, pending: keys.length > 0 ? new Set(keys.map(queryKeyText)) : undefined, source }),
      settle: (source: ResultSource) => {
        const ended = box.progress?.source === source;
        if (ended) box.progress = null;
        const left = box.fails.filter((f) => f.source !== source);
        if (left.length === box.fails.length && !ended) return;
        box.fails = left;
        render();
      },
      received: (key: QueryKey) => {
        const k = queryKeyText(key);
        let touched = false;
        for (const f of box.fails) if (f.pending?.delete(k)) touched = true;
        if (!touched) return;
        const left = box.fails.filter((f) => !f.pending || f.pending.size > 0);
        if (left.length === box.fails.length) return;
        box.fails = left;
        render();
      },
      flash: (m: string, ms: number) => {
        reset();
        flash(m, ms);
      },
      clear: () => {
        reset();
        setMsg('');
      },
      isSticky: () => box.sticky,
      holds: () => box.sticky || box.progress !== null,
    };
  }, [box, setMsg, flash, setKind]);
}

/** 조회마다 마지막 받기 성공의 때(setQueryData 로 넣은 값은 빼고) — subscribeClearStale 이 적고 stillStale 이 읽는다(재검토 #7) */
const receivedAt = new WeakMap<QueryClient, Map<string, number>>();

/**
 * 조회 캐시의 받기 성공을 도구 줄 상태에 알린다(T-224 ④) — 낡음 표시가 기다리는 조회를 받으면 그 줄이 걷힌다. setQueryData 로 넣은 값
 * (manual)은 받기가 아니라서 빼고, key 는 정확히 같은 것만(규정 본문 ['policy', id] 을 받아야 걷히고 곁 조회의 성공으로는 걷히지 않게).
 * 받은 때도 적어 둔다 — 받기 실패를 알리기 직전 그 사이 이미 받았는지를 같은 판정으로 본다(stillStale)
 */
export function subscribeClearStale(qc: QueryClient, status: Pick<ToolStatus, 'received'>): () => void {
  return qc.getQueryCache().subscribe((event) => {
    // 캐시에서 빠진 조회(로그아웃의 캐시 비우기 포함)의 받은 때는 지운다 — 같은 key 로 새로 만든 조회가 앞 값을 물려받지 않게(재검토 3차 #4)
    if (event.type === 'removed') receivedAt.get(qc)?.delete(event.query.queryHash);
    if (event.type !== 'updated' || event.action.type !== 'success' || event.action.manual) return;
    let seen = receivedAt.get(qc);
    if (!seen) receivedAt.set(qc, (seen = new Map()));
    seen.set(event.query.queryHash, event.query.state.dataUpdatedAt);
    status.received(event.query.queryKey);
  });
}

/** 지금 떠 있는 화면의 도구 줄에 받기 성공을 잇는다 — 그린 직후(layout) 걸어, 다시 그린 화면이 낡음 표시를 받은 뒤 오는 성공을 놓치지 않게 */
export function useClearStaleOnReceive(qc: QueryClient, status: Pick<ToolStatus, 'received'>): void {
  useLayoutEffect(() => subscribeClearStale(qc, status), [qc, status]);
}

/**
 * 받기 실패를 알리기 직전 — 내 받기를 시작한 때(since) 뒤에 이미 받은 조회는 빼고 아직 낡은 것만 돌려준다. 다 받았으면 빈 배열(낡음으로
 * 달지 않는다 — 내 받기는 실패했어도 그 사이 다른 받기가 새 값을 그렸다). 받은 때는 구독이 적은 받기 성공만 본다 — setQueryData 로
 * 넣은 값은 받은 것으로 치지 않고, 적은 것이 없으면 낡은 쪽이다(구독은 규정 화면이 떠 있는 동안 건다). 때는 벽시계(dataUpdatedAt·
 * Date.now)라 그 사이 시계가 뒤로 맞춰지면 어긋날 수 있다(드묾 — T-224 남긴 것)
 */
export function stillStale(qc: QueryClient, keys: readonly QueryKey[], since: number): QueryKey[] {
  const seen = receivedAt.get(qc);
  // 같은 때(같은 밀리초)에 받은 값은 쓰기 전에 시작한 받기일 수 있어 낡은 쪽으로 본다
  return keys.filter((k) => {
    const hash = qc.getQueryCache().find({ queryKey: k, exact: true })?.queryHash;
    return !(hash && (seen?.get(hash) ?? 0) > since);
  });
}
