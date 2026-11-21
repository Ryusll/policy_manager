/**
 * 신구조문대비표의 조 묶음과 주소 (SRS POLICY-10, T-229).
 *
 * 구분 칸이 행 자기 번호(`1.`·`③`)만 적고 '변동 없는 조문 숨기기'가 조 머리 행을 숨기면 어느 조의 개정인지 알 수 없었다
 * (대표 11/20). 그래서 행을 조마다 묶어 묶음 머리에 `제N조(제목)`을 적고, 구분 칸에는 어느 조인지까지 적는다(`제12조 ② 1.`).
 *
 * - 묶음은 신조문 날짜의 조 머리 행(articleId, 없으면 위치)으로 정한다. 삭제 행은 그 옛 조에서 남은 행이 있으면 그 행의 조에
 *   든다 — 번호가 바뀐 조의 삭제된 항은 옮겨 간 조에. 남은 행이 없으면(통째로 삭제) 그 옛 조만의 묶음이라, 같은 번호의 새 조와
 *   섞이지 않는다.
 * - 묶음 머리의 조 제목은 거르기 전의 행으로 정한다(목차와 같은 `inferJoTitle`) — 숨기기를 켜도 머리가 바뀌지 않는다.
 * - 행의 위치는 신조문 날짜, 삭제 행만 구조문 날짜(API 규칙). 구조문 날짜의 위치가 다르면(`movedFrom`) 구조문 칸에 따로 적는다.
 * - 번호만 바뀐 행(본문·제목 그대로)은 API 에서 '변동 없음'이지만 주소가 바뀐 것이라 숨기기를 켜도 보이고 '번호만 바뀜'이다.
 */

import type { CompareRow, ComparePosition } from '../api/policies';
import {
  articleHeadingSegments,
  articleRowHeading,
  bareArticleTitle,
  formatArticleHeading,
  type ArticleHeadingSegment,
} from './articleHeading';
import { inferJoTitle } from './articleStructure';
import { isArticleJoRoot, joKeyOf, type ArticleLabelParts } from './legalArticleLabel';

export type CompareTableRow = {
  row: CompareRow;
  /** 구분 칸 — 어느 조인지까지(`제12조 ② 1.`). 삭제 행은 구조문 날짜의 위치 */
  address: string;
  /** 번호만 바뀐 행 — 본문·제목은 그대로(API 는 변동 없음) */
  movedOnly: boolean;
  /** 구조문 칸에 따로 적을 그때의 위치 — 조 번호가 바뀐 항·목 행만(조 머리 행은 제목 줄에 위치가 있다) */
  beforeAddress: string | null;
  /** 칸 위 제목 줄 — 조 머리 행은 `제12조(제목)`의 조각, 항·목 행은 부제 한 조각(없으면 null). 강조는 제목 조각에만 */
  beforeTitle: ArticleHeadingSegment[] | null;
  afterTitle: ArticleHeadingSegment[] | null;
  /** 보이는 제목이 바뀌었는지 — 겉 괄호 한 겹만 다른 제목(`(목적)`·`목적`)은 같게 본다 */
  titleDiffers: boolean;
};

export type CompareTableGroup = {
  key: string;
  /** 묶음 머리 — `제12조(제목)` */
  heading: string;
  rows: CompareTableRow[];
};

type Positioned = ComparePosition & { title: string };

function rowPosition(row: CompareRow): ComparePosition {
  return {
    number: row.number,
    branchNumber: row.branchNumber ?? null,
    clauseNumber: row.clauseNumber,
    itemNumber: row.itemNumber,
  };
}

/** 신조문 날짜의 위치 — 신조문에 없는 행(삭제)은 null */
function afterPosition(row: CompareRow): ComparePosition | null {
  return row.after ? rowPosition(row) : null;
}

/** 구조문 날짜의 위치 — 구조문에 없는 행(신설)은 null */
function beforePosition(row: CompareRow): ComparePosition | null {
  if (!row.before) return null;
  return row.after && row.movedFrom ? row.movedFrom : rowPosition(row);
}

/** 번호만 바뀐 행 — 본문·제목이 같아 API 는 변동 없음으로 준다 */
export function isMovedOnly(row: CompareRow): boolean {
  return row.kind === 'same' && !!(row.before && row.after && row.movedFrom);
}

/** 조 밖에서 행 하나를 가리키는 주소 — 부제 없이 `제12조 ② 1.`(조 머리 행은 `제12조`). 규정 간 비교의 위치 칸도 쓴다 */
export function compareAddress(pos: ArticleLabelParts): string {
  return articleRowHeading({ ...pos, title: null });
}

function joKey(pos: ArticleLabelParts): string {
  return joKeyOf(Number(pos.number), pos.branchNumber);
}

function titleLine(pos: ComparePosition | null, title: string | undefined): ArticleHeadingSegment[] | null {
  if (!pos) return null;
  if (isArticleJoRoot(pos)) return articleHeadingSegments(pos.number, pos.branchNumber, title);
  const t = String(title ?? '').trim();
  return t ? [{ text: t, part: 'title' }] : null;
}

