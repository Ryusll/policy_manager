import { asOfState } from '../common/as-of';
import { placeAsOf, type AsOfArticle, type AsOfChapter } from './as-of-structure';

/**
 * 규정 "현재" 화면의 조립 (T-127 ②).
 *
 * 현재 = 오늘(한국 날짜) 시점 조회다. 그래서 조립도 시점 조회(`findOneAsOf`)처럼 **고른 버전의 얼린 계층(T-110 ②)**으로
 * 한다(`placeAsOf`). 묶음 승인은 승인하는 순간 조문 행(지금 계층)을 새 자리로 옮기고 그 전 시행 이력에 옛 계층을 얼려 두므로,
 * 미래 시행일로 승인한 묶음이 시행되기 전까지 오늘 본문은 옛 자리에 있어야 한다 — 고른 버전만 바꾸고 자리를 지금 행에서 가져오면
 * 옛 본문이 새 자리에 보인다.
 *
 * 단 얼린 계층은 **그 조문에 시행 예정 버전이 있을 때만**(`hasScheduled`) 쓴다. 묶음은 계층이 바뀌는 조문마다 묶음 버전을
 * 만들고(발행할 때 얼린 값을 비워 지금 행을 따르게 한다) 그 전 이력만 얼리므로, 오늘 버전에 얼린 값이 있다는 것은 정상이라면
 * 그 조문의 묶음 버전이 아직 시행 전이라는 뜻이다. 어떤 이유로든 시행 예정 버전 없이 얼린 값만 남은 조문은 지금 행이 오늘
 * 자리다 — 그 값을 쓰면 화면 자리와 지금 행이 영영 달라 아래 구조 편집 잠금이 풀리지 않는다.
 *
 * 다만 이 화면은 편집 화면이기도 해서 시점 조회와 다른 점이 있다.
 * - 버전이 없는 조 머리(제목만 있는 조)는 빼지 않고, 같은 조의 항·호가 옮겨졌으면 따라간다.
 * - 초안만 있는 조문은 지금 자리에 남긴다(시행 전 초안 표시·한꺼번에 시행).
 * - 시행 예정만 있는 조문(새 조문을 미래 시행일로 승인)은 지금 자리에 둔다. 단 그 자리를 오늘 시행 중인 조문이 차지하면
 *   본문에서 빼고 `excluded` 로 돌려준다(시행 예정 목록에 따로 보인다).
 * - 폐지된 조문이 오늘 시행 중인 조문과 같은 자리면 뺀다.
 * - 조문이 이렇게 빠져서 비게 된 장은 감춘다. 원래 조문이 없던 장은 그대로 둔다(조문을 넣을 수 있게).
 *
 * 조문마다 지금 행의 장·절 id 를 `liveChapterId`·`liveSectionId` 로 남긴다 — 수정·삭제 호출은 지금 행 기준이다.
 * 오늘 자리가 지금 행과 다른 조문은 `displaced`, 지금은 없는 장(그 뒤에 지워진 장을 다시 세운 것)은 `virtual` 로 표시하고
 * 그 수(+ 오늘 번호·제목이 지금과 다른 장)를 `displaced` 로 돌려준다 — 화면은 이 동안 구조 편집(조·항·절 추가, 순서 재정렬,
 * 번호·제목 고치기)을 막는다. 화면 자리로 편집하면 지금 행의 엉뚱한 자리가 바뀐다.
 */

export type CurrentState = 'in_force' | 'repealed' | 'scheduled' | 'none';

/** 조문 하나의 "현재" 상태 — 오늘 고른 버전(`currentVersionWhere` 의 첫 행)과 시행 예정 버전 유무로 */
export function currentStateOf(
  picked: { repealedOn: Date | null } | null | undefined,
  today: Date,
  hasScheduled: boolean,
): CurrentState {
  const s = asOfState(picked, today);
  if (s === 'in_force') return 'in_force';
  if (s === 'repealed') return 'repealed';
  return hasScheduled ? 'scheduled' : 'none';
}

