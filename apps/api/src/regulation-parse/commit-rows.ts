import { RegulationArticleNode, parseJoNorm } from './regulation-tree.builder';

/**
 * 파싱 트리 → 커밋할 Article 행 목록 (T-88).
 *
 * 이전에는 트리를 평탄화해 **모든 노드를 조(條)로** 만들었다. 그래서 법제처에서
 * 조>항>호 구조를 정확히 받아와도 `①`이 제2조, `1.`이 제3조가 되어 조 번호가 전부 어긋났다.
 *
 * 분류는 `depth`가 아니라 `articleNumber`(norm)로 한다. PDF 파서에서 `제1조의2`는
 * `L1-2`이면서 depth 1로 제1조의 **자식**으로 들어오기 때문에, depth만 보면 항으로 오인한다.
 * norm 어휘는 PDF 빌더와 법제처 매퍼가 공유한다:
 *
 * | norm            | 뜻            | 매핑                    |
 * |-----------------|---------------|-------------------------|
 * | `L1`, `L1-2`    | 조, 조의2     | 조 (번호 새로 부여)      |
 * | `C1`            | ①②…          | 항 (`clauseNumber`)     |
 * | `1`, `1.2`      | 호            | 목 (`itemNumber`)        |
 * | `H가`, `Hp가`   | 가. / (가)    | 목                       |
 * | `PN1`           | (1)           | 목                       |
 * | `P/CH/S/SS`+숫자 | 편·장·절·관   | 실제 Chapter / Section   |
 * | `T…`, `PREAMBLE` | 표, 머리말    | 조                       |
 *
 * 우리 모델은 조·항·목 3단인데 법령은 조>항>호>목 4단이다. 남는 한 단(호 아래 목)은
 * 행을 더 만들지 않고 **부모 행 본문에 이어 붙인다** — 가짜 조문을 만드는 것보다 낫다.
 *
 * 편·장·절·관도 마찬가지다. 우리 모델은 장>절 2단이라 편(編)에 해당하는 자리가 없다.
 * 편·장은 Chapter, 절·관은 Section으로 보내고, 조문을 하나도 못 받은 장·절은 버린다.
 * 그래서 "편 > 장 > 조"인 법령은 편이 사라지고 장이 최상위가 되며, 편만 있는 법령은
 * 편이 그대로 장이 된다 (T-89).
 */

export type CommitRow = {
  number: number;
  clauseNumber: number | null;
  itemNumber: number | null;
  title: string;
  content: string;
  /** `CommitPlan.chapters` 인덱스 */
  chapterIndex: number;
  /** 소속 장의 `sections` 인덱스. 절에 속하지 않으면 null */
  sectionIndex: number | null;
};

export type CommitAppendix = { kind: 'supplementary' | 'annex' | 'form'; title: string; body: string };

export type CommitPlan = {
  chapters: {
    number: number;
    title: string;
    /** 원문에 장 표기가 없어 우리가 만든 장이면 true (화면에서 숨긴다) */
    suppressHeader: boolean;
    sections: { number: number; title: string }[];
  }[];
  rows: CommitRow[];
  /** 첫 조 앞의 글(문서 제목·제정 연혁 등). 조문으로 만들지 않는다 — 만들면 조 번호가 한 칸씩 밀린다 */
  preamble: string;
  /** 부칙·별표·서식. 규정의 부칙·별표 탭으로 간다 */
  appendices: CommitAppendix[];
};

type Kind = 'jo' | 'hang' | 'mok' | 'chapter' | 'section' | 'preamble' | 'appendix';

const APPENDIX_KIND: Record<string, CommitAppendix['kind']> = {
  SUPP: 'supplementary',
  ANNEX: 'annex',
  FORM: 'form',
};

