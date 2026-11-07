import { formatArticleLabel } from '../common/article-label';
import type { CandidateChange } from './amendment-diff';
import { adjustParticle } from './amendment-rules';
import { articleHeading, articleSentence, lawBasis, lawOccasion, objectParticle, type ReasonArticle, type ReasonLaw } from './amendment-reason';

/**
 * 개정 이유 초안(T-161, SRS LAW-21) — 승인 화면 '사유 초안 넣기'가 채우는 사실 문장. 승인 때 같은 함수로 다시 만들어 사유와 견준다.
 *
 * '에 따라' 뒤에는 법 개정 때문에 바뀐 곳(규칙 근거가 붙었고 바뀐 글자가 그 규칙이 낸 문구 안에 있는 곳)의 글자 쌍만 쓴다 — 회사 변수
 * 값·사람이 고친 곳을 법 개정 때문이라고 적으면 이사회·노사 자료에서 거짓 진술이 된다. 그런 곳은 '그 밖에 N곳을 고침'으로 따로 적고,
 * 그런 곳만 있으면 "…개정(…)을 계기로 … N곳을 고침"(계기만 적는다). 변경 정보가 없으면 조문 단위 문장(개정안 문서와 같다).
 * 승인 사유 상한(500자) 안의 한 줄이다.
 */

type ReasonChange = Pick<CandidateChange, 'kind' | 'base' | 'candidate' | 'rationaleRefs'> & { variableRefs?: number[] };
/** 규칙 적용(rationale.applications) 가운데 문장이 쓰는 칸 — 규칙이 바꾼 기준 글자와 낸 문구 */
export type ReasonApplication = { id: number; base: { text: string }; candidate: { text: string } };
export type ReasonDraftInput = {
  law: ReasonLaw;
  article: ReasonArticle;
  /** 기준 본문(제1 조문)과 후보 본문 — 변경의 위치(base·candidate)가 가리키는 글 */
  baseContent: string;
  candidateContent: string;
  /** 승인할 판의 변경(diff.changes) */
  changes: ReasonChange[];
  /** 후보의 규칙 적용 — 변경 구간이 법 개정 때문인지 가린다 */
  applications: ReasonApplication[];
};

/** 초안 규칙의 판 — 승인 감사에 함께 남겨, 문장 규칙이 바뀐 뒤에도 그때 어느 규칙의 초안과 견줬는지 안다 */
export const REASON_DRAFT_RULE = 'reason-draft-v1';
/** 승인 사유 상한(ApproveAmendmentDto.changeNote) */
export const REASON_MAX = 500;
/** 인용 한 곳의 글자 수, 글자 쌍을 보이는 곳 수 — 넘으면 줄이고 '등'으로 */
const QUOTE_MAX = 40;
const SHOWN_MAX = 3;

const oneLine = (s: string) => s.replace(/\s+/g, ' ').trim();
const clip = (s: string) => (s.length <= REASON_MAX ? s : `${s.slice(0, REASON_MAX - 1)}…`);

/** 끝 괄호와 짝인 여는 괄호 — 겹친 괄호면 바깥 것 */
function openingParen(s: string): number {
  let depth = 0;
  for (let k = s.length - 1; k >= 0; k--) {
    if (s[k] === ')' || s[k] === '）') depth++;
    else if ((s[k] === '(' || s[k] === '（') && --depth === 0) return k;
  }
  return -1;
}

