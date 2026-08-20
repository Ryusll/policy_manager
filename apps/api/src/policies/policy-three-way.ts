/**
 * 3단비교 (T-56) — 규정 · 세칙 · 지침을 나란히 본다.
 *
 * 국가법령정보센터의 3단비교는 법률 옆에 시행령·시행규칙을 붙여 보여준다. 연결 근거는
 * 하위 법령이 상위법을 인용하는 문구다("법 제5조에 따라"). 사내 규정도 같아서,
 * 세칙·지침 본문의 **상위 규정 인용**을 찾아 짝짓는다.
 *
 * 인용에는 반드시 상위 문서를 가리키는 말이 붙어야 한다("규정 제5조", "인사관리규정 제5조").
 * 맨 `제5조`는 대개 자기 문서 안을 가리키므로 짝짓지 않는다 — 억지로 엮으면
 * 엉뚱한 조문이 나란히 놓여 대비표를 못 믿게 된다.
 *
 * 짝을 못 찾은 하위 조문은 버리지 않고 맨 뒤 "연결 안 됨"으로 내보낸다.
 */

export type ThreeWayArticle = {
  id: string;
  number: number;
  clauseNumber: number | null;
  itemNumber: number | null;
  title: string;
  content: string;
};

export type ThreeWayPolicy = {
  id: string;
  code: string;
  title: string;
  /** 기준 규정으로부터의 깊이. 0 = 기준(규정), 1 = 세칙, 2 = 지침 */
  level: number;
};

export type ThreeWayRelated = {
  policyId: string;
  level: number;
  article: ThreeWayArticle;
};

export type ThreeWayRow = {
  /** 기준 규정의 조 번호. 연결 안 된 행은 null */
  number: number | null;
  base: ThreeWayArticle | null;
  related: ThreeWayRelated[];
};

/**
 * 상위 규정 인용 패턴.
 *
 * 앞에 오는 말이 상위 문서를 가리켜야 한다: `…규정`(인사관리규정·이 규정 등) / `법` / `영` / `본칙`.
 * `세칙 제3조`처럼 자기 문서를 가리키는 말은 일부러 뺐다.
 */
const UPPER_REF_RE = /(?:[가-힣A-Za-z0-9]{0,30}규정|본칙|법|영)\s*제\s*(\d+)\s*조(?:\s*의\s*(\d+))?/g;

/** 본문에서 인용된 상위 조 번호들을 순서대로 뽑는다 */
export function extractUpperRefs(text: string): number[] {
  const out: number[] = [];
  if (!text) return out;
  UPPER_REF_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = UPPER_REF_RE.exec(text)) !== null) {
    const n = Number(m[1]);
    if (Number.isFinite(n) && n > 0 && !out.includes(n)) out.push(n);
  }
  return out;
}

/** 조 → 항 → 목 순 */
function byPosition(a: ThreeWayArticle, b: ThreeWayArticle): number {
  return (
    a.number - b.number ||
    (a.clauseNumber ?? -1) - (b.clauseNumber ?? -1) ||
    (a.itemNumber ?? -1) - (b.itemNumber ?? -1)
  );
}

export function buildThreeWayRows(
  base: ThreeWayArticle[],
  descendants: { policy: ThreeWayPolicy; articles: ThreeWayArticle[] }[],
): { rows: ThreeWayRow[]; unmatched: ThreeWayRow[]; matchedCount: number } {
  // 기준은 조 단위로만 세운다. 항·목까지 열을 만들면 표가 읽히지 않는다.
  const baseJo = base.filter((a) => a.clauseNumber == null && a.itemNumber == null).sort(byPosition);
  const rowByNumber = new Map<number, ThreeWayRow>();
  const rows: ThreeWayRow[] = baseJo.map((article) => {
    const row: ThreeWayRow = { number: article.number, base: article, related: [] };
    rowByNumber.set(article.number, row);
    return row;
  });

  const unmatchedByPolicy = new Map<string, ThreeWayRow>();
  let matchedCount = 0;

  for (const { policy, articles } of descendants) {
    for (const article of [...articles].sort(byPosition)) {
      // 하위에서도 조 루트만 짝짓는다(항·목은 조에 딸려 읽는다)
      if (article.clauseNumber != null || article.itemNumber != null) continue;

      const refs = extractUpperRefs(`${article.title}\n${article.content}`);
      const target = refs.map((n) => rowByNumber.get(n)).find(Boolean);

      if (target) {
        target.related.push({ policyId: policy.id, level: policy.level, article });
        matchedCount += 1;
        continue;
      }

      let bucket = unmatchedByPolicy.get(policy.id);
      if (!bucket) {
        bucket = { number: null, base: null, related: [] };
        unmatchedByPolicy.set(policy.id, bucket);
      }
      bucket.related.push({ policyId: policy.id, level: policy.level, article });
    }
  }

  return { rows, unmatched: [...unmatchedByPolicy.values()], matchedCount };
}