/** norm 문자열이 무엇인지 판정한다. 모르는 것은 조로 둔다(현재 동작 유지). */
export function classifyNorm(norm: string): Kind {
  const s = (norm || '').trim();
  if (s === 'PREAMBLE') return 'preamble';
  if (APPENDIX_KIND[s]) return 'appendix';
  // 편·장·절·관이 먼저다. `CH1`(장)은 `C…`(항)와, `P1`(편)은 `PN1`(괄호번호)과 앞글자가 겹친다.
  if (/^(P|CH)\d/.test(s)) return 'chapter';
  if (/^(SS|S)\d/.test(s)) return 'section';
  if (/^L\d/.test(s)) return 'jo';
  // 원문자 번호를 못 읽으면 매퍼가 `C①`처럼 라벨을 그대로 붙인다. 그래도 항이다.
  if (/^C/.test(s)) return 'hang';
  if (/^(Hp|H)./.test(s)) return 'mok';
  if (/^PN\d+$/.test(s)) return 'mok';
  if (/^\d/.test(s)) return 'mok'; // 호(1., 1.2)
  return 'jo';
}

/**
 * 화면에 보일 제목.
 *
 * 이전에는 `[${norm}] ${title}` 이라 내부 코드가 그대로 새어 나왔다(`[L1] 목적`, `[C1] `).
 * 번호는 이제 `number`/`clauseNumber`/`itemNumber`에 구조로 들어가므로 제목에 넣지 않는다.
 * 항·목은 제목 자체가 없다(본문만 있다).
 */
function titleFor(node: RegulationArticleNode, kind: Kind): string {
  if (kind !== 'jo') return '';
  return (node.articleTitle || '').trim().slice(0, 500);
}

/** 항·목 제목 칸에 올 수 있는 번호 표기. 이것만 있으면 버리고, 문장이 있으면 본문으로 살린다 */
const ITEM_LABEL_RE =
  /^(?:제\s*\d+(?:\s*의\s*\d+)?\s*[항호목]|[①-⑳]|\d+(?:\.\d+)*[.)．]?|[가-힣][.)．:：]?|\(\d+\)|\([가-힣]\)|항목\s*\d+|[항호목])$/;

/**
 * 항·목 본문. 번호는 구조(`clauseNumber`/`itemNumber`)로 들어가니 제목 칸의 번호 표기는 버린다.
 *
 * 제목 칸에 문장이 있으면 본문 앞에 붙인다. 예전 PDF 파서는 첫 줄을 제목 칸에 넣었고
 * (이미 저장된 미리보기 세션이 그 모양이다), 미리보기에서 사용자가 제목 칸에 쓸 수도 있다.
 */
function itemText(node: RegulationArticleNode): string {
  const title = (node.articleTitle || '').trim();
  const body = (node.content || '').trim();
  if (!title || ITEM_LABEL_RE.test(title)) return body;
  return body ? `${title} ${body}` : title;
}

const GANADA = '가나다라마바사아자차카타파하';

/** 항·호·목의 원문 번호(②→2, 3.→3, 다.→3). 가지 번호(1의2) 등 못 읽으면 0 */
function sourceIndex(norm: string): number {
  const s = norm.trim();
  const m = /^(?:C|PN)?(\d+)$/.exec(s);
  if (m) return Number(m[1]);
  const h = /^Hp?([가-힣])$/.exec(s);
  if (h) return GANADA.indexOf(h[1]) + 1;
  return 0;
}

/** 원문 번호가 앞으로 가면 그대로, 아니면 다음 번호 */
function nextIndex(prev: number, norm: string): number {
  const src = sourceIndex(norm);
  return src > prev ? src : prev + 1;
}

/** 자리를 못 받은 노드의 텍스트를 부모 행에 이어 붙인다 */
function appendTo(row: CommitRow, node: RegulationArticleNode): void {
  const label = (node.articleTitle || '').trim();
  const body = (node.content || '').trim();
  if (!label && !body) return;
  const line = label && body ? `${label} ${body}` : label || body;
  row.content = row.content ? `${row.content}\n${line}` : line;
}

