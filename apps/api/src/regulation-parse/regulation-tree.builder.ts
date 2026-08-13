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

/** 조항 번호 문자열로부터 기본 깊이 (법·소수점 계층). 보조 항목은 collect 단계에서 treeDepth로 보정 */
export function depthFromNorm(norm: string): number {
  if (norm.startsWith('L')) {
    return norm.includes('-') ? 1 : 0;
  }
  if (/^\d/.test(norm)) {
    return (norm.match(/\./g) || []).length;
  }
  return 0;
}

function structuralBaseDepth(norm: string): number {
  if (norm === 'PREAMBLE') return 0;
  if (norm.startsWith('L')) {
    return norm.includes('-') ? 1 : 0;
  }
  if (/^\d/.test(norm)) {
    return (norm.match(/\./g) || []).length;
  }
  return 0;
}

/** 원문자·가목·(1)·표 등: 직전 구조 조항보다 한 단계 깊게 스택에 쌓임 */
function isAncillary(norm: string): boolean {
  if (norm === 'PREAMBLE') return false;
  return (
    /^C\d+$/.test(norm) ||
    /^PN\d+$/.test(norm) ||
    /^Hp[가-힣]$/.test(norm) ||
    /^H[가-힣]$/.test(norm) ||
    norm.startsWith('T')
  );
}

export function matchHeader(line: string): { norm: string; title: string } | null {
  const s = line.trim();
  if (!s) return null;

  let m = s.match(/^제\s*(\d+)\s*조(?:의\s*(\d+))?[\s.:：\-）)]*(.*)$/);
  if (m) {
    const base = m[1];
    const sub = m[2];
    const rest = (m[3] || '').trim();
    const norm = sub ? `L${base}-${sub}` : `L${base}`;
    const title = rest || (sub ? `제${base}조의${sub}` : `제${base}조`);
    return { norm, title };
  }

  m = s.match(/^(\d+(?:\.\d+)*)[\s.)．:：]+(\S.*)$/);
  if (m) {
    const num = m[1];
    const rest = (m[2] || '').trim();
    if (/^\d/.test(rest)) return null;
    return { norm: num, title: rest };
  }

  const c0 = s.charAt(0);
  if (CIRCLED_MAP[c0]) {
    const rest = s.slice(1).replace(/^[\s.:：）]+/, '').trim();
    return { norm: `C${CIRCLED_MAP[c0]}`, title: rest || `항목 ${CIRCLED_MAP[c0]}` };
  }

  // 가·나·다 목 표기. 구분 문자로 공백을 허용하면 안 된다 —
  // "이 규정은 …", "그 밖에 …" 처럼 한 글자 + 공백으로 시작하는 평범한 본문이
  // 전부 목 마커로 잡혀 조 본문이 통째로 하위 노드로 빨려 들어간다.
  // 실제 목 표기는 언제나 구두점을 동반한다(가. 나) 다:).
  m = s.match(/^([가-힣])[.)．:：]\s*(\S.*)$/);
  if (m && HANGUL_ITEM_MARKERS.has(m[1])) {
    return { norm: `H${m[1]}`, title: (m[2] || '').trim() || m[1] };
  }

  m = s.match(/^\((\d+)\)[\s.:：]*(.*)$/);
  if (m) {
    return { norm: `PN${m[1]}`, title: (m[2] || '').trim() || `(${m[1]})` };
  }

  m = s.match(/^\(([가-힣])\)[\s.:：]*(.*)$/);
  if (m) {
    return { norm: `Hp${m[1]}`, title: (m[2] || '').trim() || `(${m[1]})` };
  }

  return null;
}

function isLikelyTableLine(s: string): boolean {
  const t = s.trim();
  return t.split('\t').length >= 4;
}

function flushSection(
  current: Omit<FlatSection, 'treeDepth'> | null,
  out: FlatSection[],
  lastStructuralDepthRef: { v: number },
): null {
  if (current && (current.content.trim() || current.title.trim())) {
    let treeDepth: number;
    if (isAncillary(current.norm)) {
      treeDepth = Math.max(0, lastStructuralDepthRef.v) + 1;
    } else if (current.norm === 'PREAMBLE') {
      treeDepth = 0;
    } else {
      treeDepth = structuralBaseDepth(current.norm);
      lastStructuralDepthRef.v = treeDepth;
    }
    out.push({
      ...current,
      content: current.content.trim(),
      treeDepth,
    });
  }
  return null;
}

/** 평문/라인 배열 → 플랫 섹션 */
export function collectFlatSections(lines: RegulationParseLine[]): FlatSection[] {
  const out: FlatSection[] = [];
  let current: Omit<FlatSection, 'treeDepth'> | null = null;
  const lastStructuralDepthRef = { v: 0 };

  for (const row of lines) {
    const line = row.text ?? '';
    const page = row.page ?? null;

    if (isLikelyTableLine(line) && current) {
      current.content += `\n${line}`;
      continue;
    }

    const head = matchHeader(line);
    if (head) {
      current = flushSection(current, out, lastStructuralDepthRef);
      current = {
        id: randomUUID(),
        norm: head.norm,
        title: head.title,
        content: '',
        page,
      };
      continue;
    }

    if (!current) {
      if (!line.trim()) continue;
      current = {
        id: randomUUID(),
        norm: 'PREAMBLE',
        title: '머리말',
        content: line.trimEnd(),
        page,
      };
      continue;
    }

    current.content += (current.content ? '\n' : '') + line.trimEnd();
  }
  flushSection(current, out, lastStructuralDepthRef);
  return out;
}

function nestSections(sections: FlatSection[]): RegulationArticleNode[] {
  const roots: RegulationArticleNode[] = [];
  const stack: RegulationArticleNode[] = [];
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
  const flat = collectFlatSections(lines);
  const filtered = flat.filter(
    (s) => s.norm !== 'PREAMBLE' || s.content.trim() || s.title.trim(),
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
