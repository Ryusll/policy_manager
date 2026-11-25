// 시연 데이터 채우기(T-216) — 시연 규정 파일(scripts/demo/policies/*.json)을 읽고 검사하고, 가져오기 본문과 인용 목록으로 바꾼다.
// 시연 규정은 직접 쓴 예시다(실제 회사 사규·저작권 있는 표준안 원문이 아니다). 인용은 실제 법령 조항을 항·호까지 가리킨다.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { citeNodeKey } from './law-match.mjs';

/** 가져오기 이력(sourceName)의 표시 — 이 스크립트가 만든 규정만 지우고 다시 넣는 근거다(`veda-demo-seed:HR-01`) */
export const SOURCE_PREFIX = 'veda-demo-seed';
export const sourceNameOf = (code) => `${SOURCE_PREFIX}:${code}`;

export const DEFAULT_DATA_DIR = fileURLToPath(new URL('../policies/', import.meta.url));

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const isText = (v) => typeof v === 'string' && v.trim() !== '';

/** 파일 꼴 검사 — 문제를 글로 돌려준다(없으면 빈 배열) */
export function validateDemoPolicies(entries) {
  const problems = [];
  const codes = new Set();
  for (const { file, doc } of entries) {
    const at = (msg) => problems.push(`${file}: ${msg}`);
    if (!isText(doc?.code) || doc.code.length > 80) at('code 가 없거나 80자를 넘는다');
    else if (codes.has(doc.code)) at(`code 가 겹친다: ${doc.code}`);
    else codes.add(doc.code);
    if (!isText(doc?.title)) at('title 이 없다');
    if (!DATE_RE.test(doc?.effectiveDate ?? '')) at('effectiveDate(YYYY-MM-DD)가 없다 — 관리자 가져오기는 시행일이 있어야 발행본이 된다');
    if (!Array.isArray(doc?.chapters) || doc.chapters.length === 0) at('chapters 가 비었다');
    const numbers = new Set();
    for (const ch of doc?.chapters ?? []) {
      if (!Number.isInteger(ch?.number) || ch.number < 1) at(`장 번호가 이상하다: ${ch?.number}`);
      for (const a of ch?.articles ?? []) {
        const key = `${a?.number}-${a?.branchNumber ?? 0}`;
        if (!Number.isInteger(a?.number) || a.number < 1) at(`조 번호가 이상하다: ${a?.number}`);
        // 가지 번호는 1 이상만 — 0 은 가져오기에서 빠지는데(branchOf) 인용은 0 으로 남아 실행이 그 행을 찾지 못한다(7차 #10)
        if (a?.branchNumber !== undefined && a?.branchNumber !== null && (!Number.isInteger(a.branchNumber) || a.branchNumber < 1)) {
          at(`제${a?.number}조 가지 번호가 이상하다: ${a.branchNumber}`);
        }
        if (numbers.has(key)) at(`조 번호가 겹친다: 제${a?.number}조`);
        numbers.add(key);
        if (!isText(a?.title)) at(`제${a?.number}조 제목이 없다`);
        const clauses = a?.clauses;
        if (clauses !== undefined) {
          if (!Array.isArray(clauses) || clauses.length === 0) at(`제${a.number}조 clauses 가 비었다`);
          if (a.content !== undefined || a.items !== undefined) at(`제${a.number}조 — clauses 와 content·items 를 같이 쓰지 않는다`);
          // 항이 있는 조의 머리 행은 본문이 없어 시행 본문이 없다 — 거기 건 연결로는 개정 후보가 생기지 않는다
          if (Array.isArray(a.cites) && a.cites.length) at(`제${a.number}조 — 항이 있는 조는 인용을 항에 단다`);
          for (const c of clauses ?? []) if (!isText(typeof c === 'string' ? c : c?.text)) at(`제${a.number}조 항 글이 없다`);
        } else if (!isText(a?.content)) at(`제${a?.number}조 본문(content 또는 clauses)이 없다`);
        for (const cite of citesOfArticle(a)) {
          if (!isText(cite?.law)) at(`제${a.number}조 인용에 법령 이름이 없다`);
          if (!citeNodeKey(cite?.article)) at(`제${a.number}조 인용 표기가 이상하다: ${cite?.article}`);
        }
      }
    }
  }
  return problems;
}