/** 조사를 고를 글자 — 끝의 닫는 낫표·따옴표·마침표·쉼표는 건너뛰고, 괄호로 끝나면 괄호 앞 낱말(괄호는 앞말을 보충한다) */
function readingEnd(t: string): string {
  let s = t.trim();
  for (let i = 0; i < 6; i++) {
    if (/[)）]$/.test(s)) {
      const open = openingParen(s);
      s = (open > 0 ? s.slice(0, open) : s.slice(0, -1)).trimEnd();
    } else if (/[」』’”"'\]》〉.,·…]$/.test(s)) s = s.slice(0, -1).trimEnd();
    else break;
  }
  return s || t;
}

/** 인용한 글자 뒤의 조사 — 한글은 받침으로(adjustParticle), 숫자는 끝자리 읽는 소리로, 그 밖(영문·기호)은 받침 없는 쪽 */
function particle(text: string, kind: '을' | '으로'): string {
  const t = readingEnd(text);
  const hangul = adjustParticle(t, kind);
  if (hangul !== null) return hangul;
  const last = t[t.length - 1] ?? '';
  if (!/\d/.test(last)) return kind === '을' ? '를' : '로';
  // 0(십·백·천·만·영)·3(삼)·6(육)은 받침, 1(일)·7(칠)·8(팔)은 ㄹ 받침(으로 대신 로), 2·4·5·9 는 받침 없음
  if (kind === '을') return '013678'.includes(last) ? '을' : '를';
  return '036'.includes(last) ? '으로' : '로';
}

const head = (t: string) => (t.length > QUOTE_MAX ? `${t.slice(0, QUOTE_MAX - 1)}…` : t);
const tail = (t: string) => (t.length > QUOTE_MAX ? `…${t.slice(-(QUOTE_MAX - 1))}` : t);

/** 바꾼 곳의 두 인용 — 길면 앞을 보이되, 줄인 앞부분이 같아 똑같아 보이면 뒷부분을 보인다 */
function shownPair(c: ReasonChange): [string, string] {
  const [b, a] = [oneLine(c.base.text), oneLine(c.candidate.text)];
  const [hb, ha] = [head(b), head(a)];
  return hb === ha && hb !== b ? [tail(b), tail(a)] : [hb, ha];
}

/** ‘보이는 글자’ + 조사 — 조사는 원래 글자 끝을 따른다 */
const quote = (shown: string, original: string, kind?: '을' | '으로') => `‘${shown}’${kind ? particle(oneLine(original), kind) : ''}`;

/** 숫자 뒤에 오는 단위 — 긴 것부터(개월이 개보다 먼저) */
const UNIT = /^(개월|만원|천원|시간|퍼센트|호봉|일|월|년|주|분|초|회|번|명|원|배|%|세|살|개|건|차|급)/;
const NUMBER = /^\d[\d,.]*$/;
/** 단위 뒤에 올 수 있는 것 — 끝·한글 아닌 글자·조사의 첫 글자. "1주택"·"5세대"·"3분기"는 숫자+단위가 아니다 */
const AFTER_UNIT = /^(?:$|[^가-힣]|[의은는이가을를에간씩로으와과도만부까마내째동후전])/;
/** 단위와 이어 한 낱말이 되는 것 — "2분의 1"(분수), "50초과" */
const NOT_UNIT: Record<string, string> = { 분: '의', 초: '과' };
const unitEnds = (text: string, unit: string) => AFTER_UNIT.test(text) && !(NOT_UNIT[unit] && text.startsWith(NOT_UNIT[unit]));

/**
 * 숫자만 바뀐 곳은 양쪽 뒤에 같은 단위가 이어지면 붙여 인용한다 — 값 규칙은 숫자만 바꿔 "‘2’를 ‘4’로"가 되는데, 읽는 사람에게는
 * "‘2일’을 ‘4일’로"여야 한다. 위치가 본문과 맞지 않거나(옛 후보) 단위가 낱말의 일부면 그대로 둔다
 */
function withUnit(c: ReasonChange, base: string, candidate: string): ReasonChange {
  if (c.kind !== 'replace' || !NUMBER.test(c.base.text) || !NUMBER.test(c.candidate.text)) return c;
  if (base.slice(c.base.start, c.base.end) !== c.base.text || candidate.slice(c.candidate.start, c.candidate.end) !== c.candidate.text) return c;
  const unit = UNIT.exec(base.slice(c.base.end))?.[1];
  if (!unit || !candidate.startsWith(unit, c.candidate.end)) return c;
  if (!unitEnds(base.slice(c.base.end + unit.length), unit) || !unitEnds(candidate.slice(c.candidate.end + unit.length), unit)) return c;
  return {
    ...c,
    base: { ...c.base, end: c.base.end + unit.length, text: c.base.text + unit },
    candidate: { ...c.candidate, end: c.candidate.end + unit.length, text: c.candidate.text + unit },
  };
}

/** 공백만 바뀐 곳은 문장에 쓸 글자가 없다 */
function visible(c: ReasonChange): boolean {
  if (c.kind === 'insert') return !!oneLine(c.candidate.text);
  if (c.kind === 'delete') return !!oneLine(c.base.text);
  return !!oneLine(c.base.text) && !!oneLine(c.candidate.text);
}

/**
 * 법 개정 때문에 바뀐 곳인가 — 규칙 근거가 붙었고, 회사 변수 값과 섞이지 않았고, 바뀐 글자가 그 규칙이 낸 문구 안에 있을 때만.
 * 근거 번호는 구간이 겹치기만 해도 붙어서(diffCandidate 의 구간 합치기, relinkDiff 의 삽입 지점 경계) 옆에 사람이 고친 글자도 받는다
 */
function fromLaw(c: ReasonChange, applications: ReasonApplication[]): boolean {
  if (!c.rationaleRefs?.length || c.variableRefs?.length) return false;
  return c.rationaleRefs.some((id) => {
    const a = applications.find((x) => x.id === id);
    return !!a && (!c.base.text || a.base.text.includes(c.base.text)) && (!c.candidate.text || a.candidate.text.includes(c.candidate.text));
  });
}

/** 보이는 곳이 다 들어갈 때 — "‘2일’을 ‘4일’로, ‘무급’을 ‘유급’으로 바꿈, ‘3회’를 추가함" (이어지는 바꿈은 한 동사로) */
function listed(changes: ReasonChange[]): string {
  const out: string[] = [];
  let run: string[] = [];
  const flush = () => {
    if (run.length) out.push(`${run.join(', ')} 바꿈`);
    run = [];
  };
  for (const c of changes) {
    if (c.kind === 'replace') {
      const [b, a] = shownPair(c);
      run.push(`${quote(b, c.base.text, '을')} ${quote(a, c.candidate.text, '으로')}`);
    } else {
      flush();
      const t = c.kind === 'insert' ? c.candidate.text : c.base.text;
      out.push(`${quote(head(oneLine(t)), t, '을')} ${c.kind === 'insert' ? '추가함' : '삭제함'}`);
    }
  }
  flush();
  return out.join(', ');
}

/** 곳이 많을 때 괄호 안 보기 — "‘2일’→‘4일’", "‘유급’ 추가", "‘무급’ 삭제" */
function example(c: ReasonChange): string {
  if (c.kind === 'insert') return `${quote(head(oneLine(c.candidate.text)), c.candidate.text)} 추가`;
  if (c.kind === 'delete') return `${quote(head(oneLine(c.base.text)), c.base.text)} 삭제`;
  const [b, a] = shownPair(c);
  return `${quote(b, c.base.text)}→${quote(a, c.candidate.text)}`;
}

/** 법 개정 때문에 바뀐 곳이 있을 때 — 세 곳까지는 글자 쌍, 넘거나 길면 "N곳을 바꿈(보기 … 등)", 끝내 길면 조문 단위로(다른 곳 수는 그대로) */
function lawChangesSentence(law: ReasonLaw, article: ReasonArticle, changes: ReasonChange[], others: number): string {
  const rest = others ? `. 그 밖에 ${others}곳을 고침` : '';
  const lead = `${lawBasis(law)} ${articleHeading(article)} 중 `;
  if (changes.length <= SHOWN_MAX) {
    const s = `${lead}${listed(changes)}${rest}`;
    if (s.length <= REASON_MAX) return s;
  }
  const verb = changes.every((c) => c.kind === 'replace') ? '바꿈' : '고침';
  for (let n = Math.min(SHOWN_MAX, changes.length); n >= 1; n--) {
    const more = n < changes.length ? ' 등' : '';
    const s = `${lead}${changes.length}곳을 ${verb}(${changes.slice(0, n).map(example).join(', ')}${more})${rest}`;
    if (s.length <= REASON_MAX) return s;
  }
  const label = formatArticleLabel(article);
  return `${lawBasis(law)} ${label}${objectParticle(label)} 바꿈${rest}`;
}

/** 승인 화면 '사유 초안 넣기'의 문장 — 사실만, 500자 이하 한 줄. 같은 입력이면 늘 같은 문장(승인 때 다시 만들어 견준다) */
export function reasonDraft(input: ReasonDraftInput): string {
  const { law, article } = input;
  const deleted = !input.candidateContent.trim();
  const shown = input.changes.filter(visible);
  const lawBased = shown.filter((c) => fromLaw(c, input.applications));
  const label = formatArticleLabel(article);
  let s: string;
  if (!shown.length) s = articleSentence(law, article, deleted);
  else if (deleted) s = lawBased.length ? articleSentence(law, article, true) : `${lawOccasion(law)} ${label}${objectParticle(label)} 삭제함`;
  else if (!lawBased.length) s = `${lawOccasion(law)} ${articleHeading(article)} 중 ${shown.length}곳을 고침`;
  else s = lawChangesSentence(law, article, lawBased.map((c) => withUnit(c, input.baseContent, input.candidateContent)), shown.length - lawBased.length);
  return clip(oneLine(s));
}

/**
 * 개정안 문서(T-162)의 개정 이유 한 줄 — 조문 단위. 초안과 같은 판정으로, 법 개정 때문인 곳이 없으면 '에 따라' 대신 '을 계기로',
 * 섞였으면 '. 그 밖에 N곳을 고침'(변경 정보가 없으면 예전 문장). 같은 문서 안에서 승인 사유와 인과를 다르게 말하지 않게
 */
export function articleReason(input: ReasonDraftInput): string {
  const deleted = !input.candidateContent.trim();
  const shown = input.changes.filter(visible);
  if (!shown.length) return articleSentence(input.law, input.article, deleted);
  const lawBased = shown.filter((c) => fromLaw(c, input.applications)).length;
  const label = formatArticleLabel(input.article);
  if (!lawBased) return `${lawOccasion(input.law)} ${label}${objectParticle(label)} ${deleted ? '삭제함' : '바꿈'}`;
  const others = shown.length - lawBased;
  return `${articleSentence(input.law, input.article, deleted)}${others ? `. 그 밖에 ${others}곳을 고침` : ''}`;
}

/** 저장된 diff(JSON)의 변경 목록 — 모양이 맞지 않는 항목은 버린다(옛 후보) */
export function changesOf(diff: unknown): ReasonChange[] {
  const list = (diff as { changes?: unknown } | null)?.changes;
  if (!Array.isArray(list)) return [];
  return list.filter((c): c is ReasonChange => {
    const x = c as Partial<ReasonChange> | null;
    return !!x && typeof x.kind === 'string' && typeof x.base?.text === 'string' && typeof x.candidate?.text === 'string';
  });
}

/** 저장된 근거(JSON)의 규칙 적용 — 모양이 맞지 않는 항목은 버린다 */
export function applicationsOf(rationale: unknown): ReasonApplication[] {
  const list = (rationale as { applications?: unknown } | null)?.applications;
  if (!Array.isArray(list)) return [];
  return list.filter((a): a is ReasonApplication => {
    const x = a as Partial<ReasonApplication> | null;
    return !!x && typeof x.id === 'number' && typeof x.base?.text === 'string' && typeof x.candidate?.text === 'string';
  });
}

/**
 * 승인 감사의 초안 기록 — 승인 순간 서버가 같은 함수로 다시 만든 초안과 사유(앞뒤 공백 뗀 것)가 같은지, 규칙 판. 초안 글은 다를 때만
 * 남긴다(같으면 사유 changeNote 와 같다 — 본문 인용을 감사에 두 번 쓰지 않는다)
 */
export function draftRecord(note: string, draft: string) {
  const matches = note.trim() === draft;
  return matches ? { matches, rule: REASON_DRAFT_RULE } : { matches, draft, rule: REASON_DRAFT_RULE };
}
