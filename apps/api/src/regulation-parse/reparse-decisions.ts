/**
 * 재파싱 검토의 결정 규칙 — DB 없는 계산 (T-110, 도 6 S640~S641).
 *
 * - 그대로(same)는 결정할 것이 없다.
 * - 옮김: 받아들임·새 조문·보류 / 같은 자리 본문 변경: 개정·새 조문·보류 / 판정 보류: 후보 고르기·새 조문·보류 /
 *   새 조문 후보: 새 조문·기존 조문에 잇기(원문에 없는 조문 중에서)·보류 / 원문에 없음: 그대로 둠·폐지(관리자) 또는 미결.
 * - **한 기존 조문은 한 항목만** 가리킨다 — 하나의 조문 식별자를 여러 새 조문에 배정하지 않는다(분할·병합은 보류로).
 * - 이어진(고르기·잇기) 원문에 없는 조문은 그대로 둠·폐지를 따로 정하지 않는다.
 */

export const ITEM_DECISIONS: Record<string, readonly string[]> = {
  same: [],
  moved: ['accept', 'new', 'hold'],
  changed: ['amend', 'new', 'hold'],
  ambiguous: ['pick', 'new', 'hold'],
  new: ['new', 'link', 'hold'],
  missing: ['keep', 'repeal'],
};

/** 결정해야 반영할 수 있는 항목 — 원문에 없음은 "삭제 여부 미결"로 남을 수 있다 */
export const NEEDS_DECISION = new Set(['moved', 'changed', 'ambiguous', 'new']);

export interface DecisionItem {
  id: string;
  kind: string;
  articleId: string | null;
  candidates: string[];
  decision: string | null;
  targetArticleId: string | null;
  label: string;
}

export interface DecisionError {
  itemId: string;
  message: string;
}

/** 이 항목이 차지하는 기존 조문 — 새 조문으로 돌린 짝은 차지하지 않는다 */
export function claimOf(item: DecisionItem): string | null {
  if (item.kind === 'missing') return null;
  if (item.decision === 'pick' || item.decision === 'link') return item.targetArticleId;
  if ((item.kind === 'same' || item.kind === 'moved' || item.kind === 'changed') && item.decision !== 'new') return item.articleId;
  return null;
}

/**
 * `changed` 를 주면 권한 규칙(폐지는 관리자)은 이번에 바꾸는 항목에만 적용한다 — 관리자가 정해 둔 폐지가 있다고
 * 편집자가 다른 항목을 정하지 못하면 안 된다. 나머지 규칙은 결과 상태 전체에 적용한다.
 */
export function validateDecisions(items: DecisionItem[], role: string, changed?: Set<string>): DecisionError[] {
  const errors: DecisionError[] = [];
  const missingByArticle = new Map(items.filter((i) => i.kind === 'missing' && i.articleId).map((i) => [i.articleId as string, i]));
  const claims = new Map<string, DecisionItem[]>();
  for (const item of items) {
    const allowed = ITEM_DECISIONS[item.kind] ?? [];
    if (item.decision != null && !allowed.includes(item.decision)) {
      errors.push({ itemId: item.id, message: `${item.label}: 이 항목에는 "${item.decision}" 결정을 할 수 없습니다.` });
      continue;
    }
    const needsTarget = item.decision === 'pick' || item.decision === 'link';
    if (!needsTarget && item.targetArticleId) {
      errors.push({ itemId: item.id, message: `${item.label}: 고르기·잇기가 아니면 기존 조문을 지정하지 않습니다.` });
      continue;
    }
    if (item.decision === 'pick' && (!item.targetArticleId || !item.candidates.includes(item.targetArticleId))) {
      errors.push({ itemId: item.id, message: `${item.label}: 후보 중에서 골라야 합니다.` });
      continue;
    }
    if (item.decision === 'link' && (!item.targetArticleId || !missingByArticle.has(item.targetArticleId))) {
      errors.push({ itemId: item.id, message: `${item.label}: 원문에 없는 기존 조문 중에서 이어야 합니다.` });
      continue;
    }
    if (item.decision === 'repeal' && role !== 'admin' && (!changed || changed.has(item.id))) {
      errors.push({ itemId: item.id, message: `${item.label}: 폐지는 관리자만 정할 수 있습니다.` });
      continue;
    }
    const claim = claimOf(item);
    if (claim) claims.set(claim, [...(claims.get(claim) ?? []), item]);
  }
  for (const [articleId, holders] of claims) {
    if (holders.length > 1) {
      for (const h of holders.slice(1)) {
        errors.push({ itemId: h.id, message: `${h.label}: 같은 기존 조문을 다른 항목(${holders[0].label})이 이미 가리킵니다.` });
      }
    }
    const missing = missingByArticle.get(articleId);
    if (missing && missing.decision != null) {
      errors.push({ itemId: missing.id, message: `${missing.label}: 다른 항목에 이어진 조문이라 그대로 둠·폐지를 정하지 않습니다.` });
    }
  }
  return errors;
}

/** 반영 전에 결정이 남은 항목 수 */
export function undecidedCount(items: Pick<DecisionItem, 'kind' | 'decision'>[]): number {
  return items.filter((i) => NEEDS_DECISION.has(i.kind) && i.decision == null).length;
}
