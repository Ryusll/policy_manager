/**
 * 인쇄 창(`.printable-policy-modal`)이 열린 동안 body 에 `policy-print-open` 을 붙인다(T-133).
 * 인쇄 때 앱 화면은 통째로 빼고 인쇄 창만 흐름대로 찍는다(index.css). 전문 보기·신구조문대비표가 함께 쓰므로 센다 —
 * 하나를 닫을 때 다른 창이 열려 있으면 표시를 남긴다.
 */
let holders = 0;

export function holdPrintRoot(): () => void {
  holders += 1;
  document.body.classList.add('policy-print-open');
  let released = false;
  return () => {
    if (released) return;
    released = true;
    holders = Math.max(0, holders - 1);
    if (holders === 0) document.body.classList.remove('policy-print-open');
  };
}