export function buildCommitPlan(roots: RegulationArticleNode[]): CommitPlan {
  const chapters: CommitPlan['chapters'] = [];
  const rows: CommitRow[] = [];
  const preamble: string[] = [];
  const appendices: CommitAppendix[] = [];
  let joNumber = 0;
  let chapterIndex = -1;
  let sectionIndex: number | null = null;

  /** 조문이 나왔는데 열린 장이 없으면 원문에 장 표기가 없는 것이다. 숨김 장을 만든다. */
  const ensureChapter = (): number => {
    if (chapterIndex < 0) {
      chapters.push({ number: chapters.length + 1, title: '본문', suppressHeader: true, sections: [] });
      chapterIndex = chapters.length - 1;
      sectionIndex = null;
    }
    return chapterIndex;
  };

  const visit = (
    nodes: RegulationArticleNode[],
    ctx: {
      jo: number;
      hang: number | null;
      inMok: boolean;
      hangCount: { n: number };
      mokCount: { n: number };
      owner: CommitRow | null;
    },
  ): void => {
    for (const node of nodes) {
      const kind = classifyNorm(node.articleNumber);
      const children = node.children || [];

      if (kind === 'preamble') {
        const text = [(node.content || '').trim(), ...children.map(itemText)].filter(Boolean).join('\n');
        if (text) preamble.push(text);
        continue;
      }

      if (kind === 'appendix') {
        const body = [(node.content || '').trim(), ...children.map(itemText)].filter(Boolean).join('\n');
        appendices.push({
          kind: APPENDIX_KIND[node.articleNumber.trim()],
          title: (node.articleTitle || '').trim() || '부칙',
          body,
        });
        continue;
      }

      if (kind === 'chapter') {
        chapters.push({
          number: chapters.length + 1,
          title: (node.articleTitle || '').trim() || `제${chapters.length + 1}장`,
          suppressHeader: false,
          sections: [],
        });
        chapterIndex = chapters.length - 1;
        sectionIndex = null;
        visit(children, { jo: 0, hang: null, inMok: false, hangCount: { n: 0 }, mokCount: { n: 0 }, owner: null });
        continue;
      }

      if (kind === 'section') {
        const ci = ensureChapter();
        chapters[ci].sections.push({
          number: chapters[ci].sections.length + 1,
          title: (node.articleTitle || '').trim() || `제${chapters[ci].sections.length + 1}절`,
        });
        sectionIndex = chapters[ci].sections.length - 1;
        visit(children, { jo: 0, hang: null, inMok: false, hangCount: { n: 0 }, mokCount: { n: 0 }, owner: null });
        continue;
      }

      if (kind === 'jo') {
        const ci = ensureChapter();
        // 원문 조 번호를 그대로 쓴다. 삭제된 조로 번호가 비어도 "제5조"는 제5조여야 한다.
        // 번호가 앞으로 가지 않으면(조의2, 부칙처럼 다시 1부터, 미리보기에서 손댄 번호) 다음 번호를 준다.
        const src = parseJoNorm(node.articleNumber.trim());
        joNumber = src && src.branch === 0 && src.n > joNumber ? src.n : joNumber + 1;
        const row: CommitRow = {
          number: joNumber,
          clauseNumber: null,
          itemNumber: null,
          title: titleFor(node, 'jo'),
          content: (node.content || '').trim(),
          chapterIndex: ci,
          sectionIndex,
        };
        rows.push(row);
        visit(children, {
          jo: joNumber,
          hang: null,
          inMok: false,
          hangCount: { n: 0 },
          mokCount: { n: 0 },
          owner: row,
        });
        continue;
      }

      // 조 밖에서 나온 항·목은 붙일 조가 없다. 부모 행에 합쳐 텍스트를 잃지 않는다.
      // 부모도 없으면(조 표기 없이 "1. 2."로만 쓴 문서) 조로 올린다 — 예전엔 여기서 통째로 버렸다.
      if (ctx.jo === 0) {
        if (ctx.owner) {
          appendTo(ctx.owner, node);
          visit(children, ctx);
          continue;
        }
        const ci = ensureChapter();
        joNumber += 1;
        const label = (node.articleTitle || '').trim();
        const body = itemText(node);
        const row: CommitRow = {
          number: joNumber,
          clauseNumber: null,
          itemNumber: null,
          title: '',
          content: label && ITEM_LABEL_RE.test(label) && body ? `${label} ${body}` : body || label,
          chapterIndex: ci,
          sectionIndex,
        };
        rows.push(row);
        visit(children, { jo: joNumber, hang: null, inMok: false, hangCount: { n: 0 }, mokCount: { n: 0 }, owner: row });
        continue;
      }

      if (kind === 'hang' && !ctx.inMok) {
        // 원문 번호를 따른다 — "② … ③ <삭제>"가 ①·②로 당겨지면 안 된다
        ctx.hangCount.n = nextIndex(ctx.hangCount.n, node.articleNumber);
        const row: CommitRow = {
          number: ctx.jo,
          clauseNumber: ctx.hangCount.n,
          itemNumber: null,
          title: '',
          content: itemText(node),
          chapterIndex: ensureChapter(),
          sectionIndex,
        };
        rows.push(row);
        visit(children, { ...ctx, hang: ctx.hangCount.n, inMok: false, mokCount: { n: 0 }, owner: row });
        continue;
      }

      // 목: 이미 목 안이면(법령의 호 아래 목) 새 행을 만들지 않고 부모에 이어 붙인다
      if (ctx.inMok) {
        if (ctx.owner) appendTo(ctx.owner, node);
        visit(children, ctx);
        continue;
      }

      ctx.mokCount.n = nextIndex(ctx.mokCount.n, node.articleNumber);
      const row: CommitRow = {
        number: ctx.jo,
        // 상위 항이 없는 목은 항 번호를 비운다(전문 보기가 항 위치에 그린다)
        clauseNumber: ctx.hang,
        itemNumber: ctx.mokCount.n,
        title: '',
        content: itemText(node),
        chapterIndex: ensureChapter(),
        sectionIndex,
      };
      rows.push(row);
      visit(children, { ...ctx, inMok: true, owner: row });
    }
  };

  visit(roots, { jo: 0, hang: null, inMok: false, hangCount: { n: 0 }, mokCount: { n: 0 }, owner: null });

  return dropEmpty({ chapters, rows, preamble: preamble.join('\n'), appendices });
}

