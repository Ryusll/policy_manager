import { randomUUID } from 'crypto';

/** PDF 추출 한 줄 (폰트 메타는 선택) */
export interface RegulationParseLine {
  text: string;
  page?: number | null;
  font_size?: number | null;
  font_name?: string | null;
  bold?: boolean | null;
}

/** API·DB(JSON)용 조항 트리 노드 */
export interface RegulationArticleNode {
  id: string;
  articleNumber: string;
  articleTitle: string;
  content: string;
  parentId: string | null;
  depth: number;
  pageNumber: number | null;
  sortOrder: number;
  children?: RegulationArticleNode[];
}

interface FlatSection {
  id: string;
  norm: string;
  title: string;
  content: string;
  page: number | null;
  treeDepth: number;
}

/** 목(目) 표기에 실제로 쓰이는 한글 — 가나다 순 14자. 그 밖의 글자는 본문으로 본다. */
const HANGUL_ITEM_MARKERS = new Set(
  ['가', '나', '다', '라', '마', '바', '사', '아', '자', '차', '카', '타', '파', '하'],
);

const CIRCLED_MAP: Record<string, number> = {};
for (let i = 0; i < 20; i += 1) {
  CIRCLED_MAP[String.fromCharCode(0x2460 + i)] = i + 1;
}

/**
 * 편·장·절·관 표기 → norm 코드. 법제처 매퍼(`lawgokr.mapper.ts`)와 같은 어휘를 쓴다.
 * 커밋 단계(`commit-rows.ts`)가 이 코드로 실제 Chapter/Section을 만든다.
 */
const HEADING_CODE: Record<string, string> = { 편: 'P', 장: 'CH', 절: 'S', 관: 'SS' };

/**
 * 헤딩은 조(0)보다 **얕아야** 조가 그 아래로 중첩된다. 그래서 음수를 쓴다.
 * 미리보기 들여쓰기는 `Math.max(depth, 0)`으로 클램프하므로 화면에는 영향이 없다.
 */
const HEADING_DEPTH: Record<string, number> = { P: -4, CH: -3, S: -2, SS: -1 };

/** 헤딩 norm이면 그 깊이를, 아니면 null */
function headingDepth(norm: string): number | null {
  const m = norm.match(/^(SS|CH|S|P)\d/);
  return m ? HEADING_DEPTH[m[1]] : null;
}

/**
 * 조문이 아닌 덩어리. 커밋 단계가 조문 대신 규정 설명(머리말)·부칙/별표/서식으로 보낸다.
 * 트리에서는 항상 최상위에 두고, 그 아래로 다른 노드를 매달지 않는다.
 */
const PREAMBLE = 'PREAMBLE';
export const APPENDIX_NORMS = ['SUPP', 'ANNEX', 'FORM'] as const;

function isRootOnly(norm: string): boolean {
  return norm === PREAMBLE || (APPENDIX_NORMS as readonly string[]).includes(norm);
}

/** "제3조의2" → { n: 3, branch: 2 }. 조가 아니면 null */
export function parseJoNorm(norm: string): { n: number; branch: number } | null {
  const m = /^L(\d+)(?:-(\d+))?$/.exec(norm);
  return m ? { n: Number(m[1]), branch: m[2] ? Number(m[2]) : 0 } : null;
}

/**
 * 계층 깊이. 조 0 > 항 1 > 호 2 > 목 3 > (1)·(가) 4 로 고정한다.
 *
 * 예전에는 호(`1.`)를 조와 같은 깊이 0으로 계산해 호가 조의 형제가 됐고,
 * 커밋 단계가 "붙을 조가 없는 호"로 보고 통째로 버렸다.
 */
function levelOf(norm: string, lastLevel: number): number {
  const h = headingDepth(norm);
  if (h != null) return h;
  if (isRootOnly(norm) || /^L\d/.test(norm)) return 0;
  if (/^C\d/.test(norm)) return 1;
  if (/^\d/.test(norm)) return 2 + (norm.match(/\./g) || []).length;
  if (/^H[가-힣]$/.test(norm)) return 3;
  if (/^(Hp[가-힣]|PN\d+)$/.test(norm)) return 4;
  return Math.max(0, lastLevel) + 1; // 표 등은 직전 항목 아래
}

