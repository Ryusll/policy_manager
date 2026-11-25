import type { VariableProposal } from './amendment-variables';
import * as Diff from 'diff';
import { diffCandidate, type CandidateDiff } from './amendment-diff';
import {
  diffLawText,
  isRepealedLawText,
  PARTICLE_PAIRS,
  PARTICLES,
  RO_PAIRS,
  sentenceRanges,
  stripLawAnnotations,
  type LawTextChange,
  type SentenceRange,
} from './amendment-text';

/**
 * 개정 후보 생성 — 규칙 기반 (T-106, 특허 청구항 4 제1 방식, 도 10 단계 1021~1023).
 *
 * 법령 전후 비교로 바뀐 문구를 찾고(1021), 규칙이 그 변경을 우리 조문(제1 조문)의 **대응 문구**에
 * 옮긴다(1022 — 우리 문장 구조는 그대로 두고 그 자리에만 개정 문구를 넣는다). 적용한 규칙·템플릿과
 * 버전을 남긴다(1023).
 *
 * 원칙은 **틀린 자동 치환보다 사람에게 넘기는 쪽**이다(ADR-0021 — 시스템은 추천만 한다).
 * 결정(사용자 지시로 코덱스 자문, 2026-10-08):
 * - 같은 문구가 우리 본문에 여러 번 나오면 연결의 근거 문구가 가리키는 문장으로 좁힌다. 좁혀도
 *   하나로 특정되지 않으면 고치지 않고 '대응 위치 모호'로 넘긴다(기준값·용어 모두).
 * - 용어는 뒤에 붙은 조사까지 맞출 수 있을 때만 바꾼다("사업주는"→"사용인은").
 * - 참고(reference) 관계, 적용 범위(scope)가 적힌 연결은 자동으로 고치지 않는다 — 확정된 연결은
 *   "관련 있다"는 뜻이지 그 값을 그대로 따라야 한다는 뜻까지는 아니다.
 * - 법 문장의 추가·삭제와 "삭제 <날짜>"는 본문을 건드리지 않고 '반영하지 못한 법령 변경'으로 남긴다.
 * - 여러 규칙이 같은 자리에 다른 문구를 내면 그 자리는 고치지 않고 경쟁한 제안을 모두 남긴다.
 */

/** rule/2 — 변수 값 넣기(T-109 ②)를 더했다. 법령 규칙의 판정은 rule/1 과 같다 */
export const RULESET_VERSION = 'rule/2';
export const CONFIDENCE_VERSION = 'conf/1';

export const RULES = {
  /** 법령의 기준값(숫자+단위)이 바뀌면 우리 조문의 같은 값을 새 값으로 */
  VALUE: { id: 'VALUE_CHANGE', version: 1 },
  /** 법령의 용어가 바뀌면 우리 조문의 같은 용어를 새 용어로 (조사 맞춤) */
  TERM: { id: 'TERM_CHANGE', version: 1 },
  /** 우리 조문이 법 문장을 그대로 옮겨 적었으면 그 문장을 새 문장으로 */
  QUOTE: { id: 'QUOTED_SENTENCE', version: 1 },
} as const;

export const TEMPLATES = {
  /** 우리 문장 구조를 그대로 두고 대응 문구 자리에만 개정 문구 */
  INLINE: { id: 'INLINE_REPLACE', version: 1 },
  /** 옮겨 적은 법 문장 자리에 새 문장 */
  SENTENCE: { id: 'SENTENCE_REPLACE', version: 1 },
} as const;

type RuleKey = keyof typeof RULES;
type TemplateKey = keyof typeof TEMPLATES;

export type LawRelation = 'delegation' | 'application' | 'citation' | 'obligation' | 'reference';

/** 규칙이 자동으로 고칠 수 있는 관계 — 참고(reference)는 사람이 본다 */
const AUTO_RELATIONS: ReadonlySet<LawRelation> = new Set(['delegation', 'application', 'citation', 'obligation']);

