/**
 * 최근 검색어 (T-79).
 *
 * 서버에 두지 않고 브라우저에만 남긴다. 검색어는 "무엇을 찾고 있었는지"라 사람에 따라
 * 민감할 수 있고, 이 기능이 주는 편의는 그 기록을 서버에 쌓을 만큼 크지 않다.
 *
 * 키에 테넌트를 넣어 한 브라우저에서 회사를 옮겨 다녀도 섞이지 않게 한다.
 */

const MAX = 8;

export function historyKey(tenantId?: string | null): string {
  return `veda:search-history:${tenantId || 'anon'}`;
}

type Storage = Pick<globalThis.Storage, 'getItem' | 'setItem' | 'removeItem'>;

function safeStorage(): Storage | null {
  try {
    // 시크릿 모드·저장소 차단 환경에서 접근만 해도 예외가 난다
    return window.localStorage;
  } catch {
    return null;
  }
}

export function loadHistory(tenantId?: string | null, storage: Storage | null = safeStorage()): string[] {
  if (!storage) return [];
  try {
    const raw = storage.getItem(historyKey(tenantId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((x): x is string => typeof x === 'string' && !!x.trim()).slice(0, MAX);
  } catch {
    // 손상된 값이 남아 있어도 화면이 죽지 않아야 한다
    return [];
  }
}

/** 새 검색어를 맨 앞에 넣는다. 같은 말은 위로 끌어올리고 중복은 남기지 않는다. */
export function pushHistory(
  term: string,
  tenantId?: string | null,
  storage: Storage | null = safeStorage(),
): string[] {
  const value = (term || '').trim();
  if (!value || !storage) return loadHistory(tenantId, storage);
  const next = [value, ...loadHistory(tenantId, storage).filter((x) => x !== value)].slice(0, MAX);
  try {
    storage.setItem(historyKey(tenantId), JSON.stringify(next));
  } catch {
    /* 용량 초과 등은 무시한다 — 기록은 부가 기능이다 */
  }
  return next;
}

export function removeHistory(
  term: string,
  tenantId?: string | null,
  storage: Storage | null = safeStorage(),
): string[] {
  if (!storage) return [];
  const next = loadHistory(tenantId, storage).filter((x) => x !== term);
  try {
    storage.setItem(historyKey(tenantId), JSON.stringify(next));
  } catch {
    /* 무시 */
  }
  return next;
}

export function clearHistory(tenantId?: string | null, storage: Storage | null = safeStorage()): string[] {
  try {
    storage?.removeItem(historyKey(tenantId));
  } catch {
    /* 무시 */
  }
  return [];
}
