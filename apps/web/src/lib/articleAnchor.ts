/**
 * 조문 안정 링크 (T-73).
 *
 * 기존 링크는 `#article-<uuid>` 였다. 규정을 다시 가져오면 UUID가 전부 바뀌어
 * 사내 위키·메일에 붙여둔 링크가 통째로 죽는다. 조 번호는 그대로 남으므로
 * **번호 기준**으로 가리킨다.
 *
 * 형식 두 가지를 모두 받는다:
 * - `#제3조`, `#제3조제1항`, `#제3조제1항제2목` — 사람이 인용하는 그대로라 읽고 고치기 쉽다
 * - `?jo=3&hang=1&mok=2` — 자동 생성·기계 처리용
 *
 * 옛 `#article-<uuid>` 도 계속 받는다. 이미 나간 링크를 깨뜨리지 않는다.
 */

export type ArticleAnchor = {
  jo: number;
  hang: number | null;
  mok: number | null;
};

export type AnchorTarget = {
  number: number;
  clauseNumber?: number | null;
  itemNumber?: number | null;
};

/** `제3조제1항제2목` — 숫자 부분만 쓰므로 항 표기는 ①이 아니라 `제1항`이다(주소창에서 깨지지 않는다) */
export function formatArticleAnchor(article: AnchorTarget): string {
  let out = `제${article.number}조`;
  if (article.clauseNumber != null) out += `제${article.clauseNumber}항`;
  if (article.itemNumber != null) out += `제${article.itemNumber}목`;
  return out;
}

/** 주소에 넣을 해시(`#` 포함). 한글은 브라우저가 알아서 인코딩한다. */
export function articleHash(article: AnchorTarget): string {
  return `#${formatArticleAnchor(article)}`;
}

const KO_RE = /^제\s*(\d+)\s*조(?:\s*제\s*(\d+)\s*항)?(?:\s*제\s*(\d+)\s*목)?$/;

/**
 * 해시·쿼리 문자열에서 조·항·목을 뽑는다. 못 읽으면 null.
 * `hash`는 `#` 유무 상관없고, 퍼센트 인코딩도 받는다.
 */
export function parseArticleAnchor(input: {
  hash?: string | null;
  search?: string | null;
}): ArticleAnchor | null {
  const raw = (input.hash || '').replace(/^#/, '').trim();
  if (raw) {
    let decoded = raw;
    try {
      decoded = decodeURIComponent(raw);
    } catch {
      /* 잘못된 인코딩이면 원문으로 시도한다 */
    }
    const m = decoded.replace(/\s+/g, '').match(KO_RE);
    if (m) {
      return {
        jo: Number(m[1]),
        hang: m[2] ? Number(m[2]) : null,
        mok: m[3] ? Number(m[3]) : null,
      };
    }
  }

  const params = new URLSearchParams((input.search || '').replace(/^\?/, ''));
  const jo = Number(params.get('jo'));
  if (Number.isFinite(jo) && jo > 0) {
    const hang = Number(params.get('hang'));
    const mok = Number(params.get('mok'));
    return {
      jo,
      hang: Number.isFinite(hang) && hang > 0 ? hang : null,
      mok: Number.isFinite(mok) && mok > 0 ? mok : null,
    };
  }
  return null;
}

/** 옛 형식 `#article-<uuid>` 의 id. 아니면 null */
export function parseLegacyArticleId(hash?: string | null): string | null {
  const raw = (hash || '').replace(/^#/, '').trim();
  return raw.startsWith('article-') ? raw.slice('article-'.length) || null : null;
}

/**
 * 앵커가 가리키는 조문을 찾는다.
 *
 * 정확히 일치하는 것이 없으면 **같은 조의 루트**로 물러선다. 항·목이 개정으로
 * 사라져도 최소한 해당 조는 열리게 하려는 것이다 — 아무 데도 안 가는 것보다 낫다.
 */
export function findByAnchor<T extends AnchorTarget>(articles: T[], anchor: ArticleAnchor): T | null {
  const sameJo = articles.filter((a) => a.number === anchor.jo);
  if (!sameJo.length) return null;

  const exact = sameJo.find(
    (a) =>
      (a.clauseNumber ?? null) === anchor.hang && (a.itemNumber ?? null) === anchor.mok,
  );
  if (exact) return exact;

  if (anchor.hang != null && anchor.mok != null) {
    const hangOnly = sameJo.find(
      (a) => (a.clauseNumber ?? null) === anchor.hang && a.itemNumber == null,
    );
    if (hangOnly) return hangOnly;
  }
  return sameJo.find((a) => a.clauseNumber == null && a.itemNumber == null) ?? sameJo[0];
}
