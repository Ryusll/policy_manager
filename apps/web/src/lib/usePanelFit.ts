import { useLayoutEffect, type RefObject } from 'react';
import { panelShift } from './menuKeys';

/**
 * 펼친 패널이 화면 밖으로 나가지 않게 가로로 민다(좁은 화면에서 버튼이 오른쪽 끝 가까이 있을 때 등). 열 때와, 열린 채 창 크기가
 * 바뀌거나(화면 회전 포함) 패널 폭이 바뀔 때(진행 문구·글자 크기 항목 글) 다시 잰다. 미는 값은 폭을 바꾸지 않아 되먹임이 없다.
 * 공용 메뉴 버튼(DropdownMenu, T-214)과 상단 메뉴의 '관리' 묶음(NavDisclosure, T-226)이 같이 쓴다 — 미는 값은 lib/menuKeys 의 panelShift.
 */
export function usePanelFit(ref: RefObject<HTMLElement | null>, open: boolean): void {
  useLayoutEffect(() => {
    const el = ref.current;
    if (!open || !el) return;
    const fit = () => {
      el.style.transform = '';
      const r = el.getBoundingClientRect();
      const shift = panelShift(r.left, r.right, window.innerWidth);
      if (shift) el.style.transform = `translateX(${shift}px)`;
    };
    fit();
    window.addEventListener('resize', fit);
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(fit);
    observer?.observe(el);
    return () => {
      window.removeEventListener('resize', fit);
      observer?.disconnect();
    };
  }, [ref, open]);
}