function citesOfArticle(a) {
  const own = Array.isArray(a?.cites) ? a.cites : [];
  const inClauses = (Array.isArray(a?.clauses) ? a.clauses : []).flatMap((c) => (typeof c === 'object' && Array.isArray(c?.cites) ? c.cites : []));
  return [...own, ...inClauses];
}

/** 시연 규정을 읽는다 — 꼴이 틀리면 무엇이 틀렸는지 적어 멈춘다 */
export function loadDemoPolicies(dir = DEFAULT_DATA_DIR) {
  const files = readdirSync(dir).filter((f) => f.endsWith('.json')).sort();
  const entries = files.map((file) => ({ file, doc: JSON.parse(readFileSync(join(dir, file), 'utf8')) }));
  const problems = validateDemoPolicies(entries);
  if (problems.length) throw new Error(`시연 규정 파일을 고쳐야 합니다:\n- ${problems.join('\n- ')}`);
  return entries.map((e) => e.doc);
}

const clauseText = (c) => (typeof c === 'string' ? c : c.text);
const branchOf = (a) => (a.branchNumber ? { branchNumber: a.branchNumber } : {});

/** 조 하나 → 가져오기 행. 항이 있으면 조 머리 행(본문 없음)과 항 행(①② 없이 글만 — 번호는 화면이 붙인다), 아니면 조 행과 그 아래 호 행 */
function rowsOf(a) {
  const head = { number: a.number, ...branchOf(a), title: a.title };
  if (a.clauses) {
    return [
      { ...head, content: '' },
      ...a.clauses.map((c, i) => ({ number: a.number, ...branchOf(a), clauseNumber: i + 1, title: '', content: clauseText(c) })),
    ];
  }
  return [
    { ...head, content: a.content },
    ...(a.items ?? []).map((text, i) => ({ number: a.number, ...branchOf(a), itemNumber: i + 1, title: '', content: text })),
  ];
}

/** 가져오기 본문(POST /policies/import) — 서버 검증(ImportPolicyDocumentDto)이 받는 칸만 싣는다 */
export function toImportBody(doc) {
  const articleCount = doc.chapters.reduce((n, ch) => n + ch.articles.length, 0);
  return {
    code: doc.code,
    title: doc.title,
    ...(doc.description ? { description: doc.description } : {}),
    ...(doc.department ? { department: doc.department } : {}),
    ...(doc.category ? { category: doc.category } : {}),
    effectiveDate: doc.effectiveDate,
    chapters: doc.chapters.map((ch) => ({ number: ch.number, title: ch.title, articles: ch.articles.flatMap(rowsOf) })),
    log: { sourceName: sourceNameOf(doc.code), parseProfile: 'korean', articleCount },
  };
}

/**
 * 인용 목록 — 우리 규정의 어느 행이 어느 법령 조항에 잇는가. 조에 단 인용은 조 행(본문이 있는 조), 항에 단 인용은 그 항 행.
 * @returns {{ code, number, branchNumber, clauseNumber, law, label, nodeKey }[]}
 */
export function citesOf(doc) {
  const out = [];
  for (const ch of doc.chapters) {
    for (const a of ch.articles) {
      const base = { code: doc.code, number: a.number, branchNumber: a.branchNumber ?? null };
      for (const c of a.cites ?? []) out.push({ ...base, clauseNumber: null, law: c.law, label: c.article, nodeKey: citeNodeKey(c.article) });
      (a.clauses ?? []).forEach((cl, i) => {
        if (typeof cl !== 'object') return;
        for (const c of cl.cites ?? []) out.push({ ...base, clauseNumber: i + 1, law: c.law, label: c.article, nodeKey: citeNodeKey(c.article) });
      });
    }
  }
  return out;
}

/** 우리 규정 행 표기 — 출력용('HR-01 제6조제4항') */
export function rowLabel(cite) {
  return `${cite.code} 제${cite.number}조${cite.branchNumber ? `의${cite.branchNumber}` : ''}${cite.clauseNumber ? `제${cite.clauseNumber}항` : ''}`;
}
