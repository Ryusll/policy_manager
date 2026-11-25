import * as Diff from 'diff';

/**
 * 개정 후보 생성(T-106)의 문장 처리 — 법령 전후 비교와 토큰 단위 차이 계산.
 *
 * DB 를 모르는 순수 함수다(같은 패턴: law-change-detect.ts, law-impact.ts). 규칙 엔진
 * (amendment-rules.ts)과 비교 정보(amendment-diff.ts)가 같은 토큰 규칙을 쓴다 — 따로 두면
 * "규칙이 고친 자리"와 "실제로 달라진 자리"의 경계가 어긋나 근거 대조가 틀린다.
 */

/**
 * 법제처 본문의 개정 연혁 표기. 내용이 아니라 이력이라 비교에서 뺀다 —
 * 남겨 두면 `<개정 2011.5.24>` → `<개정 2011.5.24, 2027.1.1>` 처럼 표기만 바뀐 개정이
 * "문장이 바뀌었다"로 잡혀 엉뚱한 초안이 나온다.
 *
 * - `<개정 2011.5.24>` `<신설 2009.12.29>` `<개정 2012. 2. 1., 2020. 5. 26.>` `<타법개정 …>`
 * - `[본조신설 2012.2.1]` `[전문개정 2008.3.28]` `[제목개정 …]` `[종전 제5조는 제6조로 이동 <2012.2.1>]`
 * - `[시행일: 2027.1.1] …` 같은 안내
 * - "삭제 <2012.2.1>" 의 날짜 꺾쇠 — "삭제" 낱말은 남긴다(조문이 삭제됐다는 내용이다)
 */
const ANNOTATION_RE =
  /[<〈]\s*(?:(?:개정|신설|삭제|전문개정|제목개정|제정|시행|종전|타법개정|일부개정)[^>〉]*|\d{4}\s*\.\s*\d{1,2}\s*\.\s*\d{1,2}\s*\.?)\s*[>〉]|[[［]\s*(?:본조신설|본조제목개정|전문개정|제목개정|종전|시행일|본조|신설|개정|삭제)[^\]］]*[\]］]/g;

/** 개정 연혁 표기를 떼고 공백을 한 칸으로 */
export function stripLawAnnotations(text: string): string {
  return (text ?? '').replace(ANNOTATION_RE, ' ').replace(/\s+/g, ' ').trim();
}

/** 조항이 "삭제 <날짜>" 로만 남았는지 — 법제처는 삭제된 조항을 이렇게 남긴다 */
export function isRepealedLawText(text: string | null | undefined): boolean {
  return /^삭제\.?$/.test(stripLawAnnotations(text ?? ''));
}

export type TokKind = 'num' | 'word' | 'space' | 'punct';

export interface Tok {
  text: string;
  kind: TokKind;
  start: number;
  end: number;
}

/**
 * 숫자(쉼표·소수점 포함) / 한글·영문 낱말 / 공백 / 그 밖의 한 글자.
 * 한글 낱말은 조사가 붙은 채 한 덩어리다("근로자에게") — 조사는 비교 단계에서 뗀다.
 */
const TOKEN_RE = /(\d+(?:[.,]\d+)*)|([가-힣]+|[A-Za-z]+)|(\s+)|([\s\S])/gu;

export function tokenize(text: string): Tok[] {
  const out: Tok[] = [];
  for (const m of (text ?? '').matchAll(TOKEN_RE)) {
    const start = m.index ?? 0;
    const kind: TokKind = m[1] ? 'num' : m[2] ? 'word' : m[3] ? 'space' : 'punct';
    out.push({ text: m[0], kind, start, end: start + m[0].length });
  }
  return out;
}

export type TokenOp = { op: 'equal' | 'insert' | 'delete'; tokens: Tok[] };

/** 토큰 배열 차이. 삭제가 추가보다 먼저 온다(jsdiff 규칙) */
export function diffTokens(a: Tok[], b: Tok[]): TokenOp[] {
  const parts = Diff.diffArrays(a, b, { comparator: (x: Tok, y: Tok) => x.text === y.text });
  return parts.map((p) => ({
    op: p.added ? 'insert' : p.removed ? 'delete' : 'equal',
    tokens: p.value as Tok[],
  }));
}

/**
 * 값의 단위. 길이가 긴 것부터 맞춘다("개월"이 "월"보다 먼저).
 * 법령 기준값에 흔한 것만 둔다 — 여기 없는 단위의 숫자 변경은 "문장 변경"으로 넘어가
 * 사람이 본다(틀린 자동 치환보다 낫다).
 */
