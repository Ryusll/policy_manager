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
import { BadRequestException, ConflictException } from '@nestjs/common';
import { createHash } from 'node:crypto';

export type ReorderArticleRow = {
  id: string;
  chapterId: string;
  sectionId: string | null;
  number: number;
  /** "제3조의2"의 2. 조 하나 = (조 번호, 가지 번호) */
  branchNumber?: number | null;
};

/** 화면이 보낸 새 순서 — 문서에 나타나는 차례대로 */
export type ReorderTarget = {
  chapterId: string;
  /** 옮기기 **전**의 조 번호. 이걸로 기존 행을 찾는다 */
  jo: number;
  /** 옮기기 전 가지 번호(제3조의2면 2). 가지 조문이 아니면 생략 */
  branch?: number | null;
};

export type ReorderChange = {
  id: string;
  number: number;
  /** 재정렬하면 1부터 차례로 다시 매기므로 가지 번호는 풀린다 */
  branchNumber: null;
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

  const keyOf = (jo: number, branch?: number | null) => `${jo}-${branch || 0}`;
  const existing = new Set(rows.map((r) => keyOf(r.number, r.branchNumber)));
  const requested = order.map((t) => keyOf(t.jo, t.branch));
  const requestedSet = new Set(requested);

  if (requested.length !== requestedSet.size) {
    throw new ReorderPlanError('같은 조가 두 번 들어 있습니다.');
  }
  // 재정렬은 순서만 바꾸는 일이다. 조가 빠지거나 늘면 그건 삭제·추가이지 재정렬이 아니다.
  if (requestedSet.size !== existing.size || [...existing].some((n) => !requestedSet.has(n))) {
    throw new ReorderPlanError('규정의 모든 조를 빠짐없이 한 번씩 보내야 합니다.');
  }

  const byOldJo = new Map<string, ReorderArticleRow[]>();
  for (const row of rows) {
    const key = keyOf(row.number, row.branchNumber);
    const list = byOldJo.get(key);
    if (list) list.push(row);
    else byOldJo.set(key, [row]);
  }

  const changes: ReorderChange[] = [];
  order.forEach((target, idx) => {
    const newNumber = idx + 1;
    for (const row of byOldJo.get(keyOf(target.jo, target.branch)) ?? []) {
      const chapterChanged = row.chapterId !== target.chapterId;
      // 장이 바뀌면 절을 푼다. 절은 장 소속이라 그대로 두면 남의 장 절을 가리킨다.
      const sectionId = chapterChanged ? null : row.sectionId;
      if (row.number === newNumber && !row.branchNumber && !chapterChanged) continue;
      changes.push({ id: row.id, number: newNumber, branchNumber: null, chapterId: target.chapterId, sectionId });
    }
  });

  return changes;
}

/** 배치 지문의 재료 — 조문 행 하나(조 본문·항·호·목 행 모두)와 그 행이 속한 장의 번호 */
export type JoLayoutRow = { id: string; chapterId: string; chapterNumber: number; number: number; branchNumber?: number | null };

/**
 * 규정의 지금 조문 배치 지문(T-225) — 행마다 (id·장·장 번호·조 번호·가지 번호)를 정렬해 이은 sha256. 조 순서 창을 연 화면이 이 값을
 * 들고 있다가 저장할 때 보내면(basedOn) 서버가 규정을 잠근 뒤 지금 행으로 다시 만들어 견준다 — 그 사이 다른 저장·승인이 조를 옮기거나
 * 더했으면 옛 번호로 보낸 차례가 엉뚱한 조에 적용되므로 거절한다.
 * - 행 id 를 넣는다: 재정렬은 번호를 1부터 다시 매기므로 조 단위(장·번호) 목록은 맞바꾼 뒤에도 같고, 달라지는 것은 어느 행이 몇 번에
 *   붙었는지다. 항·호·목 행도 한 줄씩 들어가므로 항을 더하거나 지우기만 해도 지문이 바뀐다(거절된 쪽은 다시 받은 순서로 옮기면 된다).
 *   그 행의 항·호·목 번호와 제목·본문은 넣지 않는다(조 순서와 상관없다)
 * - 장 번호를 넣는다: 창은 장 번호 차례로 조를 늘어놓아 보내고 서버는 그 차례대로 1부터 매기므로, 그 사이 장 번호가 바뀌었으면 창이 본
 *   적 없는 장 차례로 번호가 매겨진다(화면 서명 joOrderSignature 도 조가 있는 장의 번호를 본다). 조가 없는 장은 넣지 않는다(행에 딸린
 *   장만 들어간다 — 빈 장은 창에 그리지 않는다)
 * - 가지 번호는 없음과 0 을 같게 본다(buildReorderPlan 의 짝 맞추기와 같게)
 * - 화면 응답은 일부 행(오늘 조문 자리의 시행 예정·폐지 조문)을 빼고 보이므로 지문은 서버가 DB 행 전부로 만들어 내려준다(GET :id 의
 *   current.joOrderBasis, GET :id/jo-order 의 basedOn)
 */
