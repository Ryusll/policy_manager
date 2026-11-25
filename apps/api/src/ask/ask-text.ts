import { formatJo } from '../common/article-label';

/**
 * T-130 규정 근거 AI 질의응답 — DB·AI 를 부르지 않는 순수 함수 모음.
 *
 * 흐름: 질문 → ① 조 목차(규정명·조 제목)에서 AI 가 관련 조를 고르고 질문 낱말이 든 조를 더한다
 * → ② 고른 조의 본문만 참조 번호(R1, R2 …)를 붙여 AI 에 주고 답과 근거 번호를 받는다
 * → ③ 준 번호 밖의 근거는 버리고, 남는 근거가 없으면 답을 내보내지 않는다.
 */

/** 본문을 읽을 조 수 상한(AI 가 고른 것 + 낱말이 든 것) — 외부 전송 고지에도 실린다(바꾸면 고지 판을 올린다, T-146) */
export const ASK_MAX_GROUPS = 12;

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

/** 근거 요약이 비었을 때 서버가 쓰는 문장(T-207) — 인용한 조문을 규정별로 모은다 */
export function basisSentence(rows: Pick<AskRow, 'policyTitle' | 'number' | 'branchNumber'>[]): string {
  const byPolicy = new Map<string, string[]>();
  for (const r of rows) {
    const jo = formatJo(r.number, r.branchNumber);
    const list = byPolicy.get(r.policyTitle) ?? [];
    if (!list.includes(jo)) list.push(jo);
    byPolicy.set(r.policyTitle, list);
  }
  if (!byPolicy.size) return '';
  return `근거 규정은 ${[...byPolicy].map(([title, jos]) => `${title} ${jos.join('·')}`).join(', ')}입니다.`;
}

// ─── 답 블록 ─────────────────────────────────────────────────────────────────

/** 검토 표의 판단 — 이 여섯 값만 쓴다(SEARCH-7). 화면은 값마다 색을 정해 둔다 */
export const VERDICTS = ['부합', '대체로 부합', '부분 부합', '보완 필요', '추가 확인 필요', '해당 없음'] as const;
export type Verdict = (typeof VERDICTS)[number];

/** 검토 표 한 행 — 머리(검토 영역·관련 법령·기준·현재 규정 상태·판단·개정·보완 권고)는 화면이 정한다 */
export interface ReviewRow {
  area: string;
  law: string;
  current: string;
  verdict: Verdict;
  advice: string;
}

/**
 * 화면에 내는 답 블록. T-207 부터 답은 늘 [직답 문단, 검토 표, 우선 권고(또는 핵심 정리), 종합 의견 문단, 근거 요약 문단]
 * 순서다(`ask-report.ts`). 문단의 굵게는 `**` 짝으로만 표시한다. list·table 은 T-207 전 기록의 모양이다.
 */
export type AnswerBlock =
  | { type: 'paragraph'; text: string }
  | { type: 'list'; items: string[] }
  | { type: 'table'; headers: string[]; rows: string[][] }
  | { type: 'review'; rows: ReviewRow[] }
  | { type: 'priorities'; kind: 'amend' | 'summary'; items: { title: string; detail: string }[] };
