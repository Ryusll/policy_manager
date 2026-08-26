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
  main: any;
  hangs: { clauseNumber: number; hang: any; items: any[] }[];
  orphanItems: any[];
  /** 조 그룹의 모든 행(평탄) — 검색 집계용 */
  items: any[];
};

/** 0 = 조 루트, 1 = 항, 2 = 목 */
export type FullViewDepth = 0 | 1 | 2;

export type FullViewRenderRow = { article: any; depth: FullViewDepth };

/**
 * 장 본문을 이루는 블록. 절 미소속 조 묶음과 절 블록이 **조 번호 순서로** 번갈아 나온다.
 */
export type FullViewChapterBlock =
  | { kind: 'groups'; groups: FullViewJoGroup[] }
  | { kind: 'section'; id: string; number: number; title: string; groups: FullViewJoGroup[] };

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
 * **조 번호는 절 소속 여부와 무관하게 문서 전체에서 이어지므로**, 절 미소속 조를 전부 앞에
 * 몰아두면 제4조가 제1절의 제3조보다 먼저 나오는 역전이 생긴다. 그래서 조 번호 순으로
 * 훑으면서 소속 절이 바뀌는 지점에 절 블록을 연다.
 *
 * - `blocks`: 렌더 순서 그대로의 블록 목록 (화면·인쇄·PDF가 이걸 쓴다)
 * - `allGroups`: 절 소속 여부와 무관한 전체 조 그룹(조 번호 순) — 텍스트 내보내기·검색 집계용
 */
export function buildFullViewGroups(chapters: any[] | undefined | null): any[] {
  return (chapters || []).map((chapter: any) => {
    const articles: any[] = chapter.articles || [];
    const sectionById = new Map<string, any>();
    for (const section of chapter.sections || []) {
      if (section?.id) sectionById.set(String(section.id), section);
    }

    // 조 그룹 단위로 소속 절을 정한다(같은 조의 항·목은 조와 같은 절에 있다고 본다).
    const allGroups = toJoGroups(articles);
    const sectionIdOfGroup = new Map<number, string | null>();
    for (const group of allGroups) {
      const rows = joGroupRenderRows(group);
      const owner = rows.find((r) => r.article?.sectionId != null)?.article?.sectionId ?? null;
      sectionIdOfGroup.set(group.articleNumber, owner ? String(owner) : null);
    }

    const blocks: FullViewChapterBlock[] = [];
    for (const group of allGroups) {
      const sectionId = sectionIdOfGroup.get(group.articleNumber) ?? null;
      const last = blocks[blocks.length - 1];

      if (sectionId == null) {
        if (last?.kind === 'groups') last.groups.push(group);
        else blocks.push({ kind: 'groups', groups: [group] });
        continue;
      }

      if (last?.kind === 'section' && last.id === sectionId) {
        last.groups.push(group);
        continue;
      }
      const section = sectionById.get(sectionId);
      blocks.push({
        kind: 'section',
        id: sectionId,
        number: Number(section?.number) || 0,
        title: String(section?.title ?? ''),
        groups: [group],
      });
    }

    return { ...chapter, blocks, allGroups };
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

/**
 * 선택한 조 번호만 남긴다 (T-74 선택 조문 인쇄).
 *
 * 조 단위로만 거른다 — 항·목은 조에 딸린 것이라 따로 빼면 문맥이 끊긴다.
 * 조문이 하나도 안 남은 절·장 블록은 함께 지운다. 빈 장 제목만 인쇄되면
 * 무엇을 뽑은 건지 알아볼 수 없다.
 */
export function filterFullViewGroupsByJo(chapters: any[], selected: Set<number>): any[] {
  if (!selected.size) return chapters;
  const keep = (group: any) => selected.has(group.articleNumber);

  return (chapters || [])
    .map((chapter: any) => {
      const blocks = (chapter.blocks || [])
        .map((block: FullViewChapterBlock) => ({ ...block, groups: block.groups.filter(keep) }))
        .filter((block: FullViewChapterBlock) => block.groups.length > 0);
      return {
        ...chapter,
        blocks,
        allGroups: (chapter.allGroups || []).filter(keep),
      };
    })
    .filter((chapter: any) => chapter.blocks.length > 0);
}

/** 전문 보기 그룹에 들어 있는 조 번호 전부 (전체 선택용) */
export function collectJoNumbers(chapters: any[]): number[] {
  const out = new Set<number>();
  for (const chapter of chapters || []) {
    for (const group of chapter.allGroups || []) out.add(group.articleNumber);
  }
  return [...out].sort((a, b) => a - b);
}