/** 자간을 벌려 쓴 제목("총 칙", "이 사 회 규 정")을 붙여 쓴다. 일반 문장은 건드리지 않는다. */
export function collapseLetterSpacing(s: string): string {
  const t = s.trim();
  return /^[가-힣](?: [가-힣])+$/.test(t) ? t.replace(/ /g, '') : t;
}

/** 조 제목 자리에 온 글이 제목이 아니라 본문 문장인지 */
function looksLikeSentence(s: string): boolean {
  return s.length > 30 || /[.。]$|다$|다[\s,]/.test(s);
}

/**
 * 줄이 개정 표기 도중에 끊겼는지. "… 감독한다. <개정" 다음 줄의 "1999.4.9 >"는
 * 새 호가 아니라 앞 줄에 이어지는 날짜다.
 */
const OPEN_ANNOTATION_RE =
  /[<[［〈](?:\s*본조)?\s*(?:개정|신설|삭제|전문개정|제목개정|제정|시행|종전)[^>\]］〉]*$/;
function endsWithOpenAnnotation(text: string): boolean {
  const last = text.split('\n').pop() ?? '';
  return OPEN_ANNOTATION_RE.test(last);
}

/**
 * 줄 머리 표기 해석.
 *
 * - 편·장·절·관·조: `title`은 제목, `body`는 같은 줄에 이어 쓴 본문
 *   ("제1조(목적) 이 규정은 …" → title "목적", body "이 규정은 …").
 * - 항·호·목: `title`은 번호 표기("①", "1.", "가.")뿐이고 문장은 `body`다.
 *   법제처 매퍼와 같은 약속이다(제목 칸 = 번호, 본문 칸 = 문장). 예전에는 문장을
 *   제목 칸에 넣었고, 커밋은 항·목의 제목을 버리므로 첫 줄이 통째로 사라졌다.
 */
export function matchHeader(line: string): { norm: string; title: string; body?: string } | null {
  const s = line.trim();
  if (!s) return null;

  // 편·장·절·관을 조보다 먼저 본다. 이게 없으면 "제1장 총칙"이 헤더로 안 잡혀
  // 직전 조의 본문 끝에 그대로 눌어붙는다(T-89 ②).
  let m = s.match(/^제\s*(\d+)\s*(편|장|절|관)(?:\s*의\s*(\d+))?[\s.:：\-）)]*(.*)$/);
  if (m) {
    const [, number, kind, branch, rest] = m;
    const code = HEADING_CODE[kind];
    const label = branch ? `제${number}${kind}의${branch}` : `제${number}${kind}`;
    return {
      norm: branch ? `${code}${number}-${branch}` : `${code}${number}`,
      title: collapseLetterSpacing(rest || '') || label,
    };
  }

  // 조 번호 바로 뒤가 조사("제3조에 따라")면 다른 조를 가리키는 본문이 줄 첫머리로 넘어온 것이다.
  m = s.match(/^제\s*(\d+)\s*조(?:\s*의\s*(\d+))?(?=[\s(（.:：-]|$)(.*)$/);
  if (m) {
    const [, base, sub] = m;
    const rest = (m[3] || '').replace(/^[\s.:：-]+/, '');
    // "제5조 제1항에 따라 …" 도 참조 문장이다
    if (/^제\s*\d+\s*(?:항|호|조)/.test(rest)) return null;
    let title = '';
    let body = '';
    const paren = rest.match(/^[(（]\s*([^)）]*?)\s*[)）]\s*(.*)$/);
    if (paren) {
      title = paren[1];
      body = paren[2];
    } else if (rest) {
      if (looksLikeSentence(rest)) body = rest;
      else title = rest;
    }
    return { norm: sub ? `L${base}-${sub}` : `L${base}`, title: title.trim(), body: body.trim() };
  }

  // 호: "1." "1)" — 번호 뒤 마침표·괄호가 있어야 한다. 그래야 "3 개월 이내"처럼
  // 숫자로 시작하는 본문 줄이나 "1999.4.9 >"(줄바꿈된 개정 날짜)를 호로 오인하지 않는다.
  m = s.match(/^(\d{1,3})([.)．])\s*(\S.*)$/);
  if (m) {
    const rest = m[3].trim();
    if (/^\d/.test(rest) || /^[>\]）)]/.test(rest)) return null;
    return { norm: m[1], title: `${m[1]}${m[2] === '．' ? '.' : m[2]}`, body: rest };
  }
  // 개요식 번호 "1.2 제목"
  m = s.match(/^(\d{1,3}(?:\.\d{1,3})+)\.?\s+(\S.*)$/);
  if (m && !/^[>\]）)]/.test(m[2])) {
    return { norm: m[1], title: m[1], body: m[2].trim() };
  }

  const c0 = s.charAt(0);
  if (CIRCLED_MAP[c0]) {
    const rest = s.slice(1).replace(/^[\s.:：）)]+/, '').trim();
    return { norm: `C${CIRCLED_MAP[c0]}`, title: c0, body: rest };
  }

  // 가·나·다 목 표기. 구분 문자로 공백을 허용하면 안 된다 —
  // "이 규정은 …", "그 밖에 …" 처럼 한 글자 + 공백으로 시작하는 평범한 본문이
  // 전부 목 마커로 잡혀 조 본문이 통째로 하위 노드로 빨려 들어간다.
  // 실제 목 표기는 언제나 구두점을 동반한다(가. 나) 다:).
  m = s.match(/^([가-힣])([.)．:：])\s*(\S.*)$/);
  if (m && HANGUL_ITEM_MARKERS.has(m[1])) {
    return { norm: `H${m[1]}`, title: `${m[1]}${m[2] === '．' ? '.' : m[2]}`, body: m[3].trim() };
  }

  m = s.match(/^\((\d+)\)[\s.:：]*(.*)$/);
  if (m) {
    return { norm: `PN${m[1]}`, title: `(${m[1]})`, body: (m[2] || '').trim() };
  }

  // "(주)대한전자"처럼 괄호 안 한 글자로 시작하는 본문도 많다. 가나다 표기만 목으로 본다.
  m = s.match(/^\(([가-힣])\)[\s.:：]*(.*)$/);
  if (m && HANGUL_ITEM_MARKERS.has(m[1])) {
    return { norm: `Hp${m[1]}`, title: `(${m[1]})`, body: (m[2] || '').trim() };
  }

  return null;
}

