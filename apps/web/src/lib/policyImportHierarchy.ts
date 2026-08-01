/**
 * 가져오기(Import) 결과의 조문 본문에서 항(①②…)·목(1. 2. …)을 인식해
 * 조·항·목 계층 행으로 분해한다.
 *
 * 배경: 파서는 조 단위(number/title/content)까지만 만들고 항·목은 본문 텍스트에 섞여 있었다.
 * 그래서 가져온 뒤 규정 상세에서 전부 수동 구조편집을 해야 했다(개발정의서 8.3의 명시된 한계).
 * 이 모듈이 그 연결고리를 메운다.
 *
 * 표기 규칙은 `legalArticleLabel.ts`와 동일하다: 항 = ①~⑳, 목 = 1. 2. …
 */

export type HierarchyArticleRow = {
  number: number;
  title?: string;
  content?: string;
  clauseNumber?: number;
  itemNumber?: number;
};

type SourceArticle = {
  number: number;
  title?: string;
  content?: string;
  [key: string]: unknown;
};

type SourceChapter<A> = {
  number: number;
  title?: string;
  articles: A[];
  [key: string]: unknown;
};

/** ①(U+2460) ~ ⑳(U+2473) */
const CIRCLED_START = 0x2460;
const CIRCLED_END = 0x2473;

function circledToNumber(ch: string): number | null {
  const code = ch.codePointAt(0);
  if (code == null) return null;
  if (code < CIRCLED_START || code > CIRCLED_END) return null;
  return code - CIRCLED_START + 1;
}

/** 줄 앞 항 번호(①…)를 떼어낸다. 매칭 실패 시 null */
function matchClauseLine(line: string): { clauseNumber: number; rest: string } | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  const clauseNumber = circledToNumber(trimmed[0]);
  if (clauseNumber == null) return null;
  return { clauseNumber, rest: trimmed.slice(1).trim() };
}

/**
 * 줄 앞 목 번호(1. / 2) …)를 떼어낸다.
 * "1.2" 같은 십진 조항이나 "2026. 1. 1." 같은 날짜를 목으로 오인하지 않도록 보수적으로 매칭한다.
 */
function matchItemLine(line: string): { itemNumber: number; rest: string } | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  const m = /^(\d{1,2})[.)]\s+(.*)$/.exec(trimmed);
  if (!m) return null;
  const itemNumber = Number(m[1]);
  if (!Number.isFinite(itemNumber) || itemNumber < 1 || itemNumber > 99) return null;
  const rest = m[2].trim();
  // "1. 2. 3." 처럼 뒤가 또 숫자로 시작하면 십진 번호일 가능성이 높아 목으로 보지 않음
  if (/^\d+[.)]/.test(rest)) return null;
  return { itemNumber, rest };
}

/**
 * 조문 1건(조 단위)을 조 루트 + 항 + 목 행들로 분해한다.
 * 항·목 패턴이 전혀 없으면 원본 1행을 그대로 돌려준다(동작 변화 없음).
 */
export function inferArticleHierarchy(article: SourceArticle): HierarchyArticleRow[] {
  const raw = String(article.content ?? '');
  const lines = raw.split(/\r?\n/);

  const joLead: string[] = []; // 첫 항 이전의 본문 = 조 본문
  const rows: HierarchyArticleRow[] = [];
  let currentClause: number | null = null;
  let sawHierarchy = false;

  const appendToLast = (text: string) => {
    if (!rows.length) {
      joLead.push(text);
      return;
    }
    const last = rows[rows.length - 1];
    last.content = [last.content ?? '', text].filter((s) => String(s).length).join('\n');
  };

  for (const line of lines) {
    const clause = matchClauseLine(line);
    if (clause) {
      sawHierarchy = true;
      currentClause = clause.clauseNumber;
      rows.push({
        number: article.number,
        clauseNumber: clause.clauseNumber,
        content: clause.rest,
      });
      continue;
    }

    // 목은 상위 항이 있을 때만 인식한다(부모 없는 목 행을 만들지 않음)
    if (currentClause != null) {
      const item = matchItemLine(line);
      if (item) {
        sawHierarchy = true;
        rows.push({
          number: article.number,
          clauseNumber: currentClause,
          itemNumber: item.itemNumber,
          content: item.rest,
        });
        continue;
      }
    }

    if (!line.trim()) {
      // 빈 줄은 이어지는 본문의 단락 구분으로만 유지
      if (rows.length || joLead.length) appendToLast('');
      continue;
    }
    appendToLast(line.trim());
  }

  if (!sawHierarchy) {
    // 계층 신호가 없으면 기존 동작 유지
    return [
      {
        number: article.number,
        title: article.title,
        content: raw,
      },
    ];
  }

  const joContent = joLead.join('\n').trim();
  const head: HierarchyArticleRow = {
    number: article.number,
    title: article.title,
    content: joContent,
  };

  // 조 루트(제목/도입문) + 항·목 행
  const cleaned = rows.map((r) => ({
    ...r,
    content: String(r.content ?? '').trim(),
  }));

  return [head, ...cleaned];
}

/**
 * 장 목록 전체에 항·목 추론을 적용한다.
 * 조 번호(number)는 그대로 유지되므로, 재번호(renumber) 처리 뒤에 호출해야 한다.
 */
export function expandChaptersWithHierarchy<A extends SourceArticle>(
  chapters: SourceChapter<A>[],
): SourceChapter<HierarchyArticleRow>[] {
  return chapters.map((chapter) => ({
    ...chapter,
    articles: chapter.articles.flatMap((article) => inferArticleHierarchy(article)),
  }));
}

/** 미리보기용 통계: 추론으로 만들어질 항·목 개수 */
export function countInferredHierarchy(chapters: SourceChapter<SourceArticle>[]): {
  clauses: number;
  items: number;
} {
  let clauses = 0;
  let items = 0;
  for (const chapter of chapters) {
    for (const article of chapter.articles) {
      for (const row of inferArticleHierarchy(article)) {
        if (row.itemNumber != null) items += 1;
        else if (row.clauseNumber != null) clauses += 1;
      }
    }
  }
  return { clauses, items };
}
