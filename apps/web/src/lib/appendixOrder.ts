/** 부칙·별표·서식을 보여 주는 차례 — 종류(부칙 → 별표 → 서식), 같은 종류 안에서는 정한 순서, 그다음 만든 순 */
const KIND_ORDER = ['supplementary', 'annex', 'form'];

export function sortAppendices<T extends { kind?: string | null; sortOrder?: number | null; createdAt?: string | Date | null }>(
  raw: readonly T[] | null | undefined,
): T[] {
  const rank = (k?: string | null) => {
    const i = KIND_ORDER.indexOf(String(k));
    return i === -1 ? 99 : i;
  };
  return [...(raw ?? [])].sort((a, b) => {
    const rk = rank(a.kind) - rank(b.kind);
    if (rk !== 0) return rk;
    const so = (a.sortOrder ?? 0) - (b.sortOrder ?? 0);
    if (so !== 0) return so;
    return new Date(a.createdAt ?? 0).getTime() - new Date(b.createdAt ?? 0).getTime();
  });
}