/**
 * 부칙·별표·서식 머리 줄. 여기서부터 다음 부칙·별표·서식 전까지는 전부 그 덩어리의 본문이다.
 * 부칙은 "제1조(시행일)"처럼 조 번호를 다시 1부터 쓰므로, 본문 조로 받으면 번호가 엉킨다.
 */
export function matchAppendixHeader(line: string): { norm: string; title: string } | null {
  const t = line.trim();
  let m = t.match(/^부\s*칙\s*([<(（[［【].*)?$/);
  if (m) return { norm: 'SUPP', title: m[1] ? `부칙 ${m[1].trim()}` : '부칙' };

  // "[별표 1] 경조금 지급 기준" — "[별표 1]과 같다."처럼 본문이 줄 첫머리로 넘어온 경우는 제외
  const bracketed = (kind: string) =>
    t.match(new RegExp(`^[[［【]\\s*(${kind}[^\\]］】]*)[\\]］】]\\s*(.*)$`));
  for (const [norm, kind] of [
    ['ANNEX', '별\\s*표'],
    ['FORM', '별\\s*지'],
  ] as const) {
    m = bracketed(kind);
    if (m) {
      const after = (m[2] || '').trim();
      if (/^[과와에의를을은는이가로]/.test(after) || looksLikeSentence(after)) return null;
      const label = m[1].replace(/\s+/g, ' ').trim();
      return { norm, title: after ? `${label} ${after}` : label };
    }
  }
  return null;
}

function isLikelyTableLine(s: string): boolean {
  const t = s.trim();
  return t.split('\t').length >= 4;
}

/** 쪽 번호만 있는 줄: "3", "- 3 -", "3 / 10", "3쪽" */
const PAGE_NUMBER_RE = /^(?:[-–—]?\s*\d{1,4}\s*[-–—]?|\d{1,4}\s*\/\s*\d{1,4}|\d{1,4}\s*쪽|page\s*\d{1,4})$/i;
/** 목차의 점선 줄: "제1조(목적) ........ 1" */
const TOC_LEADER_RE = /(?:\.{4,}|·{3,}|…{2,}|‥{2,}|ㆍ{3,}|-{4,})\s*\d{1,4}\s*$/;

/**
 * 쪽마다 반복되는 머리말·꼬리말과 쪽 번호, 목차 점선 줄을 걷어 낸다.
 * 걷지 않으면 "… 정한다. 3 이사회규정"처럼 조문 본문 한가운데에 끼어든다.
 */
export function stripPageFurniture(lines: RegulationParseLine[]): RegulationParseLine[] {
  const drop = new Set<number>();
  const byPage = new Map<number, number[]>();
  lines.forEach((row, i) => {
    const t = (row.text ?? '').trim();
    if (!t) return;
    if (TOC_LEADER_RE.test(t) || /^(?:목\s*차|차\s*례)$/.test(t)) {
      drop.add(i);
      return;
    }
    if (row.page == null) return;
    const list = byPage.get(row.page) ?? [];
    list.push(i);
    byPage.set(row.page, list);
  });

  // 쪽 가장자리(앞뒤 두 줄)에 있는 쪽 번호
  for (const idx of byPage.values()) {
    for (const i of [...idx.slice(0, 2), ...idx.slice(-2)]) {
      if (PAGE_NUMBER_RE.test((lines[i].text ?? '').trim())) drop.add(i);
    }
  }

  // 여러 쪽의 첫 줄·끝 줄에 같은 글이 반복되면 머리말·꼬리말이다 (숫자는 쪽 번호일 수 있어 무시하고 비교)
  if (byPage.size >= 2) {
    const norm = (i: number) => (lines[i].text ?? '').replace(/\d+/g, '#').replace(/\s+/g, '');
    const pages = [...byPage.entries()].map(([page, idx]) => ({
      page,
      idx: idx.filter((i) => !drop.has(i)),
    }));
    for (const edge of ['first', 'last'] as const) {
      const counts = new Map<string, number>();
      for (const p of pages) {
        const i = edge === 'first' ? p.idx[0] : p.idx[p.idx.length - 1];
        if (i == null) continue;
        counts.set(norm(i), (counts.get(norm(i)) ?? 0) + 1);
      }
      for (const p of pages) {
        const i = edge === 'first' ? p.idx[0] : p.idx[p.idx.length - 1];
        if (i == null) continue;
        const c = counts.get(norm(i)) ?? 0;
        // 첫 쪽에 찍힌 같은 머리말도 지운다. 큰 글씨 제목은 대개 그 아래 따로 있다.
        if (c < 2 || c * 2 < pages.length) continue;
        drop.add(i);
      }
    }
  }
  return lines.filter((_, i) => !drop.has(i));
}

/** 평문/라인 배열 → 플랫 섹션 */
export function collectFlatSections(lines: RegulationParseLine[]): FlatSection[] {
  const out: FlatSection[] = [];
  let current: Omit<FlatSection, 'treeDepth'> | null = null;
  let lastLevel = 0;
  let inAppendix = false;
  let lastJo = 0;
  let lastBranch = 0;

  const flush = () => {
    if (current && (current.content.trim() || current.title.trim())) {
      const treeDepth = levelOf(current.norm, lastLevel);
      if (!isRootOnly(current.norm)) lastLevel = treeDepth;
      out.push({ ...current, content: current.content.trim(), treeDepth });
    }
    current = null;
  };

  const start = (norm: string, title: string, page: number | null) => {
    flush();
    current = { id: randomUUID(), norm, title, content: '', page };
  };

  const append = (text: string, sep: string) => {
    if (!current) return;
    current.content = current.content ? `${current.content}${sep}${text}` : text;
  };

  /** 조 머리를 받을지. 번호가 거꾸로 가면 다른 조를 가리키는 본문이 줄 첫머리로 넘어온 것이다. */
  const acceptJo = (norm: string): boolean => {
    const jo = parseJoNorm(norm);
    if (!jo) return true;
    if (jo.n === 1 && lastJo > 1) {
      // 1조로 되돌아왔다. 앞의 조들이 전부 본문 없이 제목뿐이면 목차였다 — 버리고 본문을 새로 받는다.
      const cur = current as Omit<FlatSection, 'treeDepth'> | null;
      const joSections = [...out, ...(cur ? [cur] : [])].filter((x) => parseJoNorm(x.norm));
      const empty = (x: { content: string }) => !x.content.trim() || /^\d{1,4}$/.test(x.content.trim());
      if (joSections.length >= 2 && joSections.every(empty)) {
        const keep = out.filter((x) => x.norm === PREAMBLE);
        out.length = 0;
        out.push(...keep);
        current = null;
      }
    } else if (jo.n < lastJo || (jo.n === lastJo && jo.branch <= lastBranch)) {
      return false;
    }
    lastJo = jo.n;
    lastBranch = jo.branch;
    return true;
  };

  const handle = (raw: string, page: number | null): void => {
    const line = raw.trim();
    if (!line) return;

    if (isLikelyTableLine(raw) && current) {
      append(raw.trimEnd(), '\n');
      return;
    }

    const appendixHead = matchAppendixHeader(line);
    if (appendixHead) {
      start(appendixHead.norm, appendixHead.title, page);
      inAppendix = true;
      return;
    }
    if (inAppendix && current) {
      append(line, '\n'); // 부칙·별표는 조문 구조를 그대로 글로 담는다
      return;
    }

    const cur = current as Omit<FlatSection, 'treeDepth'> | null;
    if (cur && endsWithOpenAnnotation(cur.content || cur.title)) {
      append(line, ' ');
      return;
    }

    const head = matchHeader(line);
    if (head && acceptJo(head.norm)) {
      start(head.norm, head.title, page);
      if (head.body) {
        const inner = parseJoNorm(head.norm) ? matchHeader(head.body) : null;
        // "제3조(휴가) ① 회사는 …" — 첫 항이 조 제목과 같은 줄에 온다
        if (inner && /^C\d/.test(inner.norm)) handle(head.body, page);
        else append(head.body, ' ');
      }
      return;
    }

    if (!current) {
      start(PREAMBLE, '머리말', page);
      append(collapseLetterSpacing(line), '\n');
      return;
    }
    // PDF의 줄바꿈은 대개 지면 폭 때문이다. 문단 안에서는 띄어 이어 붙인다.
    if ((current as Omit<FlatSection, 'treeDepth'>).norm === PREAMBLE) append(collapseLetterSpacing(line), '\n');
    else append(line, ' ');
  };

  for (const row of lines) handle(row.text ?? '', row.page ?? null);
  flush();
  return out;
}

function nestSections(sections: FlatSection[]): RegulationArticleNode[] {
  const roots: RegulationArticleNode[] = [];
  let stack: RegulationArticleNode[] = [];
  let sortOrder = 0;

  for (const sec of sections) {
    const d = sec.treeDepth;
    const node: RegulationArticleNode = {
      id: sec.id,
      articleNumber: sec.norm,
      articleTitle: sec.title,
      content: sec.content,
      parentId: null,
      depth: d,
      pageNumber: sec.page,
      sortOrder: sortOrder++,
      children: [],
    };

    // 머리말·부칙·별표는 늘 최상위이고, 뒤에 오는 노드가 그 아래로 들어가지 않는다
    if (isRootOnly(sec.norm)) {
      roots.push(node);
      stack = [];
      continue;
    }

    while (stack.length > 0 && stack[stack.length - 1].depth >= d) {
      stack.pop();
    }

    if (stack.length === 0) {
      roots.push(node);
    } else {
      const parent = stack[stack.length - 1];
      node.parentId = parent.id;
      if (!parent.children) parent.children = [];
      parent.children.push(node);
    }
    stack.push(node);
  }

  const stripEmptyChildren = (n: RegulationArticleNode) => {
    if (n.children?.length) {
      n.children.forEach(stripEmptyChildren);
    } else {
      delete n.children;
    }
  };
  roots.forEach(stripEmptyChildren);
  return roots;
}

export function buildRegulationTreeFromLines(lines: RegulationParseLine[]): { roots: RegulationArticleNode[] } {
  const flat = collectFlatSections(stripPageFurniture(lines));
  const filtered = flat.filter(
    (s) => s.norm !== PREAMBLE || s.content.trim() || s.title.trim(),
  );
  return { roots: nestSections(filtered.length ? filtered : flat) };
}

export function buildRegulationTreeFromPlainText(text: string): { roots: RegulationArticleNode[] } {
  const lines: RegulationParseLine[] = text
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((t) => ({ text: t, page: null }));
  return buildRegulationTreeFromLines(lines);
}