const UNITS = [
  '퍼센트', '개월', '시간', '킬로미터', '제곱미터', '미터', '킬로그램',
  '천만원', '백만원', '십만원', '조원', '억원', '만원', '천원', '백원', '원',
  '년', '월', '주', '일', '분', '초', '세', '명', '인', '회', '배', '건', '개', '층', '톤', '대', '%',
].sort((x, y) => y.length - x.length);

/** 낱말 앞부분이 단위면 그 단위 ("일의" → "일", "개월간" → "개월") */
export function leadingUnit(word: string): string | null {
  // "100분의 50" 의 "분의" 는 분수다 — 시간 단위 "분"으로 읽으면 "100분"을 값으로 착각한다
  if (word.startsWith('분의')) return null;
  for (const u of UNITS) if (word.startsWith(u)) return u;
  return null;
}

/**
 * 한국어 조사·어미 중 낱말 끝에 붙는 흔한 것. 용어 변경에서 "근로자에게"→"노동자에게"의
 * 공통 꼬리를 떼어 "근로자"→"노동자"를 얻는 데 쓴다. 공통 꼬리가 이 목록에 있을 때만
 * 뗀다 — 아무 공통 꼬리나 떼면 "근로자대표"→"노동자대표"가 "근로자"→"노동자"로 넓어진다.
 */
export const PARTICLES = [
  '으로부터', '에게서', '이라는', '로부터', '에서는', '에게는', '으로서', '으로써', '이라고',
  '에서', '에게', '으로', '라는', '이란', '까지', '부터', '보다', '처럼', '마다', '이나', '로서', '로써',
  '께서', '한테', '와의', '과의', '에는', '에도', '은', '는', '이', '가', '을', '를', '의', '에', '와', '과',
  '로', '도', '만', '란', '나', '께',
].sort((x, y) => y.length - x.length);

/** 두 문구가 같은 조사로 끝나면 그 조사 길이(떼고도 양쪽에 글이 남을 때만), 아니면 0 */
export function commonParticleLength(a: string, b: string): number {
  for (const p of PARTICLES) {
    if (a.endsWith(p) && b.endsWith(p) && a.length > p.length && b.length > p.length) return p.length;
  }
  return 0;
}

/** 받침에 따라 갈리는 조사 쌍 [받침 있을 때, 없을 때] */
export const PARTICLE_PAIRS: Array<[string, string]> = [
  ['은', '는'],
  ['이', '가'],
  ['을', '를'],
  ['과', '와'],
  ['과의', '와의'],
  ['이나', '나'],
  ['이란', '란'],
  ['이라는', '라는'],
  ['이라고', '라고'],
];
/** "으로" 계열 — ㄹ 받침은 받침 없을 때처럼 "로" */
export const RO_PAIRS: Array<[string, string]> = [
  ['으로부터', '로부터'],
  ['으로서', '로서'],
  ['으로써', '로써'],
  ['으로', '로'],
];

/**
 * 용어 변경의 꼬리 조사를 뗀다. 같은 조사("근로자에게"→"노동자에게")뿐 아니라, 새 용어의 받침
 * 때문에 짝이 바뀐 조사("사업주는"→"사용인은")도 뗀다 — 법이 용어를 바꾸면 조사도 함께 바뀐다.
 * 떼고 나서 한 글자만 남으면 떼지 않는다("작가"→"화가"의 "가"는 조사가 아니다).
 */
function stripParticles(a: string, b: string): [string, string] {
  const ok = (x: string, y: string) => x.length >= 2 && y.length >= 2;
  // 짝이 바뀐 조사를 먼저 본다 — "사업주로"→"사용인으로"에서 공통 꼬리 "로"부터 떼면 "사용인으"가 남는다
  for (const [w, wo] of [...RO_PAIRS, ...PARTICLE_PAIRS]) {
    for (const [pa, pb] of [
      [w, wo],
      [wo, w],
    ]) {
      if (a.endsWith(pa) && b.endsWith(pb) && ok(a.slice(0, -pa.length), b.slice(0, -pb.length))) {
        return [a.slice(0, -pa.length), b.slice(0, -pb.length)];
      }
    }
  }
  const n = commonParticleLength(a, b);
  if (n && ok(a.slice(0, -n), b.slice(0, -n))) return [a.slice(0, -n), b.slice(0, -n)];
  return [a, b];
}