export type CurrentArticle = AsOfArticle & {
  currentState: CurrentState;
  /** 시행 예정 버전이 있다 — 미래 시행 묶음(T-110 ②)이 옮긴 조문은 묶음 버전이 시행 예정이다 */
  hasScheduled?: boolean;
};
type Live = {
  liveChapterId: string;
  liveSectionId: string | null;
  liveNumber: number;
  liveBranchNumber: number | null;
  liveClauseNumber: number | null;
  liveItemNumber: number | null;
  liveTitle: string;
  /** 오늘 자리(장·절·번호·제목)가 지금 행과 다르다 — 미래 시행 묶음이 옮긴 조문 */
  displaced: boolean;
};

const posKey = (a: { number: number; branchNumber: number | null; clauseNumber: number | null; itemNumber: number | null }) =>
  `${a.number}:${a.branchNumber ?? 0}:${a.clauseNumber ?? ''}:${a.itemNumber ?? ''}`;
const joKey = (chapterId: string, number: number, branchNumber: number | null) => `${chapterId}:${number}:${branchNumber ?? 0}`;
const isHead = (a: { clauseNumber: number | null; itemNumber: number | null }) => a.clauseNumber == null && a.itemNumber == null;

const byPosition = (a: AsOfArticle, b: AsOfArticle) =>
  a.number - b.number ||
  (a.branchNumber ?? 0) - (b.branchNumber ?? 0) ||
  (a.clauseNumber ?? -1) - (b.clauseNumber ?? -1) ||
  (a.itemNumber ?? -1) - (b.itemNumber ?? -1);

/**
 * @param chapters 지금 행 그대로의 장 목록. 조문마다 `versions` 는 오늘 고른 버전 0~1개(폐지된 것도 그대로 — 자리를 얼린 값에서
 *   찾아야 한다), `currentState` 는 `currentStateOf` 로 정한 값.
 */
