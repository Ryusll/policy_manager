import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { fullViewArticleSelector } from '../../lib/policyDetailLinks';

type Target = { id: string; selector: string; at: number };

/** 전문이 아직 그려지지 않았을 때 기다리는 프레임 수(약 0.5초) — 넘으면 그만둔다 */
export const SEEK_MAX_FRAMES = 30;

/**
 * 한 번 찾아 스크롤하기 — 다음 프레임마다 찾고, 찾으면 한 번 스크롤하고 끝, maxFrames 를 넘기면 스크롤 없이 끝(onEnd(false)).
 * 끝나면(찾았든 못 찾았든) 그 요청은 다시 하지 않는다 — 전체화면을 여닫아 찾을 영역이 바뀌어도 늦게 튀지 않게.
 * 프레임 함수를 받아 시험에서 손으로 돌린다. 돌려준 함수로 그만둔다(끝나지 않은 채 그만두면 onEnd 를 부르지 않는다).
 */
export function seekAndScroll(opts: {
  find: () => { scrollIntoView: (o: ScrollIntoViewOptions) => void } | null | undefined;
  requestFrame: (fn: () => void) => number;
  cancelFrame: (id: number) => void;
  onEnd: (found: boolean) => void;
  maxFrames?: number;
}): () => void {
  const max = opts.maxFrames ?? SEEK_MAX_FRAMES;
  let frames = 0;
  let id = 0;
  const step = () => {
    const el = opts.find();
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      opts.onEnd(true);
    } else if (++frames < max) {
      id = opts.requestFrame(step);
    } else {
      opts.onEnd(false);
    }
  };
  id = opts.requestFrame(step);
  return () => opts.cancelFrame(id);
}

/**
 * 전문 보기 안의 한 조로 스크롤한다(T-215, SRS POLICY-13 ①). 열람자는 분절 보기를 쓰지 않으므로 조문 선택·조문 링크·목차가
 * 분절 보기로 바꾸는 대신 이것을 부른다. 갈 조의 번호는 부르는 쪽이 지금 그려진 본문에서 찾아 넘긴다(lib/policyDetailLinks
 * resolveFullViewJump). 전문 보기로 막 바꾼 때처럼 묶음이 아직 없으면 몇 프레임 기다려 찾는다.
 *
 * @param rootRef 전문 보기 영역(전체화면이 열려 있으면 그 창의 영역)
 * @param onMissing 기다려도 그 조가 본문에 없을 때(시행 예정이라 본문에 없는 조 등) — 부르는 쪽이 알린다
 * @returns jump — 그 조로 스크롤(고른 조문은 부르는 쪽의 selectedArticle 이 갖는다 — 목차 강조·주소·조문 선택 칸이 한 값)
 */
export function useFullViewJump(rootRef: RefObject<HTMLElement | null>, onMissing?: () => void) {
  const [target, setTarget] = useState<Target | null>(null);
  const seq = useRef(0);
  const done = useRef(0);
  // 알림 함수는 그릴 때마다 새로 오므로 찾기를 다시 시작하지 않게 ref 로 둔다
  const missing = useRef(onMissing);
  useEffect(() => {
    missing.current = onMissing;
  });

  useEffect(() => {
    if (!target || target.at === done.current) return;
    return seekAndScroll({
      find: () => rootRef.current?.querySelector<HTMLElement>(target.selector),
      requestFrame: (fn) => requestAnimationFrame(fn),
      cancelFrame: (id) => cancelAnimationFrame(id),
      onEnd: (found) => {
        done.current = target.at;
        if (!found) missing.current?.();
      },
    });
  }, [target, rootRef]);

  const jump = useCallback((article: { id: string; number?: number | null; branchNumber?: number | null }) => {
    const selector = fullViewArticleSelector(article);
    if (selector) setTarget({ id: article.id, selector, at: ++seq.current });
  }, []);

  return { jump };
}