export type LawChangeKind = 'value' | 'term' | 'sentence' | 'insert' | 'delete' | 'reference';

/** 법령 전후 비교로 찾은 변경 한 곳 (특허 도 10 단계 1021 — 추가·삭제·대체 문구) */
export interface LawTextChange {
  index: number;
  kind: LawChangeKind;
  /** 변경 전 문구. 값이면 단위·분수 맥락까지 포함("100분의 50", "15일") */
  before: string;
  after: string;
  /** 앞뒤의 바뀌지 않은 글 — 화면 표시·근거용 */
  contextBefore: string;
  contextAfter: string;
  /** 연혁 표기를 뗀 변경 전 본문(`stripLawAnnotations`)에서의 위치. 추가면 길이 0 */
  beforeRange: { start: number; end: number };
  /** 연혁 표기를 뗀 변경 후 본문에서의 위치. 삭제면 길이 0 */
  afterRange: { start: number; end: number };
}

const CONTEXT_CHARS = 24;
const TERM_MAX_WORDS = 3;
const TERM_MAX_CHARS = 20;
const TERM_MIN_CHARS = 2;

const joinText = (toks: Tok[]) => toks.map((t) => t.text).join('');
const words = (toks: Tok[]) => toks.filter((t) => t.kind !== 'space');

function tailText(toks: Tok[], n: number): string {
  const s = joinText(toks);
  return s.length > n ? s.slice(s.length - n) : s;
}
function headText(toks: Tok[], n: number): string {
  const s = joinText(toks);
  return s.length > n ? s.slice(0, n) : s;
}

/** 숫자 바로 앞이 "100분의 " 같은 분수 맥락이면 그 글 */
function fractionPrefix(left: Tok[]): string {
  const s = tailText(left, 16);
  const m = /\d+\s*분의\s*$/.exec(s);
  return m ? m[0] : '';
}

/** "제2항"·"제3조" 같은 조문 번호 안의 숫자인지 */
function isArticleRefNumber(left: Tok[], right: Tok[]): boolean {
  const prev = [...left].reverse().find((t) => t.kind !== 'space');
  const next = right.find((t) => t.kind !== 'space');
  return !!prev && prev.text.endsWith('제') && !!next && /^[조항호목장절편]/.test(next.text);
}

function classify(
  removed: Tok[],
  added: Tok[],
  left: Tok[],
  right: Tok[],
): { kind: LawChangeKind; before: string; after: string } {
  const before = joinText(removed).trim();
  const after = joinText(added).trim();
  if (!before) return { kind: 'insert', before, after };
  if (!after) return { kind: 'delete', before, after };

  const rw = words(removed);
  const aw = words(added);
  const hasNum = (ts: Tok[]) => ts.some((t) => t.kind === 'num');

  if (hasNum(rw) && hasNum(aw)) {
    if (isArticleRefNumber(left, right)) return { kind: 'reference', before, after };
    const onlyValue = (ts: Tok[]) =>
      ts.every(
        (t) =>
          t.kind === 'num' ||
          (t.kind === 'word' && (leadingUnit(t.text) === t.text || t.text === '분의')) ||
          t.text === '%',
      );
    if (onlyValue(rw) && onlyValue(aw)) {
      // 바뀐 것이 숫자뿐이면 오른쪽 단위·왼쪽 분수 맥락을 붙여 "값 표현"으로 만든다.
      // 단위 없는 맨숫자는 무엇의 값인지 몰라 치환하면 위험하다 — 문장 변경으로 넘긴다
      const endsWithNum = (ts: Tok[]) => ts[ts.length - 1]?.kind === 'num';
      let unit = '';
      if (endsWithNum(removed) && endsWithNum(added)) {
        const next = right[0];
        unit = next && next.kind === 'word' ? leadingUnit(next.text) ?? '' : next?.text === '%' ? '%' : '';
      }
      const frac = fractionPrefix(left);
      const hasUnit = (ts: Tok[]) => ts.some((t) => t.kind === 'word' || t.text === '%');
      if (unit || frac || (hasUnit(rw) && hasUnit(aw))) {
        return { kind: 'value', before: `${frac}${before}${unit}`, after: `${frac}${after}${unit}` };
      }
    }
    return { kind: 'sentence', before, after };
  }

  if (!hasNum(rw) && !hasNum(aw)) {
    const plain = (ts: Tok[]) => ts.every((t) => t.kind === 'word' || t.text === '·');
    if (
      plain(rw) &&
      plain(aw) &&
      rw.length <= TERM_MAX_WORDS &&
      aw.length <= TERM_MAX_WORDS &&
      before.length <= TERM_MAX_CHARS &&
      after.length <= TERM_MAX_CHARS
    ) {
      const [b, a] = stripParticles(before, after);
      if (b.length >= TERM_MIN_CHARS && a.length >= TERM_MIN_CHARS) return { kind: 'term', before: b, after: a };
    }
  }
  return { kind: 'sentence', before, after };
}

