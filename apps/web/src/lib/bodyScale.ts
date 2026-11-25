/**
 * 본문 글자 크기 조절 (T-75).
 *
 * 대조표 #17 "화면 확대/축소". 규정 본문은 조문 번호·항·목이 촘촘해서
 * 오래 읽으면 눈이 빨리 피로해진다. 브라우저 전체 확대(Ctrl +)와 달리
 * **본문만** 키워 목차·도구줄은 제자리에 둔다.
 *
 * 구현에 `zoom` 을 쓴다. 본문 서식은 사용자가 편집하는 템플릿 CSS 라
 * `px` 로 박힌 값이 섞여 있고(Enterprise 는 CSS 를 직접 쓴다), 부모
 * `font-size` 로는 그 값들이 따라오지 않는다. `transform: scale()` 은
 * 폭·스크롤을 어그러뜨린다. `zoom` 은 단위와 무관하게 자식 전체를 키우고
 * 레이아웃 폭도 같이 계산된다.
 *
 * **인쇄·PDF·HWPX 는 이 값의 영향을 받지 않는다.** 화면에서 키운 글씨가
 * 산출물 조판까지 바꾸면 "내가 본 것과 다른 문서"가 나온다. 인쇄는
 * `@media print` 에서 배율을 되돌리고, PDF·HWPX 는 서버가 자기 CSS 로 그린다.
 */

export const BODY_SCALE_STEPS = [90, 100, 110, 125, 150] as const;
export const DEFAULT_BODY_SCALE = 100;
export const BODY_SCALE_STORAGE_KEY = 'policy_manager_body_scale';

/** 저장된 값이 손상됐거나 예전 단계라도 화면이 깨지지 않게 가장 가까운 단계로 맞춘다 */
export function normalizeBodyScale(value: unknown): number {
  // `Number(null)` 과 `Number('')` 은 0 이다. 이걸 그냥 숫자로 받으면
  // "가장 가까운 단계"로 떨어져 저장된 적 없는 값이 90% 가 된다.
  // 배율은 0 이하일 수 없으므로 쓰레기 값과 함께 기본값으로 보낸다.
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_BODY_SCALE;
  if (BODY_SCALE_STEPS.includes(n as (typeof BODY_SCALE_STEPS)[number])) return n;
  return BODY_SCALE_STEPS.reduce((best, step) =>
    Math.abs(step - n) < Math.abs(best - n) ? step : best,
  );
}

/** `delta`(+1/-1)만큼 단계를 옮긴다. 양 끝에서는 더 가지 않는다. */
export function stepBodyScale(current: number, delta: number): number {
  const steps = BODY_SCALE_STEPS;
  const idx = steps.indexOf(normalizeBodyScale(current) as (typeof steps)[number]);
  const next = Math.min(steps.length - 1, Math.max(0, idx + delta));
  return steps[next];
}

export function canStepBodyScale(current: number, delta: number): boolean {
  return stepBodyScale(current, delta) !== normalizeBodyScale(current);
}

export function loadBodyScale(): number {
  try {
    return normalizeBodyScale(localStorage.getItem(BODY_SCALE_STORAGE_KEY));
  } catch {
    // 시크릿 창·저장소 차단 환경에서도 읽기는 실패할 수 있다
    return DEFAULT_BODY_SCALE;
  }
}

export function saveBodyScale(value: number): number {
  const scale = normalizeBodyScale(value);
  try {
    localStorage.setItem(BODY_SCALE_STORAGE_KEY, String(scale));
  } catch {
    /* 저장이 안 돼도 이번 세션 동안은 동작해야 한다 */
  }
  return scale;
}

/** 배율을 거는 컨테이너에 함께 붙일 클래스(`index.css` 가 인쇄 때 되돌린다) */
export const BODY_SCALE_CLASS = 'policy-body-scale';

/**
 * 본문 컨테이너에 걸 스타일. 기본 배율이면 아무것도 걸지 않는다.
 *
 * `zoom` 을 직접 인라인으로 주지 않고 CSS 변수로 넘기는 이유: 인쇄 루트가
 * 전문 보기 모달이라, 거기에 인라인 `zoom` 이 박히면 `@media print` 로
 * 되돌리기 어렵다. 변수로 두면 인쇄 규칙이 값을 덮어쓸 수 있다.
 */
export function bodyScaleStyle(scale: number): Record<string, string> {
  const value = normalizeBodyScale(scale);
  return value === DEFAULT_BODY_SCALE ? {} : { '--policy-body-scale': String(value / 100) };
}
