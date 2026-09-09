/**
 * 신구조문대비표 (T-56).
 *
 * 국가법령정보센터의 "신구법비교"에 해당하되, 대상이 *우리 규정끼리*라 외부 데이터가 필요 없다.
 * 두 시점의 as-of 스냅샷을 조문 단위로 맞대어 무엇이 신설·삭제·개정됐는지 만든다.
 *
 * 정렬은 조 → 항 → 목 순. 조문 동일성은 `articleId`로 판단한다
 * (조 번호는 개정 과정에서 바뀔 수 있으므로 번호로 맞추면 엉뚱하게 짝지어진다).
 */

import * as Diff from 'diff';

export type CompareArticleInput = {
  id: string;
  number: number;
  clauseNumber: number | null;
  itemNumber: number | null;
  title: string;
  content: string;
  effectiveDate: string | null;
};

export type CompareKind = 'added' | 'removed' | 'changed' | 'same';

export type CompareDiffPart = { value: string; added?: boolean; removed?: boolean };

export type CompareRow = {
  articleId: string;
  /** 표기용 위치 — 신조문 기준, 삭제된 조문은 구조문 기준 */
  number: number;
  clauseNumber: number | null;
  itemNumber: number | null;
  kind: CompareKind;
  before: { title: string; content: string; effectiveDate: string | null } | null;
  after: { title: string; content: string; effectiveDate: string | null } | null;
  /** 본문 낱말 단위 diff. kind가 'changed'일 때만 채운다 */
  diff: CompareDiffPart[] | null;
  /** 제목이 바뀌었는지 (본문과 별개로 표시) */
  titleChanged: boolean;
};

export type CompareSummary = {
  added: number;
  removed: number;
  changed: number;
  same: number;
};

function sortKey(row: { number: number; clauseNumber: number | null; itemNumber: number | null }) {
  // null은 조 루트/항 루트라 같은 번호 안에서 가장 앞에 온다
  return [
    Number(row.number) || 0,
    row.clauseNumber == null ? -1 : Number(row.clauseNumber),
    row.itemNumber == null ? -1 : Number(row.itemNumber),
  ];
}

function compareSortKey(a: CompareRow, b: CompareRow): number {
  const ka = sortKey(a);
  const kb = sortKey(b);
  for (let i = 0; i < ka.length; i += 1) {
    if (ka[i] !== kb[i]) return ka[i] - kb[i];
  }
  return 0;
}

function normalize(text: string): string {
  // 줄바꿈·공백 차이만으로 "개정됨"이 되지 않도록 비교 전에만 정규화한다(표시는 원문 그대로).
  return String(text ?? '')
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/[ \t]*\n[ \t]*/g, '\n')
    .trim();
}

export function buildComparisonRows(
  before: CompareArticleInput[],
  after: CompareArticleInput[],
): { rows: CompareRow[]; summary: CompareSummary } {
  const beforeById = new Map(before.map((a) => [a.id, a]));
  const afterById = new Map(after.map((a) => [a.id, a]));
  const allIds = new Set<string>([...beforeById.keys(), ...afterById.keys()]);

  const rows: CompareRow[] = [];

  for (const id of allIds) {
    const b = beforeById.get(id) ?? null;
    const a = afterById.get(id) ?? null;
    const anchor = a ?? b!; // 둘 다 없을 수는 없다

    let kind: CompareKind;
    if (!b) kind = 'added';
    else if (!a) kind = 'removed';
    else kind = normalize(b.content) === normalize(a.content) ? 'same' : 'changed';

    const titleChanged = !!b && !!a && String(b.title ?? '').trim() !== String(a.title ?? '').trim();
    // 본문은 같은데 제목만 바뀐 경우도 개정으로 본다
    if (kind === 'same' && titleChanged) kind = 'changed';

    rows.push({
      articleId: id,
      number: anchor.number,
      clauseNumber: anchor.clauseNumber,
      itemNumber: anchor.itemNumber,
      kind,
      before: b ? { title: b.title, content: b.content, effectiveDate: b.effectiveDate } : null,
      after: a ? { title: a.title, content: a.content, effectiveDate: a.effectiveDate } : null,
      diff:
        kind === 'changed' && b && a
          ? (Diff.diffWords(b.content ?? '', a.content ?? '') as CompareDiffPart[]).map((p) => ({
              value: p.value,
              ...(p.added ? { added: true } : {}),
              ...(p.removed ? { removed: true } : {}),
            }))
          : null,
      titleChanged,
    });
  }

  rows.sort(compareSortKey);

  const summary: CompareSummary = { added: 0, removed: 0, changed: 0, same: 0 };
  for (const row of rows) summary[row.kind] += 1;

  return { rows, summary };
}