export type ReviewFlag =
  /** 반영한 변경이 하나도 없다 — 본문은 제1 조문 그대로이고 사람이 직접 고쳐야 한다 */
  | 'manual_draft_required'
  /** 규칙으로 반영하지 못한 법령 변경이 있다 */
  | 'unmapped_law_change'
  /** 같은 문구가 여러 곳이라 어느 것을 고칠지 특정하지 못했다 */
  | 'ambiguous_match'
  /** 용어 뒤가 조사가 아니어서(합성어 등) 고치지 않은 곳이 있다 */
  | 'context_unclear'
  /** 규칙끼리 같은 자리에 다른 문구를 냈다 */
  | 'rule_conflict'
  /** 참고 관계라 자동으로 고치지 않았다 */
  | 'relation_review_only'
  /** 연결에 적용 범위가 적혀 있어 자동으로 고치지 않았다 */
  | 'scope_review'
  /** 법령 조항이 삭제됐다 */
  | 'law_provision_repealed'
  /** 변수 값을 넣을 자리가 법령 개정과 겹쳐 원문을 두었다(T-109 ②) */
  | 'variable_conflict'
  /** 변수 값을 정하지 못해 넣지 않은 자리가 있다 — 값 없음·기간 겹침·기간 미확정·문구 불일치(T-109 ②) */
  | 'variable_unresolved'
  /** 바뀐 조항이 아니라 그 위 조항(조·항)에 건 연결로 찾았다 — 신뢰도 '보통'까지(T-148, amendment-reach.ts) */
  | 'parent_link'
  /** 근거가 연결되지 않은 변경이 있다 (도 10 단계 1050) */
  | 'unexplained_change';

export type UnmappedReason =
  | 'repealed'
  | 'relation_review_only'
  | 'scope_review'
  | 'no_correspondence'
  | 'ambiguous'
  | 'context_unclear'
  | 'conflict'
  | 'unsupported';

export interface RuleApplication {
  id: number;
  ruleId: string;
  ruleVersion: number;
  templateId: string;
  templateVersion: number;
  /** 이 적용이 반영한 법령 변경(`lawChanges[].index`) */
  lawChangeIndexes: number[];
  base: { start: number; end: number; text: string };
  candidate: { start: number; end: number; text: string };
}

export interface UnmappedLawChange {
  lawChangeIndex: number;
  reason: UnmappedReason;
  /** 사람이 읽을 설명(예: 같은 값이 3곳) */
  detail?: string;
}

export interface RuleConflict {
  base: { start: number; end: number; text: string };
  /** 변수 값 넣기 제안이면 `ruleId: 'variable_value'` 와 `variableRef`(T-109 ②) */
  proposals: Array<{ ruleId: string; lawChangeIndexes: number[]; replacement: string; variableRef?: number }>;
}

/** 변수 값을 넣은 자리(T-109 ②) — `ref` 는 `rationale.variables[].index` */
export interface VariableApplication {
  ref: number;
  base: { start: number; end: number; text: string };
  candidate: { start: number; end: number; text: string };
}

export type ConfidenceLevel = 'high' | 'medium' | 'low';

export interface CandidateConfidence {
  level: ConfidenceLevel;
  version: string;
  /** 판정 이유 코드 */
  reasons: string[];
  /** 반영률 — 정확도가 아니라 처리 범위다. 적용 대상 자체가 불명확하면 targetUnclear */
  coverage: { applied: number; total: number; targetUnclear: boolean };
}

export interface RuleEngineInput {
  lawBefore: string | null;
  lawAfter: string | null;
  baseContent: string;
  relationType: LawRelation;
  scope: string | null;
  evidenceText: string | null;
  /** 변수 값 넣기 제안(T-109 ②) — 기준 본문 위치 */
  variables?: VariableProposal[];
}

export interface RuleEngineResult {
  /** 연혁 표기를 뺀 실질 법령 변경이 있는가. 없으면 후보를 만들지 않는다 */
  substantive: boolean;
  lawChanges: LawTextChange[];
  /** 제2 조문(후보 본문). 반영한 것이 없으면 제1 조문 그대로 */
  content: string;
  applications: RuleApplication[];
  /** 변수 값을 넣은 자리(T-109 ②) */
  variableApplications: VariableApplication[];
  /** 법령 개정과 겹쳐 넣지 않은 변수 제안(`ref`) */
  variableConflicts: number[];
  unmapped: UnmappedLawChange[];
  conflicts: RuleConflict[];
  flags: ReviewFlag[];
  confidence: CandidateConfidence;
  /** 제1 조문 대 후보의 실제 차이 — 규칙 기록과 따로 계산한다 */
  diff: CandidateDiff;
}

