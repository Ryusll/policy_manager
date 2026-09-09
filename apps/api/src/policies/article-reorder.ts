/**
 * 조 순서 재정렬 계획 (T-60).
 *
 * 가져온 규정은 조 순서가 원문과 어긋나거나 장이 잘못 잡히는 일이 잦다. 지금까지는
 * 조를 하나씩 고쳐 번호를 손으로 다시 매겼는데, **조 번호는 장을 가로질러 이어지므로**
 * (제1장 제1·2조 → 제2장 제3조) 하나만 옮겨도 뒤의 번호가 전부 밀린다.
 *
 * DB 를 건드리기 전에 계획을 세우는 순수 함수로 분리해 둔다. 여기가 조용히 틀리면
 * 규정 전체의 조 번호가 어긋나고, 목차·안정 링크(T-73)·인쇄가 한꺼번에 무너진다.
 */

export type ReorderArticleRow = {
  id: string;
  chapterId: string;
  sectionId: string | null;
  number: number;
};

/** 화면이 보낸 새 순서 — 문서에 나타나는 차례대로 */
export type ReorderTarget = {
  chapterId: string;
  /** 옮기기 **전**의 조 번호. 이걸로 기존 행을 찾는다 */
  jo: number;
};

export type ReorderChange = {
  id: string;
  number: number;
  chapterId: string;
  /** 장이 바뀌면 절은 풀어야 한다 — 절은 장에 속하므로 */
  sectionId: string | null;
};

export class ReorderPlanError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ReorderPlanError';
  }
}

/**
 * 새 순서를 받아 실제로 바꿔야 할 행만 돌려준다.
 *
 * 조 하나는 여러 행이다(조 본문 + 항 + 목이 같은 `number` 를 공유한다). 그래서
 * 조를 옮기면 그 번호를 가진 행 **전부**가 함께 움직여야 한다. 한 행만 바꾸면
 * 항·목이 엉뚱한 조에 붙는다.
 */
export function buildReorderPlan(
  rows: ReorderArticleRow[],
  order: ReorderTarget[],
  policyChapterIds: string[],
): ReorderChange[] {
  const chapterSet = new Set(policyChapterIds);
  for (const t of order) {
    if (!chapterSet.has(t.chapterId)) {
      throw new ReorderPlanError('이 규정에 속하지 않은 장입니다.');
    }
  }

  const existing = new Set(rows.map((r) => r.number));
  const requested = order.map((t) => t.jo);
  const requestedSet = new Set(requested);

  if (requested.length !== requestedSet.size) {
    throw new ReorderPlanError('같은 조가 두 번 들어 있습니다.');
  }
  // 재정렬은 순서만 바꾸는 일이다. 조가 빠지거나 늘면 그건 삭제·추가이지 재정렬이 아니다.
  if (requestedSet.size !== existing.size || [...existing].some((n) => !requestedSet.has(n))) {
    throw new ReorderPlanError('규정의 모든 조를 빠짐없이 한 번씩 보내야 합니다.');
  }

  const byOldJo = new Map<number, ReorderArticleRow[]>();
  for (const row of rows) {
    const list = byOldJo.get(row.number);
    if (list) list.push(row);
    else byOldJo.set(row.number, [row]);
  }

  const changes: ReorderChange[] = [];
  order.forEach((target, idx) => {
    const newNumber = idx + 1;
    for (const row of byOldJo.get(target.jo) ?? []) {
      const chapterChanged = row.chapterId !== target.chapterId;
      // 장이 바뀌면 절을 푼다. 절은 장 소속이라 그대로 두면 남의 장 절을 가리킨다.
      const sectionId = chapterChanged ? null : row.sectionId;
      if (row.number === newNumber && !chapterChanged) continue;
      changes.push({ id: row.id, number: newNumber, chapterId: target.chapterId, sectionId });
    }
  });

  return changes;
}

/** 현재 문서 순서 — 화면이 보내지 않은 조가 있는지 대조할 때와 초기 순서를 만들 때 쓴다 */
export function currentJoOrder(
  chapters: { id: string; number: number; articles: { number: number }[] }[],
): ReorderTarget[] {
  const seen = new Set<number>();
  const out: ReorderTarget[] = [];
  const sortedChapters = [...chapters].sort((a, b) => a.number - b.number);
  for (const chapter of sortedChapters) {
    const joNumbers = [...new Set(chapter.articles.map((a) => a.number))].sort((a, b) => a - b);
    for (const jo of joNumbers) {
      if (seen.has(jo)) continue;
      seen.add(jo);
      out.push({ chapterId: chapter.id, jo });
    }
  }
  return out;
}
