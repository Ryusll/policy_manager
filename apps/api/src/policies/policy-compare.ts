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
  /** "제3조의2"의 2 */
  branchNumber?: number | null;
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
  branchNumber?: number | null;
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

function sortKey(row: {
  number: number;
  branchNumber?: number | null;
  clauseNumber: number | null;
  itemNumber: number | null;
}) {
  // null은 조 루트/항 루트라 같은 번호 안에서 가장 앞에 온다. 제3조 다음 제3조의2.
  return [
    Number(row.number) || 0,
    Number(row.branchNumber) || 0,
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
      branchNumber: anchor.branchNumber ?? null,
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

/* ────────────────────────────────────────────────────────────────────────
 * 규정 간 비교 (T-91)
 *
 * 위의 `buildComparisonRows` 는 **같은 규정의 두 시점**을 맞댄다. 그래서
 * `articleId` 로 짝을 지을 수 있다 — 조 번호가 개정으로 바뀌어도 같은 조문이다.
 *
 * 서로 다른 두 규정에는 공유하는 `articleId` 가 없다. 남는 근거는 **위치(조·항·목
 * 번호)** 뿐이라 번호로 맞댄다. 다만 그건 가정이다: 두 규정이 같은 뼈대를 가졌을
 * 때만 맞다(본사↔지사 규정, 표준규정↔우리 규정처럼). 그래서 번호는 같은데 제목이
 * 다른 줄은 `titleDiffers` 로 표시해 **"이 짝은 의심스럽다"를 화면이 말할 수 있게**
 * 한다. 조용히 짝지어 버리면 표가 그럴듯하게 틀린다.
 *
 * 3단비교(`three-way`)와도 다르다. 그쪽은 하위 조문이 본문에 상위 규정을 인용한
 * 관계를 따라가고, 이쪽은 인용 관계가 없는 두 문서를 나란히 놓는다.
 * ──────────────────────────────────────────────────────────────────────── */

export type CrossPolicyKind = 'same' | 'different' | 'left-only' | 'right-only';

export type CrossPolicySide = { title: string; content: string };

export type CrossPolicyRow = {
  /** 위치 키(조·항·목). 화면에서 행 식별자로 쓴다 */
  key: string;
  number: number;
  branchNumber?: number | null;
  clauseNumber: number | null;
  itemNumber: number | null;
  kind: CrossPolicyKind;
  left: CrossPolicySide | null;
  right: CrossPolicySide | null;
  /** 본문 낱말 단위 diff. `different` 일 때만 채운다 */
  diff: CompareDiffPart[] | null;
  /**
   * 번호는 같은데 제목이 다르다 — 번호로 맞춘 짝이 실제로는 다른 조문일 수 있다는 신호.
   * 양쪽 다 제목이 있을 때만 판단한다(항·목은 보통 제목이 없다).
   */
  titleDiffers: boolean;
};

export type CrossPolicySummary = {
  same: number;
  different: number;
  leftOnly: number;
  rightOnly: number;
  /** 번호로 맞췄지만 제목이 어긋난 줄 수 */
  suspect: number;
};

function positionKey(row: {
  number: number;
  branchNumber?: number | null;
  clauseNumber: number | null;
  itemNumber: number | null;
}): string {
  // 제3조와 제3조의2는 다른 자리다 — 가지 번호가 없으면 예전 키와 같다
  const jo = row.branchNumber ? `${Number(row.number) || 0}의${row.branchNumber}` : `${Number(row.number) || 0}`;
  return `${jo}|${row.clauseNumber ?? ''}|${row.itemNumber ?? ''}`;
}

export function buildCrossPolicyRows(
  left: CompareArticleInput[],
  right: CompareArticleInput[],
): { rows: CrossPolicyRow[]; summary: CrossPolicySummary } {
  const byKey = (list: CompareArticleInput[]) => {
    const map = new Map<string, CompareArticleInput>();
    // 같은 위치가 둘 이상이면 먼저 온 것을 쓴다(정상 데이터에서는 생기지 않는다)
    for (const a of list) if (!map.has(positionKey(a))) map.set(positionKey(a), a);
    return map;
  };
  const l = byKey(left);
  const r = byKey(right);

  const rows: CrossPolicyRow[] = [];
  for (const key of new Set([...l.keys(), ...r.keys()])) {
    const a = l.get(key) ?? null;
    const b = r.get(key) ?? null;
    const anchor = a ?? b!;

    let kind: CrossPolicyKind;
    if (!a) kind = 'right-only';
    else if (!b) kind = 'left-only';
    else kind = normalize(a.content) === normalize(b.content) ? 'same' : 'different';

    const lt = String(a?.title ?? '').trim();
    const rt = String(b?.title ?? '').trim();
    const titleDiffers = !!a && !!b && !!lt && !!rt && lt !== rt;
    // 본문이 같아도 제목이 다르면 같은 조문이라 보기 어렵다
    if (kind === 'same' && titleDiffers) kind = 'different';

    rows.push({
      key,
      number: anchor.number,
      branchNumber: anchor.branchNumber ?? null,
      clauseNumber: anchor.clauseNumber,
      itemNumber: anchor.itemNumber,
      kind,
      left: a ? { title: a.title, content: a.content } : null,
      right: b ? { title: b.title, content: b.content } : null,
      diff:
        kind === 'different' && a && b
          ? (Diff.diffWords(a.content ?? '', b.content ?? '') as CompareDiffPart[]).map((p) => ({
              value: p.value,
              ...(p.added ? { added: true } : {}),
              ...(p.removed ? { removed: true } : {}),
            }))
          : null,
      titleDiffers,
    });
  }

  rows.sort((x, y) => {
    const kx = sortKey(x);
    const ky = sortKey(y);
    for (let i = 0; i < kx.length; i += 1) if (kx[i] !== ky[i]) return kx[i] - ky[i];
    return 0;
  });

  const summary: CrossPolicySummary = { same: 0, different: 0, leftOnly: 0, rightOnly: 0, suspect: 0 };
  for (const row of rows) {
    if (row.kind === 'left-only') summary.leftOnly += 1;
    else if (row.kind === 'right-only') summary.rightOnly += 1;
    else summary[row.kind] += 1;
    if (row.titleDiffers) summary.suspect += 1;
  }
  return { rows, summary };
}