interface Edit {
  start: number;
  end: number;
  replacement: string;
  rule: RuleKey;
  template: TemplateKey;
  lawChangeIndexes: number[];
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** 공백 차이("100분의 50"/"100분의50", "개인정보 보호법"/"개인정보보호법")는 같은 문구로 본다 */
function phrasePattern(phrase: string): string {
  return phrase
    .trim()
    .split(/\s+/)
    .map(escapeRe)
    .join('\\s*');
}

const compact = (s: string) => s.replace(/\s+/g, '');

/**
 * 연결의 근거 문구가 가리키는 우리 조문의 문장들. 근거 문구가 문장 일부를 옮겨 적었거나
 * 문장이 근거 문구 안에 들어 있으면 그 문장이다. 못 찾으면 빈 배열(좁힐 수 없음).
 */
function evidenceSentences(base: string, evidence: string | null): SentenceRange[] {
  const ev = compact(evidence ?? '');
  if (ev.length < 4) return [];
  return sentenceRanges(base).filter((s) => {
    const st = compact(s.text);
    return st.length >= 4 && (st.includes(ev) || ev.includes(st));
  });
}

/** 여러 곳에서 찾은 위치를 근거 문장으로 좁힌다. 하나로 특정되면 그 위치, 아니면 null */
function pickOccurrence<T extends { start: number; end: number }>(
  occurrences: T[],
  narrowTo: SentenceRange[],
): { pick: T | null; detail?: string } {
  if (occurrences.length === 1) return { pick: occurrences[0] };
  const within = narrowTo.length
    ? occurrences.filter((o) => narrowTo.some((s) => s.start <= o.start && o.end <= s.end))
    : [];
  if (within.length === 1) return { pick: within[0] };
  const detail = narrowTo.length
    ? `같은 문구가 ${occurrences.length}곳에 있고 근거 문장 안에도 ${within.length}곳이라 어느 것을 고칠지 정할 수 없습니다`
    : `같은 문구가 ${occurrences.length}곳에 있고 근거 문구로 좁힐 수 없습니다`;
  return { pick: null, detail };
}

// ── 조사 맞춤 ────────────────────────────────────────────────────────────

const HANGUL_BASE = 0xac00;
const HANGUL_LAST = 0xd7a3;
const isHangul = (ch: string | undefined) =>
  !!ch && ch.charCodeAt(0) >= HANGUL_BASE && ch.charCodeAt(0) <= HANGUL_LAST;
const jong = (ch: string) => (ch.charCodeAt(0) - HANGUL_BASE) % 28;

/** 새 용어 뒤에 올 조사. 받침과 무관한 조사("에게", "의")는 그대로, 판단할 수 없으면 null */
export function adjustParticle(term: string, particle: string): string | null {
  if (!particle) return '';
  const last = term[term.length - 1];
  const pairOf = (pairs: Array<[string, string]>) => pairs.find(([w, wo]) => particle === w || particle === wo);
  const ro = pairOf(RO_PAIRS);
  const plain = pairOf(PARTICLE_PAIRS);
  if (!ro && !plain) return particle;
  if (!isHangul(last)) return null; // 영문·숫자로 끝나는 용어는 읽는 법을 모른다
  const j = jong(last);
  if (ro) return j === 0 || j === 8 ? ro[1] : ro[0];
  return j === 0 ? plain![1] : plain![0];
}

/**
 * 용어 뒤의 꼬리 — 조사(복수 "들" 포함) 뒤에 한글이 더 이어지지 않아야 한다.
 * "근로자에게"·"근로자들은"은 되고, "근로자대표"(합성어)는 안 된다 → null
 */
function particleAfter(text: string, at: number): { particle: string; plural: string } | null {
  let pos = at;
  let plural = '';
  if (text.startsWith('들', pos)) {
    plural = '들';
    pos += 1;
  }
  if (!isHangul(text[pos])) return { particle: '', plural };
  for (const p of PARTICLES) {
    if (text.startsWith(p, pos) && !isHangul(text[pos + p.length])) return { particle: p, plural };
  }
  return null;
}

// ── 규칙 ────────────────────────────────────────────────────────────────

type Proposal = { edit: Edit } | { unmapped: UnmappedReason; detail?: string };

function valueRule(base: string, change: LawTextChange, narrowTo: SentenceRange[], indexes: number[]): Proposal {
  const pat = phrasePattern(change.before);
  const endsWithDigit = /\d$/.test(change.before.trim());
  const re = new RegExp(`(?<![\\d.,])${pat}${endsWithDigit ? '(?!\\d)' : ''}`, 'g');
  const occ = [...base.matchAll(re)].map((m) => ({ start: m.index ?? 0, end: (m.index ?? 0) + m[0].length }));
  if (!occ.length) return { unmapped: 'no_correspondence' };
  const { pick, detail } = pickOccurrence(occ, narrowTo);
  if (!pick) return { unmapped: 'ambiguous', detail };
  return {
    edit: { ...pick, replacement: change.after, rule: 'VALUE', template: 'INLINE', lawChangeIndexes: indexes },
  };
}

function termRule(base: string, change: LawTextChange, narrowTo: SentenceRange[], indexes: number[]): Proposal {
  const re = new RegExp(`(?<![가-힣])${phrasePattern(change.before)}`, 'g');
  const all = [...base.matchAll(re)].map((m) => ({ start: m.index ?? 0, end: (m.index ?? 0) + m[0].length }));
  if (!all.length) return { unmapped: 'no_correspondence' };
  const { pick, detail } = pickOccurrence(all, narrowTo);
  if (!pick) return { unmapped: 'ambiguous', detail };

  const tail = particleAfter(base, pick.end);
  if (!tail) {
    return { unmapped: 'context_unclear', detail: `"${change.before}" 뒤에 다른 낱말이 이어져(합성어 등) 고치지 않았습니다` };
  }
  // 복수 "들"이 있으면 조사는 "들"에 붙으므로 그대로 둔다
  const particle = tail.plural ? tail.particle : adjustParticle(change.after, tail.particle);
  if (particle === null) {
    return { unmapped: 'context_unclear', detail: `"${change.after}" 뒤 조사를 정할 수 없어 고치지 않았습니다` };
  }
  if (!tail.plural && particle !== tail.particle) {
    const end = pick.end + tail.particle.length;
    return {
      edit: {
        start: pick.start,
        end,
        replacement: `${change.after}${particle}`,
        rule: 'TERM',
        template: 'INLINE',
        lawChangeIndexes: indexes,
      },
    };
  }
  return { edit: { ...pick, replacement: change.after, rule: 'TERM', template: 'INLINE', lawChangeIndexes: indexes } };
}

const QUOTE_MIN_CHARS = 10;

/**
 * 인용 문장 규칙 — 법 문장이 바뀐 곳마다 변경 전 문장이 우리 조문에 **그대로** 한 번 있으면
 * 변경 후 문장으로 바꾼다. 변경 전후 문장이 1:1 로 짝지어지는 경우(완결 문장끼리의 대체)만 한다.
 * 그 문장 안의 법령 변경은 모두 이 적용이 반영한 것으로 본다.
 */
function quoteEdits(
  base: string,
  lawBefore: string,
  lawAfter: string,
  changes: LawTextChange[],
): { edits: Edit[]; covered: Set<number> } {
  const bs = sentenceRanges(lawBefore);
  const as = sentenceRanges(lawAfter);
  const parts = Diff.diffArrays(
    bs.map((s) => s.text),
    as.map((s) => s.text),
  );
  const edits: Edit[] = [];
  const covered = new Set<number>();
  let ib = 0;
  let ia = 0;
  for (let k = 0; k < parts.length; k++) {
    const p = parts[k];
    if (!p.added && !p.removed) {
      ib += p.count ?? 0;
      ia += p.count ?? 0;
      continue;
    }
    // 삭제 덩어리 바로 뒤의 추가 덩어리와 짝을 짓는다 — 개수가 같을 때만(문장끼리 대체)
    if (p.removed && parts[k + 1]?.added && (p.count ?? 0) === (parts[k + 1].count ?? 0)) {
      const n = p.count ?? 0;
      for (let t = 0; t < n; t++) {
        const oldS = bs[ib + t];
        const newS = as[ia + t];
        if (oldS.text.length < QUOTE_MIN_CHARS || isRepealedLawText(newS.text)) continue;
        const re = new RegExp(phrasePattern(oldS.text), 'g');
        const occ = [...base.matchAll(re)];
        if (occ.length !== 1) continue;
        const inside = changes
          .filter(
            (c) =>
              (c.beforeRange.start >= oldS.start && c.beforeRange.end <= oldS.end && c.beforeRange.end > c.beforeRange.start) ||
              (c.afterRange.start >= newS.start && c.afterRange.end <= newS.end && c.afterRange.end > c.afterRange.start),
          )
          .map((c) => c.index);
        if (!inside.length) continue;
        inside.forEach((i) => covered.add(i));
        const start = occ[0].index ?? 0;
        edits.push({
          start,
          end: start + occ[0][0].length,
          replacement: newS.text,
          rule: 'QUOTE',
          template: 'SENTENCE',
          lawChangeIndexes: inside,
        });
      }
      ib += n;
      ia += n;
      k++;
      continue;
    }
    if (p.removed) ib += p.count ?? 0;
    else ia += p.count ?? 0;
  }
  return { edits, covered };
}

// ── 엔진 ────────────────────────────────────────────────────────────────

function uniq<T>(xs: T[]): T[] {
  return [...new Set(xs)];
}

/** 겹치는 제안끼리 묶어, 같은 자리에 같은 문구면 하나로 합치고 다르면 충돌로 뺀다 */
function resolveConflicts(edits: Edit[], base: string): { accepted: Edit[]; conflicts: RuleConflict[]; conflicted: number[] } {
  const sorted = [...edits].sort((x, y) => x.start - y.start || x.end - y.end);
  const groups: Edit[][] = [];
  for (const e of sorted) {
    const g = groups[groups.length - 1];
    const gEnd = g ? Math.max(...g.map((x) => x.end)) : -1;
    if (g && e.start < gEnd) g.push(e);
    else groups.push([e]);
  }
  const accepted: Edit[] = [];
  const conflicts: RuleConflict[] = [];
  const conflicted: number[] = [];
  for (const g of groups) {
    const same = g.every((e) => e.start === g[0].start && e.end === g[0].end && e.replacement === g[0].replacement);
    if (same) {
      accepted.push({ ...g[0], lawChangeIndexes: uniq(g.flatMap((e) => e.lawChangeIndexes)) });
      continue;
    }
    const start = Math.min(...g.map((e) => e.start));
    const end = Math.max(...g.map((e) => e.end));
    conflicts.push({
      base: { start, end, text: base.slice(start, end) },
      proposals: g.map((e) => ({ ruleId: RULES[e.rule].id, lawChangeIndexes: e.lawChangeIndexes, replacement: e.replacement })),
    });
    conflicted.push(...g.flatMap((e) => e.lawChangeIndexes));
  }
  return { accepted, conflicts, conflicted: uniq(conflicted) };
}

/** 법령 규칙의 고침과 변수 값 넣기를 한 번에, 앞에서부터 이어 붙인다(서로 겹치지 않는 것만 들어온다) */
function applyEdits(
  base: string,
  edits: Edit[],
  variables: VariableProposal[] = [],
): { content: string; applications: RuleApplication[]; variableApplications: VariableApplication[] } {
  const all = [
    ...edits.map((e) => ({ start: e.start, end: e.end, replacement: e.replacement, law: e, ref: -1 })),
    ...variables.map((v) => ({ start: v.start, end: v.end, replacement: v.replacement, law: null as Edit | null, ref: v.ref })),
  ].sort((x, y) => x.start - y.start);
  let out = '';
  let pos = 0;
  const applications: RuleApplication[] = [];
  const variableApplications: VariableApplication[] = [];
  for (const e of all) {
    out += base.slice(pos, e.start);
    const cStart = out.length;
    out += e.replacement;
    const span = { base: { start: e.start, end: e.end, text: base.slice(e.start, e.end) }, candidate: { start: cStart, end: out.length, text: e.replacement } };
    if (e.law) {
      applications.push({
        id: applications.length,
        ruleId: RULES[e.law.rule].id,
        ruleVersion: RULES[e.law.rule].version,
        templateId: TEMPLATES[e.law.template].id,
        templateVersion: TEMPLATES[e.law.template].version,
        lawChangeIndexes: e.law.lawChangeIndexes,
        ...span,
      });
    } else {
      variableApplications.push({ ref: e.ref, ...span });
    }
    pos = e.end;
  }
  out += base.slice(pos);
  return { content: out, applications, variableApplications };
}

/**
 * 변수 값 넣기 제안을 법령 고침과 맞춘다(T-109 ②, 코덱스 자문 결정 6). 법령 고침이나 법령 규칙끼리의 충돌 자리와 겹치면
 * 그 자리는 원문을 두고 양쪽 제안을 남긴다 — 겹친 법령 고침도 빼서 반영하지 못한 변경(충돌)으로 돌린다.
 */
function mergeVariables(base: string, lawEdits: Edit[], conflicts: RuleConflict[], variables: VariableProposal[]) {
  const hits = (a: { start: number; end: number }, b: { start: number; end: number }) => a.start < b.end && b.start < a.end;
  const kept = [...lawEdits];
  const accepted: VariableProposal[] = [];
  const held: number[] = [];
  const dropped: number[] = [];
  const outConflicts = conflicts.map((c) => ({ ...c, proposals: [...c.proposals] }));
  for (const v of [...variables].sort((x, y) => x.start - y.start)) {
    const proposal = { ruleId: 'variable_value', lawChangeIndexes: [] as number[], replacement: v.replacement, variableRef: v.ref };
    const lawHit = kept.filter((e) => hits(e, v));
    const conflictHit = outConflicts.find((c) => hits(c.base, v));
    if (!lawHit.length && !conflictHit && !accepted.some((a) => hits(a, v))) {
      accepted.push(v);
      continue;
    }
    held.push(v.ref);
    if (conflictHit) {
      conflictHit.proposals.push(proposal);
      continue;
    }
    if (!lawHit.length) continue; // 변수끼리 겹침 — 앞의 것을 넣고 뒤의 것은 둔다
    for (const e of lawHit) kept.splice(kept.indexOf(e), 1);
    dropped.push(...lawHit.flatMap((e) => e.lawChangeIndexes));
    const start = Math.min(v.start, ...lawHit.map((e) => e.start));
    const end = Math.max(v.end, ...lawHit.map((e) => e.end));
    outConflicts.push({
      base: { start, end, text: base.slice(start, end) },
      proposals: [
        ...lawHit.map((e) => ({ ruleId: RULES[e.rule].id, lawChangeIndexes: e.lawChangeIndexes, replacement: e.replacement })),
        proposal,
      ],
    });
  }
  return { lawEdits: kept, variables: accepted, held, dropped: uniq(dropped), conflicts: outConflicts };
}

function judgeConfidence(
  total: number,
  appliedIndexes: Set<number>,
  flags: Set<ReviewFlag>,
  targetUnclear: boolean,
): CandidateConfidence {
  const applied = appliedIndexes.size;
  const reasons: string[] = [];
  const negatives: Array<[ReviewFlag, string]> = [
    ['ambiguous_match', 'ambiguous'],
    ['rule_conflict', 'conflict'],
    ['variable_conflict', 'variable_conflict'],
    ['context_unclear', 'context_unclear'],
    ['unexplained_change', 'unexplained'],
  ];
  for (const [flag, code] of negatives) if (flags.has(flag)) reasons.push(code);
  if (targetUnclear) reasons.push('target_unclear');
  let level: ConfidenceLevel;
  if (applied === 0) {
    reasons.unshift('none_applied');
    level = 'low';
  } else if (reasons.length) {
    reasons.unshift(applied === total ? 'all_applied' : 'partially_applied');
    level = 'low';
  } else if (applied === total) {
    reasons.unshift('all_applied');
    level = 'high';
  } else {
    reasons.unshift('partially_applied');
    level = 'medium';
  }
  return { level, version: CONFIDENCE_VERSION, reasons, coverage: { applied, total, targetUnclear } };
}

export function generateRuleCandidate(input: RuleEngineInput): RuleEngineResult {
  const base = input.baseContent ?? '';
  const lawBefore = stripLawAnnotations(input.lawBefore ?? '');
  const lawAfter = stripLawAnnotations(input.lawAfter ?? '');
  const lawChanges = diffLawText(input.lawBefore, input.lawAfter);
  const flags = new Set<ReviewFlag>();
  const unmapped: UnmappedLawChange[] = [];
  const all = lawChanges.map((c) => c.index);

  const finish = (lawEdits: Edit[], lawConflicts: RuleConflict[], targetUnclear: boolean): RuleEngineResult => {
    const merged = mergeVariables(base, lawEdits, lawConflicts, input.variables ?? []);
    if (merged.held.length) flags.add('variable_conflict');
    for (const i of merged.dropped) {
      unmapped.push({ lawChangeIndex: i, reason: 'conflict', detail: '변수 값을 넣을 자리와 겹쳐 원문을 두었습니다' });
    }
    const conflicts = merged.conflicts;
    const { content, applications, variableApplications } = applyEdits(base, merged.lawEdits, merged.variables);
    const diff = diffCandidate(
      base,
      content,
      applications,
      variableApplications.map((v) => ({ id: v.ref, base: v.base, candidate: v.candidate })),
    );
    if (diff.unexplained > 0) flags.add('unexplained_change');
    const appliedIdx = new Set(applications.flatMap((a) => a.lawChangeIndexes));
    if (unmapped.length) flags.add('unmapped_law_change');
    if (!applications.length && lawChanges.length) flags.add('manual_draft_required');
    return {
      substantive: lawChanges.length > 0,
      lawChanges,
      content,
      applications,
      variableApplications,
      variableConflicts: merged.held,
      unmapped: unmapped.sort((x, y) => x.lawChangeIndex - y.lawChangeIndex),
      conflicts,
      flags: [...flags],
      confidence: judgeConfidence(lawChanges.length, appliedIdx, flags, targetUnclear),
      diff,
    };
  };

  if (!lawChanges.length) return finish([], [], false);

  // 법령 조항 삭제("삭제 <날짜>") — 법이 의무를 없앴다고 회사 규정 문장을 지울 근거는 아니다
  if (isRepealedLawText(input.lawAfter) && !isRepealedLawText(input.lawBefore)) {
    flags.add('law_provision_repealed');
    all.forEach((i) => unmapped.push({ lawChangeIndex: i, reason: 'repealed' }));
    return finish([], [], false);
  }
  if (!AUTO_RELATIONS.has(input.relationType)) {
    flags.add('relation_review_only');
    all.forEach((i) => unmapped.push({ lawChangeIndex: i, reason: 'relation_review_only' }));
    return finish([], [], true);
  }
  if ((input.scope ?? '').trim()) {
    flags.add('scope_review');
    all.forEach((i) => unmapped.push({ lawChangeIndex: i, reason: 'scope_review', detail: input.scope!.trim() }));
    return finish([], [], true);
  }

  const narrowTo = evidenceSentences(base, input.evidenceText);
  const quote = quoteEdits(base, lawBefore, lawAfter, lawChanges);
  const quoteSpans = quote.edits.map((e) => ({ start: e.start, end: e.end }));
  const insideQuote = (e: Edit) => quoteSpans.some((q) => q.start <= e.start && e.end <= q.end);

  // 같은 변경(예: 한 조항에 두 번 나온 같은 용어 변경)은 한 번만 적용하고 근거는 모두 잇는다
  const groups = new Map<string, number[]>();
  for (const c of lawChanges) {
    if (quote.covered.has(c.index)) continue;
    const key = `${c.kind}\u0000${c.before}\u0000${c.after}`;
    groups.set(key, [...(groups.get(key) ?? []), c.index]);
  }

  const edits: Edit[] = [...quote.edits];
  for (const indexes of groups.values()) {
    const change = lawChanges[indexes[0]];
    let proposal: Proposal;
    if (change.kind === 'value') proposal = valueRule(base, change, narrowTo, indexes);
    else if (change.kind === 'term') proposal = termRule(base, change, narrowTo, indexes);
    else proposal = { unmapped: change.kind === 'sentence' ? 'no_correspondence' : 'unsupported' };

    if ('edit' in proposal) {
      // 인용 문장 교체 안에 들어가는 자리는 그 교체가 이미 반영한다
      if (insideQuote(proposal.edit)) {
        const q = quote.edits.find((e) => e.start <= proposal.edit.start && proposal.edit.end <= e.end)!;
        q.lawChangeIndexes = uniq([...q.lawChangeIndexes, ...indexes]);
      } else {
        edits.push(proposal.edit);
      }
      continue;
    }
    if (proposal.unmapped === 'ambiguous') flags.add('ambiguous_match');
    if (proposal.unmapped === 'context_unclear') flags.add('context_unclear');
    for (const i of indexes) unmapped.push({ lawChangeIndex: i, reason: proposal.unmapped, detail: proposal.detail });
  }

  const { accepted, conflicts, conflicted } = resolveConflicts(edits, base);
  if (conflicts.length) {
    flags.add('rule_conflict');
    for (const i of conflicted) unmapped.push({ lawChangeIndex: i, reason: 'conflict' });
  }
  return finish(accepted, conflicts, false);
}
