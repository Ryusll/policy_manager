import { RegulationArticleNode } from '../regulation-parse/regulation-tree.builder';
import { classifyNorm } from '../regulation-parse/commit-rows';
import { lawVersionKey } from './law-version-key';

/**
 * 법제처 조항 트리 → `LawArticle` 행 (T-100).
 *
 * `norm`(articleNumber) 어휘와 분류는 사내 규정 가져오기(`commit-rows.ts`)와 **같은 것을 쓴다**.
 * 같은 매퍼(`lawgokr.mapper.ts`)가 만든 트리이므로 판정 규칙이 갈라지면 안 된다.
 *
 * 사내 규정 쪽과 다른 점이 둘 있다.
 *
 *  1. **조 번호를 새로 매기지 않는다.** 사내 규정은 1부터 다시 세지만, 법령조항은
 *     "근로기준법 제60조"라는 원문 번호 자체가 식별자다. 번호를 바꾸면 연결(T-101)이
 *     가리키는 대상이 원문과 달라진다.
 *  2. **가지번호를 살린다.** 제3조와 제3조의2 는 다른 조문이다. `articleNo Int` 로는
 *     구분할 수 없어서 식별은 `nodeKey` 문자열로 한다.
 *
 * 우리 모델은 조·항·호 3단이고 법령은 조>항>호>목 4단이다. 남는 목(가./나.)은 행을
 * 더 만들지 않고 **부모 행 본문에 이어 붙인다** — `commit-rows.ts` 와 같은 판단이다.
 * 목 본문이 부모 지문에 포함되므로 목이 개정돼도 변경 감지는 걸린다.
 */
export type LawArticleRow = {
  /** 조·항·호를 한 문자열로 (`3의2/1/2` = 제3조의2 제1항 제2호, `5//` = 제5조) */
  nodeKey: string;
  articleNo: number;
  clauseNo: number | null;
  itemNo: number | null;
  /** 사람이 읽는 표기 */
  label: string;
  title: string | null;
  content: string;
  versionKey: string;
  sortOrder: number;
};

export type LawRowsResult = {
  rows: LawArticleRow[];
  /** 조 번호를 읽을 수 없어 건너뛴 노드 수 (별표 안내문 등) */
  skipped: number;
};

/** `L3` → {no:3}, `L3-2` → {no:3, branch:2}. 번호를 못 읽으면 null */
function parseJo(norm: string): { no: number; branch: number | null } | null {
  const m = /^L(\d+)(?:-(\d+))?$/.exec((norm || '').trim());
  if (!m) return null;
  return { no: Number(m[1]), branch: m[2] ? Number(m[2]) : null };
}

/** `C1` → 1. 원문자를 못 읽어 `C①` 로 온 경우는 null (번호 없는 항으로 취급) */
function parseHang(norm: string): number | null {
  const m = /^C(\d+)$/.exec((norm || '').trim());
  return m ? Number(m[1]) : null;
}

/** `1` → {no:1}, `1.2` → {no:1, branch:2} (제1호의2) */
function parseHo(norm: string): { no: number; branch: number | null } | null {
  const m = /^(\d+)(?:\.(\d+))?$/.exec((norm || '').trim());
  if (!m) return null;
  return { no: Number(m[1]), branch: m[2] ? Number(m[2]) : null };
}

/**
 * 식별자용 — `3`, `3의2`.
 *
 * `law-links`(T-101)의 인용 추출기가 같은 규칙으로 `nodeKey`를 재구성해야 하므로
 * export 한다 — 두 곳이 각자 구현하면 표기가 갈라질 수 있다.
 */
export function numberWithBranch(no: number, branch: number | null): string {
  return branch ? `${no}의${branch}` : String(no);
}

/**
 * 사람이 읽는 표기. 가지번호는 **단위 뒤**에 붙는다 — `제3조의2`이지 `제3의2조`가 아니다.
 * 호도 같다(`제1호의2`).
 */
function ordinalLabel(no: number, branch: number | null, unit: '조' | '호'): string {
  return branch ? `제${no}${unit}의${branch}` : `제${no}${unit}`;
}

/**
 * `nodeKey` → 사람이 읽는 표기. `buildLawArticleRows` 가 만드는 표기의 역함수다
 * (`3의2/1/2` → `제3조의2제1항제2호`, `5//` → `제5조`).
 *
 * 조문이 법령에서 사라져 `LawArticle` 행이 없는 변경 이벤트(T-103 `deleted`)도 "어느 조문이었는지"
 * 보여야 해서 둔다. 같은 `ordinalLabel` 을 써서 등록 때의 표기와 갈라지지 않는다.
 * 형식이 어긋나면 nodeKey 를 그대로 돌려준다 — 빈칸보다 낫다.
 */
export function labelFromNodeKey(nodeKey: string): string {
  const m = /^(\d+)(?:의(\d+))?\/(\d*)\/(?:(\d+)(?:의(\d+))?)?$/.exec(nodeKey);
  if (!m) return nodeKey;
  const [, jo, joBranch, clause, ho, hoBranch] = m;
  let label = ordinalLabel(Number(jo), joBranch ? Number(joBranch) : null, '조');
  if (clause) label += `제${Number(clause)}항`;
  if (ho) label += ordinalLabel(Number(ho), hoBranch ? Number(hoBranch) : null, '호');
  return label;
}