/**
 * 조문을 하나도 못 받은 장·절을 버리고 번호를 다시 매긴다.
 *
 * 편·장이 함께 있는 법령에서 편은 조문을 직접 갖지 않으므로 여기서 사라진다.
 * 우리 모델에 편 자리가 없어 생기는 손실이고, 대신 가짜 빈 장은 만들지 않는다.
 */
function dropEmpty(plan: CommitPlan): CommitPlan {
  const usedChapters = new Set(plan.rows.map((r) => r.chapterIndex));
  const usedSections = new Set(
    plan.rows.filter((r) => r.sectionIndex != null).map((r) => `${r.chapterIndex}:${r.sectionIndex}`),
  );

  const chapterMap = new Map<number, number>();
  const sectionMap = new Map<string, number>();
  const chapters: CommitPlan['chapters'] = [];

  plan.chapters.forEach((chapter, ci) => {
    if (!usedChapters.has(ci)) return;
    const sections: { number: number; title: string }[] = [];
    chapter.sections.forEach((section, si) => {
      if (!usedSections.has(`${ci}:${si}`)) return;
      sectionMap.set(`${ci}:${si}`, sections.length);
      sections.push({ ...section, number: sections.length + 1 });
    });
    chapterMap.set(ci, chapters.length);
    chapters.push({ ...chapter, number: chapters.length + 1, sections });
  });

  const rows = plan.rows.map((row) => ({
    ...row,
    chapterIndex: chapterMap.get(row.chapterIndex) ?? 0,
    sectionIndex:
      row.sectionIndex == null ? null : sectionMap.get(`${row.chapterIndex}:${row.sectionIndex}`) ?? null,
  }));

  return { chapters, rows, preamble: plan.preamble, appendices: plan.appendices };
}
