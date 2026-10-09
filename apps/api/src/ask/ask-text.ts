import { formatJo } from '../common/article-label';

/**
 * T-130 규정 근거 AI 질의응답 — DB·AI 를 부르지 않는 순수 함수 모음.
 *
 * 흐름: 질문 → ① 조 목차(규정명·조 제목)에서 AI 가 관련 조를 고르고 질문 낱말이 든 조를 더한다
 * → ② 고른 조의 본문만 참조 번호(R1, R2 …)를 붙여 AI 에 주고 답과 근거 번호를 받는다
 * → ③ 준 번호 밖의 근거는 버리고, 남는 근거가 없으면 답을 내보내지 않는다.
 */

/** 시행 중인 조문 한 행(조 머리·항·호). 본문은 지금 시행 중인 버전의 것 */
export interface AskRow {
  articleId: string;
  policyId: string;
  policyTitle: string;
  policyCode: string;
  number: number;
  branchNumber: number | null;
  clauseNumber: number | null;
  itemNumber: number | null;
  title: string;
  content: string;
}

/** 조 하나(같은 규정·조 번호·가지 번호) — 목차와 근거 묶음의 단위 */
export interface JoGroup {
  key: string;
  policyId: string;
  policyTitle: string;
  policyCode: string;
  number: number;
  branchNumber: number | null;
  title: string;
  rows: AskRow[];
}

export const joKey = (policyId: string, number: number, branchNumber: number | null) =>
  `${policyId}:${number}:${branchNumber ?? 0}`;

/** 조 → 항 → 호 순서. 조 머리(항·호 없음)가 맨 앞 */
const rowOrder = (a: AskRow, b: AskRow) =>
  (a.clauseNumber ?? 0) - (b.clauseNumber ?? 0) || (a.itemNumber ?? 0) - (b.itemNumber ?? 0);

/** 행을 조 단위로 묶는다. 순서는 규정명 → 조 번호 → 가지 번호 */
export function groupRows(rows: AskRow[]): JoGroup[] {
  const map = new Map<string, JoGroup>();
  for (const r of rows) {
    const key = joKey(r.policyId, r.number, r.branchNumber);
    let g = map.get(key);
    if (!g) {
      g = {
        key,
        policyId: r.policyId,
        policyTitle: r.policyTitle,
        policyCode: r.policyCode,
        number: r.number,
        branchNumber: r.branchNumber,
        title: '',
        rows: [],
      };
      map.set(key, g);
    }
    g.rows.push(r);
    if (r.clauseNumber == null && r.itemNumber == null && r.title.trim()) g.title = r.title.trim();
  }
  const groups = [...map.values()];
  for (const g of groups) g.rows.sort(rowOrder);
  return groups.sort(
    (a, b) =>
      a.policyTitle.localeCompare(b.policyTitle, 'ko') ||
      a.policyId.localeCompare(b.policyId) ||
      a.number - b.number ||
      (a.branchNumber ?? 0) - (b.branchNumber ?? 0),
  );
}

/** "제12조의2 제1항 제3호" — 근거 표시와 AI 에 주는 본문에 같이 쓴다 */
export function rowLabel(r: Pick<AskRow, 'number' | 'branchNumber' | 'clauseNumber' | 'itemNumber'>): string {
  return `${formatJo(r.number, r.branchNumber)}${r.clauseNumber ? ` 제${r.clauseNumber}항` : ''}${
    r.itemNumber ? ` 제${r.itemNumber}호` : ''
  }`;
}

// ─── 질문 낱말 ────────────────────────────────────────────────────────────────

/** 길이가 긴 것부터 떼어야 "에서는"이 "는"만 떨어지지 않는다 */
const ENDINGS = [
  '하려면', '하는데', '되나요', '하나요', '인가요', '합니까', '입니까', '으로부터', '에서는', '에게서', '으로는',
  '이라도', '이라면', '까지는', '부터는', '하면', '되면', '할때', '일때', '인지', '해야', '에서', '에게', '으로',
  '까지', '부터', '처럼', '보다', '라도', '이란', '이나', '에는', '과는', '와는', '은', '는', '이', '가', '을',
  '를', '에', '의', '로', '와', '과', '도', '만', '요',
].sort((a, b) => b.length - a.length);

