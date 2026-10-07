/**
 * 시행일 없이 발행된 버전의 시행일 보정 계획 (PAT-02).
 *
 * 예전 PDF·법제처 가져오기와 JSON 일괄 등록은 첫 버전을 시행일 없이 발행했다. 시점 조회
 * 규칙(common/as-of.ts)은 시행일이 있어야 버전을 고르므로, 그런 조문은 시점 조회와 법령
 * 개정 분석에서 기준 본문이 되지 못한다. 날짜를 지어내 자동으로 채우지 않고(승인일·생성일은
 * 실제 시행일이 아니다) 관리자가 확인한 날짜로 채운다.
 *
 * 그 날짜가 같은 조문의 다른 시행본과 순서가 어긋나면 거부한다 — 앞 버전보다 이르거나
 * 뒤 버전보다 늦은 날짜를 넣으면 시점 조회가 옛 본문과 새 본문을 거꾸로 고른다.
 */

export type FillCandidate = {
  id: string;
  articleId: string;
  versionNum: number;
  effectiveDate: Date | null;
};

export type FillConflict = {
  articleId: string;
  reason: 'multiple-missing' | 'after-later-version' | 'before-earlier-version';
  /** 순서 충돌일 때 걸린 다른 버전의 시행일(YYYY-MM-DD) */
  boundary?: string;
};

export type FillPlan = { updateIds: string[]; conflicts: FillConflict[] };

const day = (d: Date) => d.toISOString().slice(0, 10);

/** @param versions 한 규정의 시행 이력이 있는 버전(published·archived)만 */
export function planEffectiveDateFill(versions: FillCandidate[], date: Date): FillPlan {
  const byArticle = new Map<string, FillCandidate[]>();
  for (const v of versions) {
    const list = byArticle.get(v.articleId) ?? [];
    list.push(v);
    byArticle.set(v.articleId, list);
  }

  const updateIds: string[] = [];
  const conflicts: FillConflict[] = [];
  for (const [articleId, list] of byArticle) {
    const missing = list.filter((v) => v.effectiveDate === null);
    if (missing.length === 0) continue;
    if (missing.length > 1) {
      // 날짜 하나로는 여러 시행본의 선후를 표현할 수 없다 — 버전마다 따로 확인해야 한다
      conflicts.push({ articleId, reason: 'multiple-missing' });
      continue;
    }
    const target = missing[0];
    const dated = list.filter((v): v is FillCandidate & { effectiveDate: Date } => v.effectiveDate !== null);
    const later = dated.filter((v) => v.versionNum > target.versionNum).map((v) => v.effectiveDate.getTime());
    const earlier = dated.filter((v) => v.versionNum < target.versionNum).map((v) => v.effectiveDate.getTime());
    if (later.length && date.getTime() > Math.min(...later)) {
      conflicts.push({ articleId, reason: 'after-later-version', boundary: day(new Date(Math.min(...later))) });
      continue;
    }
    if (earlier.length && date.getTime() < Math.max(...earlier)) {
      conflicts.push({ articleId, reason: 'before-earlier-version', boundary: day(new Date(Math.max(...earlier))) });
      continue;
    }
    updateIds.push(target.id);
  }
  return { updateIds, conflicts };
}
