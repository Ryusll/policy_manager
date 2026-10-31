/**
 * 법령조항 `nodeKey`(`조/항/호`, 예: `60//` = 제60조, `60/1/` = 제60조제1항, `60/1/3` = 그 제3호)의 형식과 위아래 (T-148).
 *
 * 연결(LawLink)은 조·항·호 어느 단계에나 걸린다. 인용 자동 찾기는 '제60조'를 조 머리 행(`60//`)에 잇는데,
 * 항이 여럿인 조는 머리 행 본문이 비어 있어 개정 이벤트가 항(`60/1/`)에만 생긴다. 그래서 영향을 볼 때는
 * "바뀐 조항과 그 위 조항"에 건 연결을 함께 본다. 아래로는 넓히지 않는다 — 항에 건 연결은 조 머리 행의 변경과
 * 무관하다(항이 여럿인 조의 머리 행은 본문이 없고, 바뀌는 것은 각 항이다).
 *
 * 형식 해석은 `parseNodeKey` 하나다 — 표기(`law-rows.ts` 의 labelFromNodeKey)와 위아래 계산이 같은 규칙을 쓴다.
 * nodeKey 는 언제나 `buildLawArticleRows` 가 만들고 변경 이벤트는 그 값을 옮겨 적으므로, 형식이 어긋난 키는 정상
 * 흐름에서 생기지 않는다. 생기면 위아래가 없는 키(자기 자신만)로 다룬다.
 *
 * DB 를 모르는 순수 함수다(같은 패턴: law-rows.ts·law-change-detect.ts).
 */

/** `buildLawArticleRows` 가 만드는 형식 — 조(가지번호 `의N`) / 항(없으면 빈칸) / 호(가지번호, 없으면 빈칸) */
const NODE_KEY_RE = /^(\d+)(?:의(\d+))?\/(\d*)\/(?:(\d+)(?:의(\d+))?)?$/;

export type ParsedNodeKey = {
  /** 조 부분 그대로(`3`, `3의2`) */
  jo: string;
  joNo: number;
  joBranch: number | null;
  /** 항 번호 문자열 — 없으면 '' */
  clause: string;
  /** 호 부분 그대로(`2`, `1의2`) — 없으면 '' */
  item: string;
  itemNo: number | null;
  itemBranch: number | null;
};

/** 형식에 맞으면 조·항·호로 나누고, 어긋나면 null */
export function parseNodeKey(nodeKey: string): ParsedNodeKey | null {
  const m = NODE_KEY_RE.exec(nodeKey);
  if (!m) return null;
  const [, joNo, joBranch, clause, itemNo, itemBranch] = m;
  return {
    jo: joBranch ? `${joNo}의${joBranch}` : joNo,
    joNo: Number(joNo),
    joBranch: joBranch ? Number(joBranch) : null,
    clause,
    item: itemNo ? (itemBranch ? `${itemNo}의${itemBranch}` : itemNo) : '',
    itemNo: itemNo ? Number(itemNo) : null,
    itemBranch: itemBranch ? Number(itemBranch) : null,
  };
}

/** 자신과 상위 조항 — 가까운 것부터. `60/1/3` → [`60/1/3`, `60/1/`, `60//`]. 형식이 어긋나면 자신만 */
export function selfAndAncestorNodeKeys(nodeKey: string): string[] {
  const p = parseNodeKey(nodeKey);
  if (!p) return [nodeKey];
  const keys = [nodeKey];
  if (p.item && p.clause) keys.push(`${p.jo}/${p.clause}/`);
  if (p.item || p.clause) keys.push(`${p.jo}//`);
  return keys;
}

/**
 * 이 조항과 그 아래 조항의 `nodeKey` 가 모두 시작하는 머리말 — 조 `60//` → `60/`, 항 `60/1/` → `60/1/`.
 * 호 아래에는 행이 없어(목은 호 본문에 합친다) null. 머리말 끝의 `/` 때문에 제600조·제60조의2·제10항을 덮지 않는다.
 * 형식에 맞는 키에서는 `K.startsWith(descendantPrefix(L))` ⇔ `selfAndAncestorNodeKeys(K)` 에 L 이 있음(시험으로 고정)
 */
export function descendantPrefix(nodeKey: string): string | null {
  const p = parseNodeKey(nodeKey);
  if (!p || p.item) return null;
  return p.clause ? `${p.jo}/${p.clause}/` : `${p.jo}/`;
}

/** 단계 — 조 0, 항 1, 호 2(항 없이 조 바로 아래의 호도 2). 형식이 어긋나면 0 */
export function nodeKeyDepth(nodeKey: string): number {
  const p = parseNodeKey(nodeKey);
  if (!p) return 0;
  return p.item ? 2 : p.clause ? 1 : 0;
}

/**
 * 조문마다 연결 하나 — 바뀐 조항에 가장 가까운(깊은) 연결. 같은 조문이 조와 항에 함께 걸려 있으면 항 연결을 쓴다.
 * 바뀐 조항의 위쪽 사슬에는 단계마다 조항이 하나뿐이라 같은 깊이의 연결이 둘일 수 없다
 */
export function closestPerArticle<T extends { articleId: string; nodeKey: string }>(links: T[]): T[] {
  const best = new Map<string, T>();
  for (const l of links) {
    const cur = best.get(l.articleId);
    if (!cur || nodeKeyDepth(l.nodeKey) > nodeKeyDepth(cur.nodeKey)) best.set(l.articleId, l);
  }
  return [...best.values()];
}