/**
 * 묶음 → 조 제목. null 은 모름(행으로 하는 판정에 맡긴다). `afterIds` 는 신조문에 있는 묶음 행(지금 조를 찾는 데 쓴다),
 * `memberIds` 는 삭제 행까지 묶음의 모든 행, `comparedIds` 는 이 대비의 모든 행
 */
export type JoTitleLookup = (afterIds: string[], memberIds: string[], comparedIds: ReadonlySet<string>) => string | null;

type CurrentArticle = ArticleLabelParts & { id?: string; title?: string | null; currentState?: string | null };

/**
 * 지금 규정의 조 제목 — 본문 없이 제목만 있는 조 머리 행은 판이 없어 시점 조회와 대비표 행에서 빠진다(그날 시행 중인 판이 없는
 * 행). 항이 있는 조는 대개 이렇다. 그런 조의 묶음 머리는 지금 규정에서 그 묶음의 행(articleId)이 든 조의 제목으로 채운다 — 번호로
 * 찾으면 대비 날짜 뒤에 번호가 바뀐 규정에서 다른 조의 제목이 붙는다. 모르면 null: 행이 지금 여러 조에 흩어졌거나 하나도 없을 때,
 * 그 조에 이 대비의 다른 묶음 행도 있을 때(대비 날짜 뒤에 합쳐진 조 — 어느 조의 제목인지 모른다), 지금도 조 머리 행이 없고
 * 판정이 빌 때. `policy` 는 규정 상세 응답(`GET /policies/:id`, 장마다 조문 행).
 */
export function currentJoTitles(policy: { chapters?: { articles?: CurrentArticle[] }[] } | null | undefined): JoTitleLookup {
  // 폐지된 행은 지금 규정 응답에 남아 있지만(대비의 '삭제' 행은 대개 이것이다) 지금 조의 행이 아니다 — 찾기·판정에서 뺀다
  const live = (policy?.chapters ?? []).flatMap((c) => c.articles ?? []).filter((a) => a.currentState !== 'repealed');
  const byId = new Map(live.filter((a) => a.id).map((a) => [a.id as string, a]));
  return (afterIds, memberIds, comparedIds) => {
    const found = afterIds.map((id) => byId.get(id)).filter((a): a is CurrentArticle => !!a);
    if (!found.length || new Set(found.map(joKey)).size !== 1) return null;
    const jo = joKey(found[0]);
    const joRows = live.filter((a) => joKey(a) === jo);
    const mine = new Set(memberIds);
    if (joRows.some((a) => a.id && comparedIds.has(a.id) && !mine.has(a.id))) return null;
    const title = inferJoTitle(live, Number(found[0].number), found[0].branchNumber);
    if (!title && !joRows.some((a) => isArticleJoRoot(a))) return null;
    return title;
  };
}

/**
 * 대비표의 행을 조마다 묶는다. `rows` 는 API 가 준 모든 행(거르기 전)으로 API 차례(조 → 항 → 목)다. 묶음은 머리의 조 번호
 * 차례(같은 번호면 통째로 삭제된 옛 조가 먼저), 묶음 안은 머리 조의 행 → 다른 조에서 온 행(병합·이동한 옛 조의 삭제 행)이다.
 * `hideUnchanged` 면 변동 없는 행(번호만 바뀐 행은 빼고)을 빼고, 남은 행이 없는 묶음도 뺀다(머리와 조 제목 판정은 그대로).
 * `fallbackTitle` 은 행에 조 머리 행이 없는 신조문 쪽 조의 제목(`currentJoTitles`) — 있으면 행으로 하는 옛 데이터 판정보다 먼저다.
 */
