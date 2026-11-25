import { parseSnapshot, type StructureSnapshot } from '../common/article-structure';

/**
 * 시점 조회를 그때의 계층으로 조립한다 (T-110 ②, 특허 도 5·13 — PAT-04 최소안).
 *
 * 그날 고른 버전이 얼린 계층(`ArticleVersion.structure`)을 가지면 조문의 자리(조·가지·항·목)·제목과 장·절 묶음을 그 값으로 바꾼다.
 * 얼린 계층이 없으면 지금 조문 행의 값 그대로다(옛 기록·계층이 바뀐 적 없는 조문). 장 번호·제목은 그 장의 조문이 모두 얼린 계층이고
 * 장 값이 하나로 같을 때만 그때의 값으로 쓴다(장 번호·제목은 버전별로 남기지 않아서, 섞여 있으면 지금 값).
 */

type VersionLike = { status: string; structure?: unknown };
export type AsOfArticle = {
  id: string;
  chapterId: string;
  sectionId: string | null;
  number: number;
  branchNumber: number | null;
  clauseNumber: number | null;
  itemNumber: number | null;
  title: string | null;
  versions: VersionLike[];
};
type SectionLike = { id: string; number: number; title: string };
export type AsOfChapter<A extends AsOfArticle> = {
  id: string;
  number: number;
  title: string;
  suppressHeader: boolean;
  sections: SectionLike[];
  articles: A[];
};

/** 그날 고른 버전(시점 조회는 발행 이력만 고른다)의 얼린 계층 — 제안 계층은 `parseSnapshot` 이 버린다 */
export function frozenOf(article: { versions: VersionLike[] }): StructureSnapshot | null {
  const v = article.versions[0];
  return v ? parseSnapshot(v.structure) : null;
}

/** 얼린 계층이 있으면 그 자리·제목으로 바꾼 조문 */
export function placeArticle<A extends AsOfArticle>(a: A): A {
  const s = frozenOf(a);
  if (!s) return a;
  return {
    ...a,
    chapterId: s.chapter.id,
    sectionId: s.section?.id ?? null,
    number: s.number,
    branchNumber: s.branchNumber,
    clauseNumber: s.clauseNumber,
    itemNumber: s.itemNumber,
    title: s.title,
  };
}

const byPosition = (a: AsOfArticle, b: AsOfArticle) =>
  a.number - b.number ||
  (a.branchNumber ?? 0) - (b.branchNumber ?? 0) ||
  (a.clauseNumber ?? -1) - (b.clauseNumber ?? -1) ||
  (a.itemNumber ?? -1) - (b.itemNumber ?? -1);

export function placeAsOf<A extends AsOfArticle, C extends AsOfChapter<A>>(chapters: C[]): C[] {
  type Group = { chapter: C; articles: A[]; live: number; frozen: Map<string, { number: number; title: string; hidden: boolean }> };
  const groups = new Map<string, Group>();
  for (const ch of chapters) {
    groups.set(ch.id, { chapter: { ...ch, sections: [...ch.sections], articles: [] }, articles: [], live: 0, frozen: new Map() });
  }
  for (const ch of chapters) {
    for (const a of ch.articles) {
      const s = frozenOf(a);
      if (!s) {
        const g = groups.get(ch.id)!;
        g.articles.push(a);
        g.live += 1;
        continue;
      }
      let g = groups.get(s.chapter.id);
      if (!g) {
        // 그 뒤에 지워진 장 — 그때의 번호·제목으로 다시 세운다
        g = {
          chapter: { ...ch, id: s.chapter.id, number: s.chapter.number, title: s.chapter.title, suppressHeader: s.chapter.hidden, sections: [], articles: [] },
          articles: [],
          live: 0,
          frozen: new Map(),
        };
        groups.set(s.chapter.id, g);
      }
      if (s.section && !g.chapter.sections.some((x) => x.id === s.section!.id)) {
        g.chapter.sections.push({ id: s.section.id, number: s.section.number, title: s.section.title, chapterId: s.chapter.id } as SectionLike);
      }
      g.frozen.set(`${s.chapter.number}|${s.chapter.title}|${s.chapter.hidden ? 1 : 0}`, { number: s.chapter.number, title: s.chapter.title, hidden: s.chapter.hidden });
      g.articles.push(placeArticle(a));
    }
  }
  const out: C[] = [];
  for (const g of groups.values()) {
    const isVirtual = !chapters.some((c) => c.id === g.chapter.id);
    if (isVirtual && !g.articles.length) continue;
    let chapter = g.chapter;
    if (g.live === 0 && g.frozen.size === 1) {
      const [only] = [...g.frozen.values()];
      chapter = { ...chapter, number: only.number, title: only.title, suppressHeader: only.hidden };
    }
    out.push({ ...chapter, sections: [...chapter.sections].sort((a, b) => a.number - b.number), articles: [...g.articles].sort(byPosition) });
  }
  return out.sort((a, b) => a.number - b.number);
}