/**
 * 변경 전후 법령조항 본문을 비교해 바뀐 곳을 하나씩 돌려준다(특허 도 10 단계 1021).
 * 개정 연혁 표기는 먼저 뗀다. 공백만 다른 곳은 변경이 아니다.
 */
export function diffLawText(before: string | null | undefined, after: string | null | undefined): LawTextChange[] {
  const a = tokenize(stripLawAnnotations(before ?? ''));
  const b = tokenize(stripLawAnnotations(after ?? ''));
  const ops = diffTokens(a, b);
  const len = (toks: Tok[]) => toks.reduce((n, t) => n + t.text.length, 0);

  const changes: LawTextChange[] = [];
  // 양쪽 본문에서의 현재 위치. 같은 부분은 두 본문의 글이 같으므로 길이만큼 함께 나아간다
  let posA = 0;
  let posB = 0;
  let i = 0;
  while (i < ops.length) {
    if (ops[i].op === 'equal') {
      posA += len(ops[i].tokens);
      posB += len(ops[i].tokens);
      i++;
      continue;
    }
    const startA = posA;
    const startB = posB;
    const removed: Tok[] = [];
    const added: Tok[] = [];
    let j = i;
    const take = (op: TokenOp) => {
      if (op.op === 'delete') {
        removed.push(...op.tokens);
        posA += len(op.tokens);
      } else {
        added.push(...op.tokens);
        posB += len(op.tokens);
      }
    };
    while (j < ops.length && ops[j].op !== 'equal') take(ops[j++]);
    // "100분의 50" → "3분의 1" 은 분자·분모가 "분의 "를 사이에 두고 두 곳으로 갈라진다.
    // 따로 보면 "100분"(시간)과 맨숫자 "50"이 된다 — 한 값으로 묶는다
    while (
      j + 1 < ops.length &&
      ops[j].op === 'equal' &&
      /^\s*분의\s*$/.test(joinText(ops[j].tokens)) &&
      ops[j + 1].op !== 'equal'
    ) {
      removed.push(...ops[j].tokens);
      added.push(...ops[j].tokens);
      posA += len(ops[j].tokens);
      posB += len(ops[j].tokens);
      j++;
      while (j < ops.length && ops[j].op !== 'equal') take(ops[j++]);
    }
    const left = i > 0 ? ops[i - 1].tokens : [];
    const right = j < ops.length ? ops[j].tokens : [];
    i = j;

    if (!joinText(removed).trim() && !joinText(added).trim()) continue; // 공백만 다름
    const c = classify(removed, added, left, right);
    changes.push({
      index: changes.length,
      ...c,
      contextBefore: tailText(left, CONTEXT_CHARS),
      contextAfter: headText(right, CONTEXT_CHARS),
      beforeRange: { start: startA, end: posA },
      afterRange: { start: startB, end: posB },
    });
  }
  return changes;
}

export interface SentenceRange {
  start: number;
  end: number;
  text: string;
}

/** 문장 단위로 자르고 원문 위치를 함께 — 마침표·물음표 뒤 공백, 줄바꿈에서 자른다 */
export function sentenceRanges(text: string): SentenceRange[] {
  const out: SentenceRange[] = [];
  const src = text ?? '';
  const re = /(?<=[.?!])\s+|\n+/g;
  let from = 0;
  const push = (start: number, end: number) => {
    const raw = src.slice(start, end);
    const lead = raw.length - raw.trimStart().length;
    const t = raw.trim();
    if (t) out.push({ start: start + lead, end: start + lead + t.length, text: t });
  };
  for (const m of src.matchAll(re)) {
    push(from, m.index ?? 0);
    from = (m.index ?? 0) + m[0].length;
  }
  push(from, src.length);
  return out;
}

/** 문장 단위로 자른다 */
export function splitSentences(text: string): string[] {
  return sentenceRanges(text).map((s) => s.text);
}
