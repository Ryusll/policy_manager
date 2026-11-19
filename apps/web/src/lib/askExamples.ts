/**
 * 규정 질문 처음 화면의 예시 질문(T-217, SRS SEARCH-9 ②).
 *
 * 직원용은 내 일에 관한 것(휴가·경조·출장), 담당자용은 규정을 살피는 것(연결된 법령과 비교, 보완할 곳)이다.
 * 열람자(직원)에게는 직원용만 보이고, 관리자·편집자에게는 담당자용을 먼저 보인다. 문장은 `messages.ts` 의 키다 —
 * 질문은 한국어로 받으므로 영어 화면에서도 예시 문장은 한국어 그대로 둔다.
 */
export type AskExampleGroup = 'manager' | 'staff';

export const ASK_EXAMPLE_KEYS: Record<AskExampleGroup, readonly string[]> = {
  manager: [1, 2, 3, 4, 5, 6].map((n) => `ask.example.manager.${n}`),
  staff: [1, 2, 3, 4, 5, 6].map((n) => `ask.example.staff.${n}`),
};

/** 한 번에 보이는 예시 수 */
export const ASK_EXAMPLES_PER_PAGE = 3;

/** 역할별로 보일 묶음 — 첫째가 처음 고른 묶음. 모르는 역할은 직원용만(권한이 적은 쪽으로) */
export function exampleGroupsFor(role: string | null | undefined): AskExampleGroup[] {
  return role === 'admin' || role === 'editor' ? ['manager', 'staff'] : ['staff'];
}

export function examplePageCount(total: number, perPage = ASK_EXAMPLES_PER_PAGE): number {
  return Math.max(1, Math.ceil(total / perPage));
}

/** 그 쪽의 예시 — 쪽 번호는 돌아간다(마지막 다음은 처음) */
export function examplePage<T>(items: readonly T[], page: number, perPage = ASK_EXAMPLES_PER_PAGE): T[] {
  const pages = examplePageCount(items.length, perPage);
  const p = ((page % pages) + pages) % pages;
  return items.slice(p * perPage, p * perPage + perPage);
}

/** '다른 예시 보기' — 다음 쪽(마지막이면 처음으로) */
export function nextExamplePage(page: number, total: number, perPage = ASK_EXAMPLES_PER_PAGE): number {
  return (page + 1) % examplePageCount(total, perPage);
}
