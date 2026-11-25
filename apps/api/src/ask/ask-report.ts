import { VERDICTS, type AnswerBlock, type ReviewRow, type Verdict } from './ask-text';
import { REPORT_SCHEMA, REPORT_SYSTEM } from './ask-report-prompt';

export { REPORT_SCHEMA, REPORT_SYSTEM };

/**
 * T-207 규정 질문 답 모양 고정 — 검토 보고서형 (SRS SEARCH-7, ADR-0028). DB·AI 를 부르지 않는 순수 함수 모음.
 *
 * AI 는 정해진 칸만 JSON 으로 채운다(`ask-report-prompt.ts`). 순서·제목·표 머리는 서버와 화면이 정한다 — 어느 모델이
 * 답하든, 모델이 마크다운을 어떻게 쓰든 같은 모양으로 나간다. 칸에서 고칠 수 있는 것(판단 표기의 흔한 변형, 굵게 짝,
 * 본문에 섞인 근거 번호)은 고치고, 고칠 수 없는 것(직답·표·종합 의견이 비었거나, 판단을 알아볼 수 없거나, 근거가 하나도
 * 없음)은 형식 미달로 본다 — 제공사가 다음 허용 모델로 다시 받는다(`problem`). 알아볼 수 없는 판단을 '추가 확인 필요'로
 * 덮지 않는다 — 실패를 정상처럼 보이게 하지 않으려고.
 */

const LIMIT = { rows: 10, priorities: 5, lead: 700, cell: 300, title: 80, detail: 400, conclusion: 700, basis: 500 };

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);

/**
 * 판단 표기의 흔한 변형 — 순서가 중요하다. '부분'은 부정형보다, 부정형('부합하지 않음'·'미준수')은 '대체로'·'부합'보다 먼저
 * 본다 — 그러지 않으면 "법령에 맞지 않는다"가 초록 '부합'으로 찍힌다.
 */
const VERDICT_ALIASES: [RegExp, Verdict][] = [
  [/해당\s*(사항\s*)?(없|하지\s*않|안\s*됨)|무관|적용\s*(대상\s*)?(아님|없|외)/, '해당 없음'],
  [/위반\s*(사항\s*)?없/, '부합'],
  [/확인|불명|불분명|불확실|모호|애매|판단\s*(불가|어려)|검토\s*필요|여부/, '추가 확인 필요'],
  [/(?<!대)부분|일부/, '부분 부합'],
  // 부정·결함 표지가 하나라도 있으면 '보완 필요' — 아래 긍정 규칙에 닿기 전에 걸러 '맞지 않는다'가 초록으로 찍히지 않게
  [/않|아니|아님|못|안\s*(함|됨|된|한)|어려|곤란|불|미\s*(준수|충족|이행)|비준수|부적|위반|미흡|미비|부족|누락|결여|보완|개정\s*필요/, '보완 필요'],
  [/대체로|대부분|대체적|전반적/, '대체로 부합'],
  [/부합|적합|충족|일치|준수|양호|적정/, '부합'],
];