/** 자리를 못 받은 노드(목 등)의 텍스트를 부모 행 본문에 이어 붙인다 */
function appendTo(row: LawArticleRow, node: RegulationArticleNode): void {
  const label = (node.articleTitle || '').trim();
  const body = (node.content || '').trim();
  if (!label && !body) return;
  const line = label && body ? `${label} ${body}` : label || body;
  row.content = row.content ? `${row.content}\n${line}` : line;
}

export function buildLawArticleRows(roots: RegulationArticleNode[]): LawRowsResult {
  const rows: LawArticleRow[] = [];
  let skipped = 0;

  const emit = (
    fields: Omit<LawArticleRow, 'versionKey' | 'sortOrder'>,
  ): LawArticleRow => {
    const row: LawArticleRow = { ...fields, versionKey: '', sortOrder: rows.length };
    rows.push(row);
    return row;
  };

  /** 현재 열려 있는 조. 항·호는 이 맥락 위에서 만들어진다 */
  type JoCtx = { no: number; branch: number | null; label: string };

  const visitHo = (nodes: RegulationArticleNode[], jo: JoCtx, clause: number | null, clauseLabel: string) => {
    for (const node of nodes) {
      const kind = classifyNorm(node.articleNumber);
      const children = node.children || [];
      if (kind !== 'mok') {
        // 호 자리에 조·항이 오는 일은 없지만, 오면 텍스트를 잃지 않게 부모에 붙인다
        const owner = rows[rows.length - 1];
        if (owner) appendTo(owner, node);
        if (children.length && owner) children.forEach((c) => appendTo(owner, c));
        continue;
      }
      const ho = parseHo(node.articleNumber);
      if (!ho) {
        // `H가` · `PN1` — 목이다. 직전 행(호 또는 항)에 이어 붙인다
        const owner = rows[rows.length - 1];
        if (owner) appendTo(owner, node);
        children.forEach((c) => owner && appendTo(owner, c));
        continue;
      }
      const printed = numberWithBranch(ho.no, ho.branch);
      const row = emit({
        nodeKey: `${numberWithBranch(jo.no, jo.branch)}/${clause ?? ''}/${printed}`,
        articleNo: jo.no,
        clauseNo: clause,
        itemNo: ho.no,
        label: `${clauseLabel}${ordinalLabel(ho.no, ho.branch, '호')}`,
        title: null,
        content: (node.content || '').trim(),
      });
      // 호 아래 목은 행을 만들지 않고 호 본문에 합친다
      for (const child of children) appendTo(row, child);
    }
  };

  const visitHang = (nodes: RegulationArticleNode[], jo: JoCtx) => {
    for (const node of nodes) {
      const kind = classifyNorm(node.articleNumber);
      const children = node.children || [];

      if (kind === 'hang') {
        const no = parseHang(node.articleNumber);
        const label = no ? `${jo.label}제${no}항` : jo.label;
        emit({
          nodeKey: `${numberWithBranch(jo.no, jo.branch)}/${no ?? ''}/`,
          articleNo: jo.no,
          clauseNo: no,
          itemNo: null,
          label,
          title: null,
          content: (node.content || '').trim(),
        });
        visitHo(children, jo, no, label);
        continue;
      }

      if (kind === 'mok') {
        // 항 번호가 없는 조는 매퍼가 호를 조의 직속 자식으로 올린다
        visitHo([node], jo, null, jo.label);
        continue;
      }

      // 조 아래 조·장 같은 예상 밖 노드 — 텍스트만 직전 행에 살린다
      const owner = rows[rows.length - 1];
      if (owner) appendTo(owner, node);
    }
  };

  const visit = (nodes: RegulationArticleNode[]) => {
    for (const node of nodes) {
      const kind = classifyNorm(node.articleNumber);
      const children = node.children || [];

      // 편·장·절은 법령조항이 아니다. 내려가기만 한다
      if (kind === 'chapter' || kind === 'section') {
        visit(children);
        continue;
      }

      const jo = parseJo(node.articleNumber);
      if (!jo) {
        // 별표 안내문 등 조 번호가 없는 행. 가짜 조문을 만들지 않는다
        skipped += 1;
        continue;
      }

      const ctx: JoCtx = {
        no: jo.no,
        branch: jo.branch,
        label: ordinalLabel(jo.no, jo.branch, '조'),
      };
      emit({
        nodeKey: `${numberWithBranch(jo.no, jo.branch)}//`,
        articleNo: jo.no,
        clauseNo: null,
        itemNo: null,
        label: ctx.label,
        title: (node.articleTitle || '').trim() || null,
        content: (node.content || '').trim(),
      });
      visitHang(children, ctx);
    }
  };

  visit(roots);
  for (const row of rows) row.versionKey = lawVersionKey(row.content);
  return { rows, skipped };
}