export function groupComparisonRows(
  rows: CompareRow[],
  hideUnchanged: boolean,
  fallbackTitle?: JoTitleLookup,
): CompareTableGroup[] {
  // 신조문 날짜의 조 머리 행 — 조(번호·가지) → 그 자리의 조 머리 행 articleId
  const newHead = new Map<string, string>();
  // 구조문 날짜의 조 → 신조문에도 남은 그 조의 행 하나(그 조가 어느 조로 이어졌는지 — 번호가 바뀌었어도)
  const survivor = new Map<string, CompareRow>();
  const afterRows: Positioned[] = [];
  const beforeRows: Positioned[] = [];
  for (const row of rows) {
    const a = afterPosition(row);
    const b = beforePosition(row);
    if (a) {
      afterRows.push({ ...a, title: row.after!.title });
      if (isArticleJoRoot(a)) newHead.set(joKey(a), row.articleId);
    }
    if (b) {
      beforeRows.push({ ...b, title: row.before!.title });
      if (a && !survivor.has(joKey(b))) survivor.set(joKey(b), row);
    }
  }

  const rowById = new Map(rows.map((r) => [r.articleId, r]));
  const comparedIds = new Set(rowById.keys());

  function newSideKey(a: ComparePosition): string {
    const head = newHead.get(joKey(a));
    return head ? `id:${head}` : `new:${joKey(a)}`;
  }

  function groupKeyOf(row: CompareRow): string {
    const a = afterPosition(row);
    if (a) return newSideKey(a);
    // 삭제 행: 그 옛 조가 신조문에 이어졌으면(행이 하나라도 남았으면) 이어진 조의 묶음 — 번호가 바뀌었으면 옮겨 간 조다.
    // 통째로 삭제됐으면 그 옛 조만의 묶음(같은 번호의 새 조에 섞지 않는다)
    const b = beforePosition(row)!;
    const kept = survivor.get(joKey(b));
    return kept ? newSideKey(afterPosition(kept)!) : `old:${joKey(b)}`;
  }

  const groups = new Map<string, CompareRow[]>();
  for (const row of rows) {
    const key = groupKeyOf(row);
    const list = groups.get(key);
    if (list) list.push(row);
    else groups.set(key, [row]);
  }

  const result: (CompareTableGroup & { order: number[] })[] = [];
  for (const [key, members] of groups) {
    // 머리: 신조문에 있는 조는 신조문 날짜의 번호·제목, 통째로 삭제된 조는 구조문 날짜의 번호·제목
    const head = key.startsWith('id:') ? rowById.get(key.slice(3)) : undefined;
    const ref = head ?? members.find((r) => r.after) ?? members[0];
    const fromAfter = !!ref.after;
    const pos = (fromAfter ? afterPosition(ref) : beforePosition(ref))!;
    // 행에 조 머리 행이 없으면(본문 없는 조 머리 행은 판이 없어 빠진다) 지금 규정에서 이 묶음의 행이 든 조의 제목. 조 머리 행이
    // 있는데 제목이 빈 것은 그대로 두고, 통째로 삭제된 옛 조는 지금 규정에 없어 행으로만 판정한다
    let title: string | null = null;
    if (fromAfter && !newHead.has(joKey(pos)) && fallbackTitle) {
      title = fallbackTitle(
        members.filter((r) => r.after).map((r) => r.articleId),
        members.map((r) => r.articleId),
        comparedIds,
      );
    }
    if (title == null) title = inferJoTitle(fromAfter ? afterRows : beforeRows, Number(pos.number), pos.branchNumber);

    // 묶음 안은 API 차례(조 → 항 → 목)를 그대로 두고, 다른 조에서 온 행(합쳐지거나 옮겨 간 옛 조의 삭제 행)만 뒤로 보낸다
    const headJo = joKey(pos);
    const fromElsewhere = (r: CompareRow) => (joKey(rowPosition(r)) === headJo ? 0 : 1);
    const ordered = [...members].sort((x, y) => fromElsewhere(x) - fromElsewhere(y));
    const shown = hideUnchanged ? ordered.filter((r) => r.kind !== 'same' || isMovedOnly(r)) : ordered;
    if (!shown.length) continue;

    result.push({
      key,
      heading: formatArticleHeading(pos.number, pos.branchNumber, title),
      order: [Number(pos.number) || 0, Number(pos.branchNumber) || 0, fromAfter ? 1 : 0],
      rows: shown.map((row) => {
        const b = beforePosition(row);
        const a = afterPosition(row);
        const root = isArticleJoRoot(rowPosition(row));
        const bare = (t?: string) => (root ? bareArticleTitle(t) : String(t ?? '').trim());
        return {
          row,
          address: compareAddress(rowPosition(row)),
          movedOnly: isMovedOnly(row),
          beforeAddress: row.after && row.movedFrom && b && !isArticleJoRoot(b) ? compareAddress(b) : null,
          beforeTitle: titleLine(b, row.before?.title),
          afterTitle: titleLine(a, row.after?.title),
          titleDiffers: !!(row.before && row.after) && bare(row.before.title) !== bare(row.after.title),
        };
      }),
    });
  }

  return result
    .sort((x, y) => x.order[0] - y.order[0] || x.order[1] - y.order[1] || x.order[2] - y.order[2])
    .map(({ key, heading, rows: groupRows }) => ({ key, heading, rows: groupRows }));
}

/**
 * '바뀐 조 N개' — 바뀐 행(번호만 바뀐 행 포함)이 하나라도 있는 묶음의 수. 행 수와 따로 센다. 다른 조로 합쳐진 옛 조는 이어진 조의
 * 묶음 하나로 센다(그 묶음 안에 옛 조의 삭제 행이 보인다).
 */
export function countChangedJo(groups: CompareTableGroup[]): number {
  return groups.filter((g) => g.rows.some((r) => r.row.kind !== 'same' || r.movedOnly)).length;
}

/** 번호만 바뀐 행의 수 — API 요약은 이 행을 변동 없음에 넣는다 */
export function countMovedOnly(rows: CompareRow[]): number {
  return rows.filter(isMovedOnly).length;
}