export function buildCurrentChapters<C extends AsOfChapter<CurrentArticle>>(
  chapters: C[],
): {
  chapters: (Omit<C, 'articles'> & { articles: (C['articles'][number] & Live)[]; virtual?: true })[];
  excluded: (C['articles'][number] & Live)[];
  displaced: number;
} {
  type A = C['articles'][number];
  type OutChapter = Omit<C, 'articles'> & { articles: (A & Live)[]; virtual?: true };
  // 지금 행의 자리를 남긴다(placeArticle 은 ...a 로 펼치므로 그대로 따라간다)
  const live = chapters.map((ch) => ({
    ...ch,
    articles: ch.articles.map((a) => ({
      ...a,
      liveChapterId: a.chapterId,
      liveSectionId: a.sectionId,
      liveNumber: a.number,
      liveBranchNumber: a.branchNumber,
      liveClauseNumber: a.clauseNumber,
      liveItemNumber: a.itemNumber,
      liveTitle: a.title ?? '',
      displaced: false,
    })),
  }));
  // 얼린 계층은 오늘 시행 중이거나 폐지된 조문의 고른 버전에서만, 그것도 시행 예정 버전이 있을 때만 읽는다. 나머지는 지금 자리.
  const forPlacement = live.map((ch) => ({
    ...ch,
    articles: ch.articles.map((a) =>
      (a.currentState === 'in_force' || a.currentState === 'repealed') && a.hasScheduled
        ? a
        : { ...a, versions: [] as A['versions'] },
    ),
  }));
  const placed = placeAsOf<A & Live, OutChapter>(forPlacement as unknown as OutChapter[]);
  // 자리 계산이 끝났으니 원래 버전(초안·시행 예정 행의 빈 목록 말고 원본)을 되돌린다
  const original = new Map(live.flatMap((ch) => ch.articles).map((a) => [a.id, a]));
  for (const ch of placed) ch.articles = ch.articles.map((a) => ({ ...a, versions: original.get(a.id)!.versions }));

  // 버전 없는 조 머리는 같은 조(지금 행 기준)의 항·호가 옮겨진 자리로 따라간다
  const moved = new Map<string, { chapterId: string; sectionId: string | null; number: number; branchNumber: number | null }>();
  for (const ch of placed) {
    for (const a of [...ch.articles].sort(byPosition)) {
      if (isHead(a)) continue;
      const key = joKey(a.liveChapterId, a.liveNumber, a.liveBranchNumber);
      if (moved.has(key)) continue;
      if (ch.id !== a.liveChapterId || a.number !== a.liveNumber || (a.branchNumber ?? 0) !== (a.liveBranchNumber ?? 0)) {
        moved.set(key, { chapterId: ch.id, sectionId: a.sectionId, number: a.number, branchNumber: a.branchNumber });
      }
    }
  }
  const byId = new Map(placed.map((ch) => [ch.id, ch]));
  for (const ch of placed) {
    ch.articles = ch.articles.filter((a) => {
      if (!isHead(a) || a.versions.length) return true;
      const to = moved.get(joKey(a.liveChapterId, a.liveNumber, a.liveBranchNumber));
      if (!to) return true;
      const target = byId.get(to.chapterId);
      if (!target) return true;
      const followed = { ...a, chapterId: to.chapterId, sectionId: to.sectionId, number: to.number, branchNumber: to.branchNumber };
      if (target === ch) {
        Object.assign(a, followed);
        return true;
      }
      target.articles.push(followed);
      return false;
    });
  }

  // 오늘 시행 중인 조문이 차지한 자리에는 시행 예정·폐지 조문을 두지 않는다
  const occupied = new Set(placed.flatMap((ch) => ch.articles.filter((a) => a.currentState === 'in_force').map(posKey)));
  // 지금 행 기준으로 조문이 있던 장 — 그 조문이 모두 다른 자리로 갔거나 빠져서 비면 감춘다(미래 시행 묶음이 새로 만든 장 등)
  const liveCount = new Map(chapters.map((ch) => [ch.id, ch.articles.length]));
  const excluded: (A & Live)[] = [];
  const out: OutChapter[] = [];
  for (const ch of placed) {
    const kept = ch.articles.filter((a) => {
      if ((a.currentState === 'scheduled' || a.currentState === 'repealed') && occupied.has(posKey(a))) {
        if (a.currentState === 'scheduled') excluded.push(a);
        return false;
      }
      return true;
    });
    const isVirtual = !liveCount.has(ch.id);
    if (!kept.length && (isVirtual || (liveCount.get(ch.id) ?? 0) > 0)) continue;
    out.push({ ...ch, articles: kept.sort(byPosition), ...(isVirtual ? { virtual: true as const } : {}) });
  }

  // 오늘 자리와 지금 행이 다른 것 — 이 동안 화면 자리로 구조를 고치면 지금 행의 엉뚱한 자리가 바뀐다
  const liveChapter = new Map(chapters.map((ch) => [ch.id, ch]));
  let displaced = 0;
  for (const ch of out) {
    const lc = liveChapter.get(ch.id);
    if (!lc || lc.number !== ch.number || (lc.title ?? '') !== (ch.title ?? '')) displaced += 1;
    for (const a of ch.articles) {
      a.displaced =
        ch.id !== a.liveChapterId ||
        (a.sectionId ?? null) !== (a.liveSectionId ?? null) ||
        a.number !== a.liveNumber ||
        (a.branchNumber ?? null) !== (a.liveBranchNumber ?? null) ||
        (a.clauseNumber ?? null) !== (a.liveClauseNumber ?? null) ||
        (a.itemNumber ?? null) !== (a.liveItemNumber ?? null) ||
        (a.title ?? '') !== a.liveTitle;
      if (a.displaced) displaced += 1;
    }
  }
  return { chapters: out.sort((a, b) => a.number - b.number), excluded: excluded.sort(byPosition), displaced };
}
