/**
 * 전문 보기(full view) 렌더 입력 구조.
 *
 * 장 → 조 그룹 → (조 루트 · 항 · 목) 행으로 정리한다.
 * `TemplateRenderer`(React)와 `buildEnterprisePolicyBodyHtml`(HTML 문자열)이
 * 같은 행 목록을 쓰도록 해서 두 경로의 출력이 어긋나지 않게 한다.
 */

import { groupArticlesByJo, flattenJoGroup } from './legalArticleLabel';

export type FullViewJoGroup = {
  articleNumber: number;
  main: any | null;
  hangs: { clauseNumber: number; hang: any | null; items: any[] }[];
  orphanItems: any[];
  /** 조 그룹의 모든 행(평탄) — 검색 집계용 */
  items: any[];
};

/** 0 = 조 루트, 1 = 항, 2 = 목 */
export type FullViewDepth = 0 | 1 | 2;

export type FullViewRenderRow = { article: any; depth: FullViewDepth };

function toJoGroups(articles: any[]): FullViewJoGroup[] {
  return groupArticlesByJo(articles || []).map((g) => ({
    articleNumber: g.jo,
    main: g.main,
    hangs: g.hangs,
    orphanItems: g.orphanItems,
    items: flattenJoGroup(g),
  }));
}

/**
 * 장 목록(policy.chapters)을 전문 보기 그룹으로 변환.
 *
 * 절(節)은 선택 계층이라 한 장 안에 "절에 속하지 않는 조"와 "절에 속한 조"가 공존한다.
 * 절 미소속 조를 먼저 두고, 이어서 절 단위 블록(`sectionBlocks`)을 번호순으로 싣는다.
 */
export function buildFullViewGroups(chapters: any[] | undefined | null): any[] {
  return (chapters || []).map((chapter: any) => {
    const articles: any[] = chapter.articles || [];
    const sections: any[] = [...(chapter.sections || [])].sort(
      (a, b) => (Number(a?.number) || 0) - (Number(b?.number) || 0),
    );

    const groups = toJoGroups(articles.filter((a) => !a?.sectionId));
    const sectionBlocks = sections.map((section: any) => ({
      id: section.id,
      number: section.number,
      title: section.title,
      groups: toJoGroups(articles.filter((a) => a?.sectionId === section.id)),
    }));

    return { ...chapter, groups, sectionBlocks };
  });
}

function depthOf(article: any): FullViewDepth {
  if (article?.itemNumber != null) return 2;
  if (article?.clauseNumber != null) return 1;
  return 0;
}

/**
 * 조 그룹을 화면에 그릴 행 목록으로 편다.
 *
 * `items`는 `main`·`hangs`·`orphanItems`를 모두 포함한 평탄 목록이라,
 * 구조 필드와 `items`를 각각 그리면 같은 행이 두 번 나온다(조 루트 중복 출력).
 * 여기서 이미 그린 행을 기억해 중복을 막고, 구조 필드 없이 `items`만 넘기는
 * 호출자도 그대로 동작하게 한다.
 */
export function joGroupRenderRows(group: any): FullViewRenderRow[] {
  const rows: FullViewRenderRow[] = [];
  const seen = new Set<unknown>();

  const push = (article: any, depth: FullViewDepth) => {
    if (!article) return;
    const key = article.id ?? article;
    if (seen.has(key)) return;
    seen.add(key);
    rows.push({ article, depth });
  };

  push(group?.main, 0);
  for (const hang of group?.hangs || []) {
    push(hang?.hang, 1);
    for (const item of hang?.items || []) push(item, 2);
  }
  // 상위 항이 없는 목은 기존 표기대로 항 위치에 그린다
  for (const item of group?.orphanItems || []) push(item, 1);
  for (const article of group?.items || []) push(article, depthOf(article));

  return rows;
}
