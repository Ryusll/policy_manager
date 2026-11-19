/**
 * 규정 상세 왼쪽 목차의 글 — 한 줄 라벨, 목차 필터가 찾는 글, 필터 (T-211).
 * 조는 조 머리 표기(`제1조(목적)`, `articleHeading.ts`), 항·목은 번호와 부제.
 */

import {
  articleShortLabel,
  flattenJoGroup,
  groupArticlesByJo,
  isArticleJoRoot,
  sortArticlesForToc,
  type ArticleJoGroup,
  type ArticleLabelParts,
} from './legalArticleLabel';
import { formatArticleHeading } from './articleHeading';
import { hangRepeatsJoTitle, inferJoTitle } from './articleStructure';

export type TocRow = ArticleLabelParts & {
  title?: string | null;
  versions?: { content?: string | null }[];
  scheduledVersions?: { content?: string | null }[];
  pendingVersion?: { content?: string | null } | null;
};

/**
 * 목차 한 줄의 글 — 조 머리 행은 조 머리(`제1조(목적)` — 조 머리 행이 있으면 조 제목은 그 행의 제목이다, `inferJoTitle`),
 * 항·목은 번호와 부제. 항 부제가 없거나 조 제목(`joTitle`)을 되풀이할 뿐이면 본문 앞부분을 붙인다(번호 `②`만 보이면
 * 내용이 들어갔는지 알 수 없다).
 */
export function tocArticleLabel(article: TocRow, joTitle = ''): string {
  if (isArticleJoRoot(article)) return formatArticleHeading(article.number, article.branchNumber, article.title);
  const short = articleShortLabel(article);
  const title = hangRepeatsJoTitle(article, joTitle) ? '' : String(article.title ?? '').trim();
  if (title) return `${short} ${title}`;
  const bodyPreview = String(
    article.versions?.[0]?.content || article.scheduledVersions?.[0]?.content || article.pendingVersion?.content || '',
  )
    .replace(/\s+/g, ' ')
    .trim();
  return bodyPreview ? `${short} ${bodyPreview}` : short;
}

/**
 * 목차 필터가 찾는 글 — 번호·제목·오늘 시행 중인 본문(이 작업 전과 같다)에, 조 머리 행이면 목차에 보이는 조 머리
 * (`제1조(목적)`)를 더한다. 보이는 글을 그대로 넣어도, 예전 꼴(`제1조 목적`)로도 찾는다. 조 머리 행이 없는 조의 머리는
 * `filterTocGroups` 가 묶음 단위로 맞춰 본다.
 */
export function tocSearchText(article: TocRow): string {
  const heading = isArticleJoRoot(article) ? formatArticleHeading(article.number, article.branchNumber, article.title) : '';
  return [heading, articleShortLabel(article), String(article.title ?? ''), article.versions?.[0]?.content ?? '']
    .join(' ')
    .toLowerCase();
}

/** 목차의 조 묶음 — 묶음 머리에 적을 조 제목(`joTitle`, 거르기 전의 행으로 추정)을 함께 싣는다 */
export type TocGroup<T extends TocRow> = ArticleJoGroup<T> & { joTitle: string };

/**
 * 목차 필터 — 맞는 행만 남긴 조 묶음. 행 단위로 거르고(이 작업 전과 같다), 조 머리 행이 없는 조는 목차가 그 조의 머리
 * (`제1조(목적)` — 추정한 조 제목)를 따로 그리므로 그 머리 글이 맞으면 조를 통째로 남긴다(옛 데이터, T-211).
 * 조 제목은 `titleRows`(거르기 전의 행)로 추정한다 — 이미 한 번 걸러진 행을 다시 거를 때 걸러진 행으로 추정하면
 * 거를 때만 조 제목이 바뀐다. 목차는 이 묶음의 `joTitle` 하나만 쓴다.
 */
export function filterTocGroups<T extends TocRow>(articles: T[], query: string, titleRows: TocRow[] = articles): TocGroup<T>[] {
  const q = query.trim().toLowerCase();
  const out: TocGroup<T>[] = [];
  for (const g of groupArticlesByJo(articles)) {
    const joTitle = inferJoTitle(titleRows, g.jo, g.branch);
    if (!q || (!g.main && formatArticleHeading(g.jo, g.branch, joTitle).toLowerCase().includes(q))) {
      out.push({ ...g, joTitle });
      continue;
    }
    const matches = (article: T) => tocSearchText(article).includes(q);
    const kept: TocGroup<T> = {
      ...g,
      joTitle,
      hangs: g.hangs
        .map((h) => ({ ...h, items: h.items.filter(matches) }))
        .filter((h) => (h.hang && matches(h.hang)) || h.items.length > 0),
      orphanItems: g.orphanItems.filter(matches),
    };
    if ((g.main && matches(g.main)) || kept.hangs.length > 0 || kept.orphanItems.length > 0) out.push(kept);
  }
  return out;
}

/**
 * 목차에 그릴 장 목록 — 장마다 검색어에 맞는 행(`articles`)과, 조 제목을 추정할 장 전체의 거르기 전 행(`allArticles`)을 싣는다.
 * 장 제목이 맞으면 장을 통째로, 맞는 행이 없으면 장을 뺀다(이 작업 전과 같다). 목차 묶음은 `allArticles` 를 `titleRows` 로
 * 받아 조 제목을 추정한다 — 걸러 보거나 절로 나뉜 일부 행만 그려도 조 머리가 바뀌지 않게(T-211).
 */
export function filterTocChapters<T extends TocRow, C extends { title?: string | null; articles?: T[] }>(
  chapters: C[] | null | undefined,
  query: string,
): (C & { articles: T[]; allArticles: T[] })[] {
  const q = query.trim().toLowerCase();
  const out: (C & { articles: T[]; allArticles: T[] })[] = [];
  for (const chapter of chapters || []) {
    const sorted = [...(chapter.articles || [])].sort(sortArticlesForToc);
    if (!q || String(chapter.title ?? '').toLowerCase().includes(q)) {
      out.push({ ...chapter, articles: sorted, allArticles: sorted });
      continue;
    }
    const groups = filterTocGroups(sorted, q);
    if (groups.length) out.push({ ...chapter, articles: groups.flatMap((g) => flattenJoGroup(g)), allArticles: sorted });
  }
  return out;
}
