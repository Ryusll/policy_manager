/**
 * 재등록 전후로 조항별 versionKey 를 비교해 실제로 달라진 조항만 골라낸다(T-103).
 *
 * 공백·개행 차이는 이미 versionKey 정규화(law-version-key.ts)가 흡수하므로, 여기서는
 * 단순 문자열 비교만 하면 된다 — versionKey 가 같으면 "내용 동일"(공백만 다른 경우 포함)
 * 로 보고 이벤트를 만들지 않는다.
 *
 * DB 를 모르는 순수 함수다. `LawsService.register()` 가 upsert 루프 전후로 찍은
 * 스냅샷을 넘겨 호출한다 — 그래야 `tests/`에서 Prisma 없이 바로 단위 테스트할 수 있다
 * (같은 패턴: law-version-key.ts, law-rows.ts).
 */

export type ExistingLawArticleSnapshot = {
  lawArticleId: string;
  nodeKey: string;
  content: string;
  versionKey: string;
};

export type IncomingLawArticleRow = {
  nodeKey: string;
  content: string;
  versionKey: string;
};

export type LawArticleChange =
  | { type: 'created'; nodeKey: string; lawArticleId: string; after: IncomingLawArticleRow }
  | {
      type: 'modified';
      nodeKey: string;
      lawArticleId: string;
      before: ExistingLawArticleSnapshot;
      after: IncomingLawArticleRow;
    }
  | { type: 'deleted'; nodeKey: string; lawArticleId: string; before: ExistingLawArticleSnapshot };

/**
 * ⚠️ `existing` 가 비어 있으면(= 최초 등록) 빈 배열을 돌려준다. 비교할 이전 상태가
 * 없는 것은 "개정"이 아니라 "처음 받았다"이다 — 그대로 비교하면 조문 수만큼
 * (근로기준법이면 478건) created 이벤트가 쏟아진다. 등록이 성공했다면 조문이 최소
 * 1건 있으므로(register() 가 빈 응답을 거부) 비어 있다는 것은 곧 최초 등록이다.
 *
 * @param existing 재등록 직전 DB 에 있던 조항들(같은 법령 범위)
 * @param incoming 이번에 법제처에서 받은 조항들
 * @param articleIdByNodeKey `incoming` 각 행이 upsert 된 뒤 받은 `LawArticle.id`.
 *   created/modified 이벤트가 어느 조문을 가리키는지 채우는 데 쓴다 — 생성 시점에는
 *   아직 id 가 없으므로 호출 쪽이 upsert 를 먼저 마친 뒤 넘긴다.
 */
export function detectLawArticleChanges(
  existing: ExistingLawArticleSnapshot[],
  incoming: IncomingLawArticleRow[],
  articleIdByNodeKey: Map<string, string>,
): LawArticleChange[] {
  if (!existing.length) return [];

  const existingByNodeKey = new Map(existing.map((e) => [e.nodeKey, e]));
  const incomingByNodeKey = new Map(incoming.map((i) => [i.nodeKey, i]));
  const changes: LawArticleChange[] = [];

  for (const after of incoming) {
    const before = existingByNodeKey.get(after.nodeKey);
    const lawArticleId = articleIdByNodeKey.get(after.nodeKey);
    if (!lawArticleId) {
      throw new Error(`articleIdByNodeKey 에 없는 nodeKey 입니다: ${after.nodeKey}`);
    }
    if (!before) {
      changes.push({ type: 'created', nodeKey: after.nodeKey, lawArticleId, after });
    } else if (before.versionKey !== after.versionKey) {
      changes.push({ type: 'modified', nodeKey: after.nodeKey, lawArticleId, before, after });
    }
    // versionKey 가 같으면 — 공백만 다르든 완전히 동일하든 — 이벤트를 만들지 않는다
  }

  for (const before of existing) {
    if (!incomingByNodeKey.has(before.nodeKey)) {
      changes.push({ type: 'deleted', nodeKey: before.nodeKey, lawArticleId: before.lawArticleId, before });
    }
  }

  return changes;
}