/** 판단을 여섯 값 중 하나로 맞춘다. 알아볼 수 없으면 null(형식 미달) */
export function normalizeVerdict(v: unknown): Verdict | null {
  const s = typeof v === 'string' ? v.replace(/[*_`]/g, '').trim() : '';
  if (!s) return null;
  if ((VERDICTS as readonly string[]).includes(s)) return s as Verdict;
  for (const [re, out] of VERDICT_ALIASES) if (re.test(s)) return out;
  return null;
}

/** 굵게(`**`)는 짝이 맞을 때만 남긴다 — 짝이 어긋나면 별표를 모두 지워 글자 그대로 보이지 않게 한다 */
function balanceBold(s: string): string {
  let out = s.replace(/\*{3,}/g, '**').replace(/\*\*\s*\*\*/g, '');
  if ((out.match(/\*\*/g) ?? []).length % 2 === 1) out = out.replace(/\*\*/g, '');
  return out.replace(/(?<!\*)\*(?!\*)/g, '');
}

/**
 * 문장 칸 정리 — HTML 태그, 본문에 섞인 근거 번호([R3]·(R3, L1)), 제목·코드 표시를 지우고 공백을 한 칸으로 줄인다.
 * 화면은 `**` 만 굵게로 바꾸고 나머지는 글자 그대로 그린다(HTML 로 바꾸지 않는다). `bold=false` 면 굵게도 지운다(표 칸).
 */
export function cleanInline(v: unknown, max: number, bold = true): string {
  if (typeof v !== 'string') return '';
  let s = v
    .replace(/<[^>]{0,200}>/g, '')
    .replace(/[[(（]\s*[RL]\d+(?:\s*[,，·]\s*[RL]\d+)*\s*[\])）]/g, '')
    .replace(/__([^_\n]+)__/g, '**$1**')
    .replace(/(^|\s)#{1,6}\s+/g, '$1')
    .replace(/`+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (s.length > max) s = `${s.slice(0, max - 1).trimEnd()}…`;
  s = balanceBold(s);
  return bold ? s.trim() : s.replace(/\*\*/g, '').trim();
}

const JO_IN_TEXT = /\s*제\s*\d+\s*조(?:\s*의\s*\d+)?(?:\s*제\s*\d+\s*항)?(?:\s*제\s*\d+\s*호)?/g;

/** '제29조의2' 꼴의 조 표기 — 법령 조문 라벨('제29조의2제1항')과 법령 칸 글자를 같은 키로 맞춘다 */
export function joKeyOf(label: string): string | null {
  const m = /제\s*(\d+)\s*조(?:\s*의\s*(\d+))?/.exec(label);
  return m ? `제${m[1]}조${m[2] ? `의${m[2]}` : ''}` : null;
}

/**
 * 법령 칸에서 준 법령 조문(<법령>) 밖의 조 번호를 지운다 — 법령 이름은 남긴다(SEARCH-4 "조항 번호를 지어내지 않는다").
 * 조 번호만 보고 법령 이름까지 맞추지는 않는다(다른 법의 같은 번호는 남는다). 완전한 차단이 아니라 화면이 '참고 의견'을 함께 보인다.
 */
export function stripUngroundedJo(text: string, lawJo: Set<string>): string {
  const out = text
    .replace(JO_IN_TEXT, (m) => (lawJo.has(joKeyOf(m) ?? '') ? m : ''))
    .replace(/\s+([,·)])/g, '$1')
    .replace(/([,·])(\s*[,·])+/g, '$1')
    .replace(/[,·]\s*$/, '')
    .replace(/\(\s*\)/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
  return out || text.replace(JO_IN_TEXT, '').trim();
}

const LAW_JO_IN_TEXT = /([가-힣A-Za-z·]*(?:법률|법|시행령|시행규칙))(\s*)(제\s*\d+\s*조(?:\s*의\s*\d+)?(?:\s*제\s*\d+\s*항)?(?:\s*제\s*\d+\s*호)?)/g;

/**
 * 법령 칸 밖의 문장(직답·권고·종합 의견 등)에서 '법령 이름 + 조 번호' 꼴의 조 번호도 준 법령 조문 밖이면 지운다(SEARCH-4).
 * 회사 규정의 조('제2조', '취업규칙 제5조')는 건드리지 않는다 — 이름이 법·법률·시행령·시행규칙으로 끝날 때만 본다.
 */
export function stripLawJoInText(text: string, lawJo: Set<string>): string {
  return text.replace(LAW_JO_IN_TEXT, (m: string, name: string, _sp: string, jo: string, at: number) => {
    // '시행령'·'시행규칙'만 떨어져 있으면 앞 낱말이 법일 때만 법령이다 — '여비규정 시행규칙 제5조' 같은 회사 문서는 그대로 둔다
    if (/^(시행령|시행규칙)$/.test(name) && !/(법|법률)\s*$/.test(text.slice(0, at))) return m;
    return lawJo.has(joKeyOf(jo) ?? '') ? m : name;
  });
}

/** 근거 번호 목록 — 준 번호 안에 있는 것만 처음 나온 순서대로. 준 적 없는 번호 수도 센다(기록용) */
function pickRefs(v: unknown, allowed: Set<string>): { kept: string[]; dropped: number } {
  const kept: string[] = [];
  let dropped = 0;
  for (const c of Array.isArray(v) ? v : []) {
    if (typeof c !== 'string') continue;
    const ref = c.trim().replace(/^\[|\]$/g, '');
    if (!allowed.has(ref)) {
      dropped += 1;
      continue;
    }
    if (!kept.includes(ref)) kept.push(ref);
  }
  return { kept, dropped };
}

/** 검토 행 하나. 영역·현재 상태가 비면 버리는 행(null), 판단을 알아볼 수 없으면 형식 미달('bad') */
function toRow(v: unknown, lawJo: Set<string>): ReviewRow | null | 'bad' {
  if (!isObj(v)) return null;
  const area = cleanInline(v.area, LIMIT.title, false);
  const current = cleanInline(v.current, LIMIT.cell, false);
  if (!area || !current) return null;
  const verdict = normalizeVerdict(v.verdict);
  if (!verdict) return 'bad';
  const law = stripUngroundedJo(cleanInline(v.law, LIMIT.cell, false), lawJo);
  const advice = stripLawJoInText(cleanInline(v.advice, LIMIT.cell, false), lawJo);
  return { area, law: law || '—', current, verdict, advice: advice || '—' };
}

const NEEDS_AMEND: ReadonlySet<Verdict> = new Set<Verdict>(['부분 부합', '보완 필요']);

/** 검사에 쓰는 이번 질문의 근거 — AI 에 준 것들 */
export interface ReportContext {
  /** 준 규정 참조 번호(R) */
  refs: Set<string>;
  /** 준 법령 참조 번호(L) */
  lawRefs?: Set<string>;
  /** 준 법령 조문의 조 표기(예: '제29조') — 법령 칸에서 이것 밖의 조 번호는 지운다 */
  lawJo?: Set<string>;
  /** 근거 요약이 비었을 때 쓸 문장 — 인용한 조문 목록으로 서버가 만든다 */
  basisFrom?: (refs: string[]) => string;
}

export interface CheckedReport {
  answerable: boolean;
  blocks: AnswerBlock[];
  /** 준 규정 참조 번호 중 실제로 있는 것만, 처음 나온 순서대로 */
  citations: string[];
  /** 준 법령 참조 번호(L) 중 실제로 있는 것만 */
  lawCitations: string[];
  /** 준 적 없는 번호를 근거로 댄 수(규정·법령 합) — 기록용 */
  droppedCitations: number;
  /**
   * 형식 미달 사유 — 답하겠다고 했는데 직답·표·종합 의견이 비었거나, 판단을 알아볼 수 없거나, 근거가 하나도 남지 않았다.
   * 제공사가 다음 허용 모델로 다시 받는다. AI 가 답할 수 없다고 한 것(answerable:false)은 형식 미달이 아니다(null).
   */
  problem: 'lead' | 'rows' | 'verdict' | 'conclusion' | 'citations' | null;
}

/**
 * AI 가 채운 칸을 검사해 고정된 순서의 블록으로 바꾼다 — [직답, 검토 표, 우선 권고(또는 핵심 정리), 종합 의견, 근거 요약].
 * **근거(R)가 하나도 남지 않으면 답하지 않은 것으로 본다** — 근거 없는 답은 규정 해석으로 오해받는다(SEARCH-4).
 */
export function checkReport(raw: unknown, ctx: ReportContext): CheckedReport {
  const obj = isObj(raw) ? raw : {};
  const lawJo = ctx.lawJo ?? new Set<string>();
  const refs = pickRefs(obj.citations, ctx.refs);
  const lawRefs = pickRefs(obj.lawCitations, ctx.lawRefs ?? new Set());
  const none = (problem: CheckedReport['problem']): CheckedReport => ({
    answerable: false,
    blocks: [],
    citations: [],
    lawCitations: [],
    droppedCitations: refs.dropped + lawRefs.dropped,
    problem,
  });
  if (obj.answerable !== true) return none(null);

  // 법령 칸 밖의 문장도 준 법령 조문 밖의 '법령 이름 + 조 번호'는 조 번호를 지운다(M4)
  const text = (v: unknown, max: number, bold = true) => stripLawJoInText(cleanInline(v, max, bold), lawJo);
  const lead = text(obj.lead, LIMIT.lead);
  const parsed = (Array.isArray(obj.rows) ? obj.rows : []).map((r) => toRow(r, lawJo));
  const rows = parsed.filter((r): r is ReviewRow => !!r && r !== 'bad').slice(0, LIMIT.rows);
  const conclusion = text(obj.conclusion, LIMIT.conclusion);
  if (!lead) return none('lead');
  if (parsed.includes('bad')) return none('verdict');
  if (!rows.length) return none('rows');
  if (!conclusion) return none('conclusion');
  if (!refs.kept.length) return none('citations');

  // 목록 종류는 표로만 정한다 — 고칠 행이 있으면 '우선 개정 권고', 없으면 '핵심 정리'(모델의 listKind 는 보지 않는다)
  const needsAmend = rows.some((r) => NEEDS_AMEND.has(r.verdict));
  const kind: 'amend' | 'summary' = needsAmend ? 'amend' : 'summary';
  let items = (Array.isArray(obj.priorities) ? obj.priorities : [])
    .map((p) =>
      isObj(p) ? { title: text(p.title, LIMIT.title, false), detail: text(p.detail, LIMIT.detail) } : null,
    )
    .filter((p): p is { title: string; detail: string } => !!p && !!p.title)
    .slice(0, LIMIT.priorities);
  if (!items.length) {
    // 목록을 비워 왔으면 표에서 만든다 — 모양(목록이 늘 있음)을 지키려고. 내용은 표에 이미 있는 것뿐이다
    const from = kind === 'amend' ? rows.filter((r) => NEEDS_AMEND.has(r.verdict)) : rows;
    items = (from.length ? from : rows)
      .slice(0, LIMIT.priorities)
      .map((r) => ({ title: r.area, detail: r.advice !== '—' && r.advice !== '현행 유지' ? r.advice : r.current }));
  }
  const basis = cleanInline(obj.basis, LIMIT.basis) || cleanInline(ctx.basisFrom?.(refs.kept) ?? '', LIMIT.basis);

  const blocks: AnswerBlock[] = [
    { type: 'paragraph', text: lead },
    { type: 'review', rows },
    { type: 'priorities', kind, items },
    { type: 'paragraph', text: conclusion },
  ];
  if (basis) blocks.push({ type: 'paragraph', text: basis });
  return {
    answerable: true,
    blocks,
    citations: refs.kept,
    lawCitations: lawRefs.kept,
    droppedCitations: refs.dropped + lawRefs.dropped,
    problem: null,
  };
}

/**
 * 제공사가 받은 답을 받아들일지 — AI 가 답할 수 없다고 했으면 받아들이고(다른 모델로 다시 묻지 않는다), 답하겠다고 했는데
 * 칸이 비었거나 판단을 알아볼 수 없으면 다음 모델로 다시 받는다(false). 준 적 없는 근거만 댄 답('citations')도 다음 모델로
 * 다시 받되(SEARCH-7), 끝내 더 나은 답이 없으면 그 답을 쓴다('last-resort') — SEARCH-4 대로 '근거 없음'으로 끝나 직원이
 * 살펴본 조문을 직접 확인하게 한다(T-130 부터의 동작). 모델 하나만 쓰는 제공사는 'last-resort' 를 받아들인 것으로 본다.
 */
export function reportAcceptor(ctx: ReportContext) {
  return (raw: unknown): boolean | 'last-resort' => {
    if (!isObj(raw)) return false;
    if (raw.answerable === false) return true;
    if (raw.answerable !== true) return false;
    const problem = checkReport(raw, ctx).problem;
    if (problem === 'citations') return 'last-resort';
    return problem === null;
  };
}
