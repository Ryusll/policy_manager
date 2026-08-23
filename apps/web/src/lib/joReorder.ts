/**
 * 조 재정렬 화면이 쓰는 순수 계산 (T-60).
 *
 * 재정렬은 목차 안에서 바로 끌지 않고 별도 패널에서 한다. 목차는 검색으로 걸러지고
 * 장이 접히기도 해서, 거기서 끌면 **보이는 것만 가지고 순서를 정하게 된다** — 화면에
 * 없는 조가 어디로 갔는지 알 수 없는 채로 번호가 다시 매겨진다.
 */

export type JoRow = {
  /** 옮기기 전의 조 번호. 서버가 기존 행을 찾는 열쇠다 */
  jo: number;
  chapterId: string;
  chapterNumber: number;
  chapterTitle: string;
  /** 장 제목을 숨기는 장(가져오기가 만드는 단일 장) */
  chapterHidden: boolean;
  title: string;
};

type ChapterLike = {
  id: string;
  number: number;
  title?: string | null;
  suppressHeader?: boolean | null;
  articles?: { number: number; title?: string | null; clauseNumber?: number | null; itemNumber?: number | null }[];
};

/** 조 제목은 조 본문 행(항·목 번호가 없는 행)에서 가져온다 */
function joTitleOf(articles: NonNullable<ChapterLike['articles']>, jo: number): string {
  const root = articles.find(
    (a) => Number(a.number) === jo && a.clauseNumber == null && a.itemNumber == null,
  );
  if (root?.title) return String(root.title).trim();
  const anyRow = articles.find((a) => Number(a.number) === jo && a.title);
  return anyRow?.title ? String(anyRow.title).trim() : '';
}

/** 현재 문서 순서대로 조 목록을 만든다 */
export function buildJoRows(chapters: ChapterLike[] | undefined | null): JoRow[] {
  const seen = new Set<number>();
  const rows: JoRow[] = [];
  for (const chapter of [...(chapters ?? [])].sort((a, b) => a.number - b.number)) {
    const articles = chapter.articles ?? [];
    const joNumbers = [...new Set(articles.map((a) => Number(a.number)))].sort((a, b) => a - b);
    for (const jo of joNumbers) {
      if (seen.has(jo)) continue;
      seen.add(jo);
      rows.push({
        jo,
        chapterId: chapter.id,
        chapterNumber: chapter.number,
        chapterTitle: String(chapter.title ?? '').trim(),
        chapterHidden: chapter.suppressHeader === true,
        title: joTitleOf(articles, jo),
      });
    }
  }
  return rows;
}

/**
 * `from` 위치의 조를 `to` 위치로 옮긴다. 옮겨 간 자리의 장을 따라간다 —
 * 장 경계 너머로 끌면 그 장으로 이동하는 것이 화면에서 보이는 대로의 결과다.
 */
export function moveJo(rows: JoRow[], from: number, to: number): JoRow[] {
  if (from === to) return rows;
  if (from < 0 || from >= rows.length) return rows;
  const target = Math.min(Math.max(to, 0), rows.length - 1);
  const next = [...rows];
  const [moved] = next.splice(from, 1);
  next.splice(target, 0, moved);

  // 새 이웃의 장을 따른다. 위쪽 이웃이 있으면 그쪽, 없으면 아래쪽.
  const neighbor = next[target - 1] ?? next[target + 1];
  if (neighbor && neighbor.jo !== moved.jo) {
    next[target] = {
      ...moved,
      chapterId: neighbor.chapterId,
      chapterNumber: neighbor.chapterNumber,
      chapterTitle: neighbor.chapterTitle,
      chapterHidden: neighbor.chapterHidden,
    };
  }
  return next;
}

/** 조를 통째로 다른 장으로 보낸다 — 장이 하나뿐일 때도 쓸 수 있게 따로 둔다 */
export function assignChapter(rows: JoRow[], index: number, chapter: Pick<JoRow, 'chapterId' | 'chapterNumber' | 'chapterTitle' | 'chapterHidden'>): JoRow[] {
  if (index < 0 || index >= rows.length) return rows;
  const next = [...rows];
  next[index] = { ...next[index], ...chapter };
  return next;
}

/** 저장 후 번호가 어떻게 바뀌는지 — 바뀌는 것만 보여 주려고 쓴다 */
export function renumberPreview(rows: JoRow[]): { jo: number; newNumber: number; moved: boolean }[] {
  return rows.map((row, idx) => ({
    jo: row.jo,
    newNumber: idx + 1,
    moved: row.jo !== idx + 1,
  }));
}

/** 순서·장 배정 중 하나라도 처음과 다른가 */
export function hasReorderChanges(original: JoRow[], next: JoRow[]): boolean {
  if (original.length !== next.length) return true;
  return next.some(
    (row, idx) => row.jo !== original[idx].jo || row.chapterId !== original[idx].chapterId,
  );
}

/** 서버에 보낼 형태 */
export function toReorderPayload(rows: JoRow[]): { chapterId: string; jo: number }[] {
  return rows.map((r) => ({ chapterId: r.chapterId, jo: r.jo }));
}
