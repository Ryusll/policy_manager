import { buildCommitPlan, type RowTrace } from './commit-rows';
import type { RegulationArticleNode } from './regulation-tree.builder';
import type { ParsedChapter, ParsedRow } from './reparse-match';

/**
 * 미리보기 트리 → 재파싱 행·장·절 (T-110). 새 규정 등록과 같은 변환(`buildCommitPlan`)을 써서 처음 가져올 때와 같은 본문이
 * 나오게 한다 — 그래야 바뀌지 않은 조문의 지문이 같다. 변환이 원문 번호를 고쳐 쓴 행은 `renumbered` 로 표시한다.
 * 부칙·별표는 이번 대응 범위 밖이라 개수만 돌려준다.
 */
export function parsedFromTree(roots: RegulationArticleNode[]): {
  rows: ParsedRow[];
  chapters: ParsedChapter[];
  appendixCount: number;
} {
  const traces: RowTrace[] = [];
  const plan = buildCommitPlan(roots, { onRow: (_row, trace) => traces.push(trace) });
  const rows: ParsedRow[] = plan.rows.map((r, index) => ({
    index,
    nodeId: traces[index]?.nodeId ?? null,
    number: r.number,
    branch: r.branchNumber,
    clause: r.clauseNumber,
    item: r.itemNumber,
    chapterIndex: r.chapterIndex,
    sectionIndex: r.sectionIndex,
    title: r.title,
    content: r.content,
    renumbered: traces[index]?.renumbered ?? true,
  }));
  const chapters: ParsedChapter[] = plan.chapters.map((c, index) => ({
    index,
    number: c.number,
    title: c.title,
    hidden: c.suppressHeader,
    sections: c.sections.map((s, i) => ({ index: i, number: s.number, title: s.title })),
  }));
  return { rows, chapters, appendixCount: plan.appendices.length };
}
