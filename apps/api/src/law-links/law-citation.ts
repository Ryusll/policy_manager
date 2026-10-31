import { numberWithBranch } from '../laws/law-rows';

/**
 * 본문에서 「OO법 제N조」 형태의 인용을 찾아 후보를 만든다(T-101 suggest).
 *
 * 완벽한 파서가 아니다 — 거짓 양성(다른 뜻의 "법"으로 끝나는 낱말)과 거짓 음성(괄호 안
 * 인용, 약칭 인용 등)이 있을 수 있다. 그래서 결과는 항상 `confirmState: suggested`로
 * 저장하고 사람이 확인하게 한다([[ADR-0021]] — 확정된 관계만 영향 분석에 쓴다).
 */
export type LawCitation = {
  /** 「」 안의 법령명 또는 앞에 붙은 법령명 원문 */
  lawName: string;
  articleNo: number;
  articleBranch: number | null;
  clauseNo: number | null;
  itemNo: number | null;
  itemBranch: number | null;
  /** 매칭된 원문 조각 — 근거 문구(evidenceText)로 쓴다 */
  matchedText: string;
};

/**
 * 법령명 + 제N조(의M)(제N항)(제N호(의M)) 패턴.
 *
 * 법령명은 대괄호(「」)로 감싸인 경우를 우선 잡고, 없으면 "OO법" 형태의 낱말을 그대로
 * 쓴다. 공백·가운뎃점 없는 2~20자로 제한해 "관계법" · "해당법" 같은 일반 명사의
 * 오탐을 줄인다(완전히 막지는 못한다 — 그래서 suggested 로만 만든다).
 */
const CITATION_RE =
  /(?:「([가-힣]{2,20}법)」|(?<![가-힣])([가-힣]{2,20}법))\s*제(\d+)조(?:의(\d+))?(?:\s*제(\d+)항)?(?:\s*제(\d+)호(?:의(\d+))?)?/g;

export function extractLawCitations(text: string | null | undefined): LawCitation[] {
  if (!text) return [];
  const out: LawCitation[] = [];
  for (const m of text.matchAll(CITATION_RE)) {
    const lawName = m[1] || m[2];
    if (!lawName) continue;
    out.push({
      lawName,
      articleNo: Number(m[3]),
      articleBranch: m[4] ? Number(m[4]) : null,
      clauseNo: m[5] ? Number(m[5]) : null,
      itemNo: m[6] ? Number(m[6]) : null,
      itemBranch: m[7] ? Number(m[7]) : null,
      matchedText: m[0],
    });
  }
  return out;
}

/** 인용 후보를 `LawArticle.nodeKey` 형식으로 — `law-rows.ts`와 같은 규칙이어야 한다 */
export function citationNodeKey(c: LawCitation): string {
  const article = numberWithBranch(c.articleNo, c.articleBranch);
  const item = c.itemNo != null ? numberWithBranch(c.itemNo, c.itemBranch) : '';
  return `${article}/${c.clauseNo ?? ''}/${item}`;
}