/** 규정 본문 어디에나 나오거나 질문 말투라서 찾는 데 도움이 안 되는 말 */
const STOPWORDS = new Set([
  '알려줘', '알려주세요', '알려', '주세요', '뭐야', '뭐예요', '무엇', '무엇인가요', '어떻게', '어떤', '있나요',
  '있어', '있는지', '되는지', '하는지', '관련', '대해', '대한', '대해서', '내용', '규정', '기준', '경우', '사항',
  '우리', '회사', '직원', '얼마', '언제', '누가', '어디', '궁금', '궁금해', '궁금합니다', '좀', '그리고',
  '있나', '없나', '되나', '하나', '할까', '될까', '있을까', '있다', '없다', '인가', '어떻', '수',
]);

/**
 * 질문에서 찾을 낱말을 뽑는다(최대 8개). 형태소 분석기 없이 조사·어미를 떼는 정도라 완벽하지 않다 —
 * 주된 근거 찾기는 AI 가 목차에서 고르는 쪽이고, 이것은 목차 제목에 드러나지 않은 본문 낱말을 보탠다.
 */
export function questionKeywords(question: string): string[] {
  const out: string[] = [];
  for (const raw of question.split(/[\s,.?!·()[\]{}"'“”‘’:;/~]+/)) {
    let w = raw.trim();
    if (!w) continue;
    for (const end of ENDINGS) {
      if (w.length - end.length >= 2 && w.endsWith(end)) {
        w = w.slice(0, -end.length);
        break;
      }
    }
    if (w.length < 2 || STOPWORDS.has(w) || /^\d+$/.test(w)) continue;
    if (!out.includes(w)) out.push(w);
    if (out.length >= 8) break;
  }
  return out;
}

// ─── AI 에 주는 글 ────────────────────────────────────────────────────────────

/** 목차 키 — 규정 id 를 그대로 주면 길고 AI 가 옮겨 적다 틀린다. 짧은 순번을 쓴다 */
export interface TocEntry {
  key: string;
  group: JoGroup;
}

/** 목차 한 줄: `K12 | 인사규정 | 제12조(경조금)` */
export function buildToc(groups: JoGroup[], maxChars: number): { text: string; entries: TocEntry[]; truncated: boolean } {
  const entries: TocEntry[] = [];
  const lines: string[] = [];
  let size = 0;
  let truncated = false;
  groups.forEach((g, i) => {
    if (truncated) return;
    const key = `K${i + 1}`;
    const line = `${key} | ${g.policyTitle} | ${formatJo(g.number, g.branchNumber)}${g.title ? `(${g.title})` : ''}`;
    if (size + line.length + 1 > maxChars) {
      truncated = true;
      return;
    }
    size += line.length + 1;
    lines.push(line);
    entries.push({ key, group: g });
  });
  return { text: lines.join('\n'), entries, truncated };
}

/** 근거로 줄 수 있는 행 하나 — 참조 번호와 함께 화면에도 그대로 쓴다 */
export interface RefRow {
  ref: string;
  row: AskRow;
}

/**
 * 고른 조의 본문을 참조 번호를 붙여 하나의 글로 만든다. `maxChars` 를 넘으면 뒤쪽 조를 뺀다
 * (조를 고른 순서가 관련도 순서다). 한 조는 쪼개지 않는다 — 항 하나만 주면 조 머리의 단서를 놓친다.
 */
export function buildContext(groups: JoGroup[], maxChars: number): { text: string; refs: RefRow[]; used: JoGroup[] } {
  const refs: RefRow[] = [];
  const used: JoGroup[] = [];
  const parts: string[] = [];
  let size = 0;
  for (const g of groups) {
    const lines: string[] = [];
    const local: RefRow[] = [];
    for (const row of g.rows) {
      const ref = `R${refs.length + local.length + 1}`;
      const head = row.clauseNumber == null && row.itemNumber == null;
      const body = [head && row.title.trim() ? `(${row.title.trim()})` : '', row.content.trim()].filter(Boolean).join(' ');
      lines.push(`[${ref}] ${rowLabel(row)} ${body}`.trimEnd());
      local.push({ ref, row });
    }
    const block = `<규정 이름="${g.policyTitle}" 코드="${g.policyCode}">\n${lines.join('\n')}\n</규정>`;
    if (used.length > 0 && size + block.length > maxChars) break;
    size += block.length + 1;
    parts.push(block);
    refs.push(...local);
    used.push(g);
  }
  return { text: parts.join('\n'), refs, used };
}

// ─── AI 답 검사 ───────────────────────────────────────────────────────────────

export type AnswerBlock =
  | { type: 'paragraph'; text: string }
  | { type: 'list'; items: string[] }
  | { type: 'table'; headers: string[]; rows: string[][] };

export interface CheckedAnswer {
  answerable: boolean;
  blocks: AnswerBlock[];
  /** 준 참조 번호 중 실제로 있는 것만, 처음 나온 순서대로 */
  citations: string[];
  /** 준 적 없는 번호를 근거로 댄 수 — 기록용 */
  droppedCitations: number;
}

const LIMIT = { blocks: 30, items: 50, rows: 50, cols: 8, chars: 2000 };

/** 본문에 섞여 나온 참조 번호 표기([R3], (R3), R3)는 지운다 — 근거는 따로 보여 준다 */
const cleanText = (v: unknown): string =>
  typeof v === 'string'
    ? v
        .replace(/[[(]\s*R\d+(?:\s*[,，]\s*R\d+)*\s*[\])]/g, '')
        .replace(/\s{2,}/g, ' ')
        .trim()
        .slice(0, LIMIT.chars)
    : '';

const strings = (v: unknown, max: number): string[] =>
  Array.isArray(v) ? v.map(cleanText).filter(Boolean).slice(0, max) : [];

/**
 * AI 가 낸 JSON 을 화면에 낼 모양으로 거른다. 형식이 틀린 블록은 버리고, 준 번호 밖의 근거도 버린다.
 * **근거가 하나도 남지 않으면 답하지 않은 것으로 본다** — 근거 없는 답은 규정 해석으로 오해받는다.
 */
export function checkAnswer(raw: unknown, allowedRefs: Set<string>): CheckedAnswer {
  const obj = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const blocks: AnswerBlock[] = [];
  for (const b of Array.isArray(obj.blocks) ? obj.blocks.slice(0, LIMIT.blocks) : []) {
    if (!b || typeof b !== 'object') continue;
    const blk = b as Record<string, unknown>;
    if (blk.type === 'paragraph') {
      const text = cleanText(blk.text);
      if (text) blocks.push({ type: 'paragraph', text });
    } else if (blk.type === 'list') {
      const items = strings(blk.items, LIMIT.items);
      if (items.length) blocks.push({ type: 'list', items });
    } else if (blk.type === 'table') {
      const headers = (Array.isArray(blk.headers) ? blk.headers : []).map(cleanText).slice(0, LIMIT.cols);
      const width = headers.length;
      const rows = (Array.isArray(blk.rows) ? blk.rows : [])
        .slice(0, LIMIT.rows)
        .map((r) => (Array.isArray(r) ? r.map(cleanText).slice(0, LIMIT.cols) : []))
        .filter((r) => r.some(Boolean))
        .map((r) => (width ? [...r, ...Array(Math.max(0, width - r.length)).fill('')].slice(0, width) : r));
      if (rows.length) blocks.push({ type: 'table', headers, rows });
    }
  }
  const asked = Array.isArray(obj.citations) ? obj.citations.filter((c): c is string => typeof c === 'string') : [];
  const citations: string[] = [];
  let dropped = 0;
  for (const c of asked) {
    const ref = c.trim().replace(/^\[|\]$/g, '');
    if (!allowedRefs.has(ref)) {
      dropped += 1;
      continue;
    }
    if (!citations.includes(ref)) citations.push(ref);
  }
  const answerable = obj.answerable === true && blocks.length > 0 && citations.length > 0;
  return { answerable, blocks: answerable ? blocks : [], citations: answerable ? citations : [], droppedCitations: dropped };
}