export function joLayoutDigest(rows: readonly JoLayoutRow[]): string {
  const lines = rows.map((r) => `${r.id}@${r.chapterId}#${r.chapterNumber}/${r.number}/${r.branchNumber || 0}`).sort();
  return createHash('sha256').update(lines.join('\n')).digest('hex');
}

/** 창을 연 뒤에 배치가 바뀌었다(T-225) — 409 로 돌려주고, 화면은 이 code 로 문구를 고른다 */
export const JO_ORDER_STALE = 'POLICY_JO_ORDER_STALE';
export const JO_ORDER_STALE_MESSAGE =
  '창을 연 뒤에 다른 저장이 조 순서나 조문을 바꿔 이 저장은 반영하지 않았습니다 — 지금 순서를 확인한 뒤 다시 옮기세요.';
/** 지문 없이 보낸 저장(T-225 전에 연 옛 화면) — 견줄 수 없어 400. 옛 화면은 서버 문구를 그대로 보이므로 새로 고치라고 쓴다 */
export const JO_ORDER_BASIS_REQUIRED = 'POLICY_JO_ORDER_BASIS_REQUIRED';
export const JO_ORDER_BASIS_REQUIRED_MESSAGE = '화면이 최신이 아니어서 조 순서를 저장하지 않았습니다 — 화면을 새로 고친 뒤 다시 옮기세요.';

/**
 * 저장에 실린 지문을 꺼낸다 — 없거나 문자열이 아니면(빠짐·null) 400 POLICY_JO_ORDER_BASIS_REQUIRED. 견주지 않고 적용하면 배포 전에 연
 * 옛 화면의 저장이 옛 번호로 다른 조에 적용된다. 잠그기 전에 부른다(형식은 DTO 가 본다)
 */
export function requireJoLayoutBasis(basedOn: unknown): string {
  if (typeof basedOn === 'string' && basedOn !== '') return basedOn;
  throw new BadRequestException({ statusCode: 400, error: 'Bad Request', code: JO_ORDER_BASIS_REQUIRED, message: JO_ORDER_BASIS_REQUIRED_MESSAGE });
}

/** 잠근 뒤 읽은 지금 행의 지문이 저장에 실린 지문과 다르면 409 POLICY_JO_ORDER_STALE — 계획·'바뀐 것 없음'보다 먼저(옛 차례도 계획으로는 맞을 수 있다) */
export function assertJoLayoutBasis(rows: readonly JoLayoutRow[], basedOn: string): void {
  if (joLayoutDigest(rows) !== basedOn) {
    throw new ConflictException({ statusCode: 409, error: 'Conflict', code: JO_ORDER_STALE, message: JO_ORDER_STALE_MESSAGE });
  }
}

/** 현재 문서 순서 — 화면이 보내지 않은 조가 있는지 대조할 때와 초기 순서를 만들 때 쓴다 */
export function currentJoOrder(
  chapters: { id: string; number: number; articles: { number: number; branchNumber?: number | null }[] }[],
): ReorderTarget[] {
  const seen = new Set<string>();
  const out: ReorderTarget[] = [];
  const sortedChapters = [...chapters].sort((a, b) => a.number - b.number);
  for (const chapter of sortedChapters) {
    const units = chapter.articles
      .map((a) => ({ jo: a.number, branch: a.branchNumber || 0 }))
      .sort((a, b) => a.jo - b.jo || a.branch - b.branch);
    for (const { jo, branch } of units) {
      const key = `${jo}-${branch}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(branch ? { chapterId: chapter.id, jo, branch } : { chapterId: chapter.id, jo });
    }
  }
  return out;
}
