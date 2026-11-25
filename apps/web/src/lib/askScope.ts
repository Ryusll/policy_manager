/**
 * 질문 범위 고르기(T-219, SRS SEARCH-11) — 묻는 사람이 살펴볼 규정을 고른다. 고를 수 있는 것은 회사의 **활성 규정**뿐이다
 * (서버도 같은 기준으로 거절한다). 누가 어느 규정을 볼 수 있는지(규정별 열람 범위, D-21)를 정하는 것은 아니다.
 */
export interface ScopePolicy {
  id: string;
  code: string;
  title: string;
}

/** 한 번에 고를 수 있는 규정 수 — 서버 ASK_SCOPE_MAX 와 같다 */
export const ASK_SCOPE_MAX = 100;

/** 고르기 목록에 한 번에 그리는 수 — 더 많으면 이름·코드로 좁혀 달라고 한다 */
export const SCOPE_LIST_LIMIT = 200;

/** 규정 목록 응답에서 고를 수 있는 것만 — 활성 규정, 코드 순 */
export function scopeCandidates(list: unknown): ScopePolicy[] {
  if (!Array.isArray(list)) return [];
  return list
    .filter((p): p is { id: string; code: string; title: string; isActive: boolean } =>
      !!p && typeof p === 'object' && typeof (p as { id?: unknown }).id === 'string' && (p as { isActive?: unknown }).isActive === true,
    )
    .map((p) => ({ id: p.id, code: String(p.code ?? ''), title: String(p.title ?? '') }))
    .sort((a, b) => a.code.localeCompare(b.code, 'ko') || a.title.localeCompare(b.title, 'ko'));
}

const squash = (s: string) => s.toLowerCase().replace(/\s+/g, '');

/** 이름·코드로 거르기 — 대소문자와 띄어쓰기는 가리지 않는다 */
export function filterScopeCandidates(list: readonly ScopePolicy[], query: string): ScopePolicy[] {
  const q = squash(query);
  if (!q) return [...list];
  return list.filter((p) => squash(p.title).includes(q) || squash(p.code).includes(q));
}

/** 고른 규정 가운데 지금 고를 수 없는 것(비활성으로 바뀌었거나 지운 것)을 뺀다 — 차례는 그대로 */
export function pruneScope(selected: readonly string[], candidates: readonly ScopePolicy[]): string[] {
  const ok = new Set(candidates.map((p) => p.id));
  return selected.filter((id) => ok.has(id));
}

/** 고르기를 켜고 끈다 — 상한을 넘기려 하면 그대로 둔다 */
export function toggleScope(selected: readonly string[], id: string): string[] {
  if (selected.includes(id)) return selected.filter((x) => x !== id);
  if (selected.length >= ASK_SCOPE_MAX) return [...selected];
  return [...selected, id];
}
