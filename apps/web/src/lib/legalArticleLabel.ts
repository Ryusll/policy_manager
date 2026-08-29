/** 법령형 조·항·목 표기 (조: 제N조, 항: ①②…, 목: 1. 2. …) */

const CIRCLED_DIGITS = [
  '①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨', '⑩',
  '⑪', '⑫', '⑬', '⑭', '⑮', '⑯', '⑰', '⑱', '⑲', '⑳',
] as const;

export function formatArticleJo(n: number): string {
  const num = Math.max(1, Math.floor(Number(n) || 1));
  return `제${num}조`;
}

export function formatClauseHang(n: number): string {
  const num = Math.max(1, Math.floor(Number(n) || 1));
  if (num <= CIRCLED_DIGITS.length) return CIRCLED_DIGITS[num - 1];
  return `(${num})`;
}

export function formatItemMok(n: number): string {
  const num = Math.max(1, Math.floor(Number(n) || 1));
  return `${num}.`;
}

export type ArticleLabelParts = {
  number: number;
  clauseNumber?: number | null;
  itemNumber?: number | null;
};

/** 조 본문 행(항·목이 아닌 루트) */
export function isArticleJoRoot(article: ArticleLabelParts): boolean {
  return article.clauseNumber == null && article.itemNumber == null;
}

/** 목차 정렬: 같은 조 → 본문 → 항 → 목 */
export function sortArticlesForToc<T extends ArticleLabelParts>(a: T, b: T): number {
  const an = Number(a.number ?? 0);
  const bn = Number(b.number ?? 0);
  if (an !== bn) return an - bn;
  const ac = a.clauseNumber == null ? -1 : Number(a.clauseNumber);
  const bc = b.clauseNumber == null ? -1 : Number(b.clauseNumber);
  if (ac !== bc) return ac - bc;
  const ai = a.itemNumber == null ? -1 : Number(a.itemNumber);
  const bi = b.itemNumber == null ? -1 : Number(b.itemNumber);
  return ai - bi;
}

export type ArticleHangGroup<T extends ArticleLabelParts = ArticleLabelParts> = {
  clauseNumber: number;
  hang: T | null;
  items: T[];
};

export type ArticleJoGroup<T extends ArticleLabelParts = ArticleLabelParts> = {
  jo: number;
  main: T | null;
  hangs: ArticleHangGroup<T>[];
  /** 항 없이 조에만 달린 목 */
  orphanItems: T[];
};

/** 같은 조 번호 안: ① 항 아래 1. 목 중첩 */
export function nestJoSubRows<T extends ArticleLabelParts>(children: T[]): {
  hangs: ArticleHangGroup<T>[];
  orphanItems: T[];
} {
  const hangs: ArticleHangGroup<T>[] = [];
  const hangIndex = new Map<number, number>();
  const orphanItems: T[] = [];

  for (const a of children) {
    if (a.itemNumber != null) {
      const cn = a.clauseNumber != null ? Number(a.clauseNumber) : null;
      if (cn != null && hangIndex.has(cn)) {
        hangs[hangIndex.get(cn)!].items.push(a);
      } else if (hangs.length > 0) {
        hangs[hangs.length - 1].items.push(a);
      } else {
        orphanItems.push(a);
      }
    } else if (a.clauseNumber != null) {
      const cn = Number(a.clauseNumber);
      if (hangIndex.has(cn)) {
        hangs[hangIndex.get(cn)!].hang = a;
      } else {
        const idx = hangs.length;
        hangs.push({ clauseNumber: cn, hang: a, items: [] });
        hangIndex.set(cn, idx);
      }
    }
  }
  return { hangs, orphanItems };
}

/** 장 아래 목차: 제N조 → ① 항 → 1. 목 */
export function groupArticlesByJo<T extends ArticleLabelParts>(articles: T[]): ArticleJoGroup<T>[] {
  const sorted = [...articles].sort(sortArticlesForToc);
  const map = new Map<number, ArticleJoGroup<T>>();
  const subs = new Map<number, T[]>();

  for (const a of sorted) {
    const n = Number(a.number ?? 0);
    if (!map.has(n)) {
      map.set(n, { jo: n, main: null, hangs: [], orphanItems: [] });
      subs.set(n, []);
    }
    if (isArticleJoRoot(a)) map.get(n)!.main = a;
    else subs.get(n)!.push(a);
  }

  for (const g of map.values()) {
    const nested = nestJoSubRows(subs.get(g.jo) || []);
    g.hangs = nested.hangs;
    g.orphanItems = nested.orphanItems;
  }

  return Array.from(map.values()).sort((a, b) => a.jo - b.jo);
}

/** 조 그룹의 모든 행(평탄) */
export function flattenJoGroup<T extends ArticleLabelParts>(g: ArticleJoGroup<T>): T[] {
  const out: T[] = [];
  if (g.main) out.push(g.main);
  for (const h of g.hangs) {
    if (h.hang) out.push(h.hang);
    out.push(...h.items);
  }
  out.push(...g.orphanItems);
  return out;
}

export function countDistinctJo(articles: ArticleLabelParts[]): number {
  if (!articles.length) return 0;
  return new Set(articles.map((a) => Number(a.number ?? 0))).size;
}

/** 목차·편집 화면용 짧은 라벨 */
export function articleShortLabel(article: ArticleLabelParts): string {
  if (article.itemNumber != null) return formatItemMok(article.itemNumber);
  if (article.clauseNumber != null) return formatClauseHang(article.clauseNumber);
  return formatArticleJo(article.number);
}

/** 조 제목과 함께 쓸 때 (예: 제1조 목적) */
export function articleDisplayLabel(article: ArticleLabelParts & { title?: string }): string {
  const base = articleShortLabel(article);
  const t = String(article.title ?? '').trim();
  if (article.clauseNumber != null || article.itemNumber != null) {
    return t ? `${base} ${t}` : base;
  }
  return t ? `${base} (${t})` : base;
}

/**
 * 장 머리글을 감출지 — **이 판단의 유일한 정의**(T-84).
 *
 * `Article.chapterId` 가 필수라 "장 없는 규정"은 숨김 장이라는 관례로 표현된다
 * (ADR-0011). 관례를 아는 곳이 여럿이면 그중 하나는 반드시 어긋난다 —
 * 실제로 읽어주기(`speech.ts`)는 제목이 빈 장도 감췄는데 화면·인쇄는 감추지
 * 않았고, 텍스트 내보내기는 아예 확인하지 않아 `===== 제1장  =====` 를 찍었다.
 *
 * 제목이 빈 장까지 감추는 쪽을 택한 이유: 서버가 "보이는 장은 제목이 있어야
 * 한다"를 강제하므로(`chapter-header.ts`) 제목 없는 보이는 장은 **있어서는 안
 * 되는 상태**다. 그런 데이터가 남아 있다면 "제1장" 뒤에 아무것도 없는 줄을
 * 그리는 것보다 감추는 편이 낫다.
 */
export function isChapterHeaderHidden(chapter: { suppressHeader?: boolean; title?: string | null }): boolean {
  if (chapter.suppressHeader) return true;
  return !String(chapter.title ?? '').trim();
}

export function formatKoDate(iso?: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleDateString('ko-KR');
}
