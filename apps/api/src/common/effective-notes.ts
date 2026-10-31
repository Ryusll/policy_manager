/**
 * 조문별 시행일 표기 (T-144, PAT-06 — 특허 도 7 S760 "조항별 시행일 구분 저장").
 *
 * 한 번의 개정 안에서도 조마다 시행일이 다를 수 있다("다만, 제3조는 공포한 날부터 시행한다"). 법제처 응답을 조사해 보니
 * (본문 조회, 법령 38건·조 5,062개) 구조화된 `조문시행일자` 는 **언제나 그 판의 시행일자와 같았다.** 조마다 다른 시행일은
 * 글자 표기 `[시행일: 2027.1.1]` 로만 온다 — 조문참고자료(5건)나 조문내용(1건), 조 6개(0.1%). 대부분 조의 **일부**(`제1항 중
 * … 개정부분`)만 다른 날 시행된다. 그래서 날짜 하나로 못 쓰고, **날짜와 범위 문구를 함께** 남긴다.
 *
 * 계획용 날짜(영향 분석·개정 후보의 예정 시행일·변수 값 고르는 날)는 바꾸지 않는다 — 판 시행일 그대로다. 범위를 잘못 읽어
 * 조 전체의 기준일을 옮기면 후보·변수 선택까지 틀어지기 때문이다. 이 표기는 **알려 주기 위한 기록**이다.
 */

export type EffectiveNoteSource = '조문참고자료' | '조문내용' | '항·호·목' | '조문시행일자';

/**
 * 표기 읽는 방법의 판. 읽는 규칙을 고치면 올린다 — 법령 행의 판(`Law.effectiveNotesVersion`)이 다르면 다음 주기 동기화가
 * 그 법령을 다시 읽어 조항의 표기를 새 규칙으로 갈아 쓴다(이벤트는 만들지 않는다)
 */
export const EFFECTIVE_NOTES_VERSION = 1;

export type EffectiveNote = {
  /** 이 표기가 말하는 시행일 YYYY-MM-DD */
  date: string;
  /**
   * `partial` — 표기 뒤 문구가 항·호·목이나 "개정부분"을 가리킨다(조의 일부).
   * `unknown` — 범위를 알 수 없다. 조 전체라고 단정하지 않는다
   */
  scope: 'partial' | 'unknown';
  /** 표기 바로 뒤의 범위 문구(`제5조제1항 중 … 개정부분`·`[별표 2] …`) — 다음 대괄호 표기 앞까지. 범위를 밝힌 문구가 아니면(본문이 이어지면) '' */
  scopeText: string;
  source: EffectiveNoteSource;
  /** 표기 원문 */
  raw: string;
};

const MAX_NOTES = 20;
const MAX_SCOPE_TEXT = 300;
const MAX_RAW = 60;

/** `[시행일: 2027.1.1]` · `[시행일 : 2021.1.26]` · `[시행일: 2027. 1. 1.]` · 전각 콜론 `[시행일：2027.1.1]` */
const MARKER = /\[\s*시행일\s*[:：]\s*(\d{4})\s*\.\s*(\d{1,2})\s*\.\s*(\d{1,2})\s*\.?\s*\]/g;

/** 범위 문구는 다음 대괄호 표기 앞까지 — 단 `[별표 2]`·`[별지 …]` 는 범위 문구의 일부다 */
const NEXT_BRACKET = /\[(?!\s*(?:별표|별지))/g;

/** 범위를 밝힌 문구는 조·항·별표를 가리키며 시작한다. 그 밖(조문내용의 본문이 이어지는 경우 등)은 범위로 쓰지 않는다 */
const SCOPE_START = /^(?:\[?\s*(?:별표|별지)|제\s*\d+\s*(?:조|항|호))/;

/**
 * 항·호·목이나 "개정부분"을 가리키면 조의 일부다. 조 번호만 있으면 알 수 없다.
 * 목은 `가목`~`하목` 14자뿐이다 — `[가-하]` 범위로 쓰면 유니코드 음절 거의 전부(`제목`·`품목`·`과목`)가 걸린다.
 * 앞뒤가 다른 한글이면(`다목적`·`검사목`) 목이 아니다(뒤에 오는 조사는 괜찮다)
 */
const PARTIAL =
  /(제\s*\d+\s*항|제\s*\d+\s*호|(?<![가-힣])[가나다라마바사아자차카타파하]\s*목(?:(?![가-힣])|(?=[의및중에은는이을과와]))|개정\s*부분)/;

/** 범위 문구가 가리키는 조(`제5조`·`제164조의3`) — 여러 조를 늘어놓았으면 이 조가 그중 일부인지 전부인지 알 수 없다 */
const ARTICLE_REF = /제\s*\d+\s*조(?:\s*의\s*\d+)?/g;

/** 달력에 있는 날짜만 — 2월 30일 같은 값은 버린다 */
function isoDate(y: number, m: number, d: number): string | null {
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const t = new Date(Date.UTC(y, m - 1, d));
  if (t.getUTCFullYear() !== y || t.getUTCMonth() !== m - 1 || t.getUTCDate() !== d) return null;
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

const squash = (s: string, max: number) => s.replace(/\s+/g, ' ').trim().slice(0, max);

/**
 * 대상 조·항이 아닌 것 — 괄호 안의 한정 문구(`(제164조의3제1항제1호의 소득에 대한 …)`), 따옴표 안의 바뀌는 문구(`"제1호의 소득"`),
 * 다른 법률의 조(`「소득세법」 제20조`), 법령 번호(`법률 제18425호`·`고용노동부령 제3호` — 호가 아니다. `…령` 의 `령` 한 글자만 먹어 앞 글자를 지우지 않는다)
 */
const NOT_TARGET =
  /\([^()]*\)|"[^"]*"|'[^']*'|“[^”]*”|‘[^’]*’|「[^」]*」\s*제\s*\d+\s*조(?:\s*의\s*\d+)?|(?:법률|령|조례|규칙)\s*제\s*\d+\s*호/g;

/** 대상만 남긴다 — 괄호가 겹쳐도(`(a (b) c)`) 안쪽부터 바깥까지 지운다 */
function targetsOf(text: string): string {
  let out = text;
  for (let prev = ''; prev !== out; ) {
    prev = out;
    out = out.replace(NOT_TARGET, ' ');
  }
  return out;
}

/** 범위 문구는 문장으로 끝나지 않는다 — 대상만 남겨 `…다.` 가 있으면 조문 본문이 이어진 것이다 */
const SENTENCE_END = /다\s*\./;

/** 일부로 확인되는 것만 `partial` — 서로 다른 조를 둘 이상 가리키면 이 조의 전부인지 일부인지 몰라 `unknown` */
function scopeOf(scopeText: string): EffectiveNote['scope'] {
  const targets = targetsOf(scopeText);
  if (!PARTIAL.test(targets)) return 'unknown';
  const articles = new Set([...targets.matchAll(ARTICLE_REF)].map((m) => m[0].replace(/\s+/g, '')));
  return articles.size > 1 ? 'unknown' : 'partial';
}

/**
 * 문자열 안의 `[시행일: …]` 표기를 모두 읽는다. 잘못된 날짜는 건너뛴다.
 * @param at 이 문자열이 항·호·목 본문이면 그 자리(`제2항제1호`) — 표기 뒤에 범위 문구가 없으면 이 자리를 범위로 쓴다(그 항·호의 일부다)
 */
export function parseEffectiveMarkers(
  text: string | null | undefined,
  source: Exclude<EffectiveNoteSource, '조문시행일자'>,
  at = '',
): EffectiveNote[] {
  const body = String(text ?? '');
  const notes: EffectiveNote[] = [];
  for (const m of body.matchAll(MARKER)) {
    const date = isoDate(Number(m[1]), Number(m[2]), Number(m[3]));
    if (!date) continue;
    const start = (m.index ?? 0) + m[0].length;
    // 범위 문구는 다음 대괄호 표기 앞까지 — 참고자료는 `[본조신설 …][시행일: …] 제N조…` 처럼 대괄호 표기가 이어진다
    NEXT_BRACKET.lastIndex = start;
    const next = NEXT_BRACKET.exec(body);
    const whole = body.slice(start, next ? next.index : body.length);
    const tail = squash(whole, MAX_SCOPE_TEXT);
    // 문장 끝은 자르기 전 전체에서 본다 — 긴 본문이 300자 안에 "다." 가 없다고 범위로 쓰이지 않게
    const scopeText = SCOPE_START.test(tail) && !SENTENCE_END.test(targetsOf(whole)) ? tail : at;
    notes.push({ date, scope: scopeOf(scopeText), scopeText, source, raw: squash(m[0], MAX_RAW) });
  }
  return notes;
}

/** 같은 표기가 여러 번 나오거나 순서가 달라도 같게 — 날짜·출처·범위로 정렬하고 겹친 것을 합친다 */
export function normalizeEffectiveNotes(notes: EffectiveNote[]): EffectiveNote[] {
  const seen = new Set<string>();
  const out: EffectiveNote[] = [];
  for (const n of [...notes].sort((a, b) => a.date.localeCompare(b.date) || a.source.localeCompare(b.source) || a.scopeText.localeCompare(b.scopeText))) {
    const key = `${n.date}|${n.source}|${n.scopeText}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(n);
  }
  return out.slice(0, MAX_NOTES);
}

/**
 * 조문단위 하나의 시행일 표기 전부.
 * - 구조화된 `조문시행일자` 가 그 판 시행일과 **다르면** 그것도 한 건(범위 알 수 없음) — 지금 데이터에선 없지만 법제처가
 *   조문별로 주기 시작하면 놓치지 않는다
 * - `조문참고자료`·`조문내용`·항·호·목 본문의 `[시행일: …]` 표기(조사한 응답에서 항·호·목에는 없었지만 놓치지 않게 읽는다)
 */
export function articleEffectiveNotes(
  unit: { 조문시행일자?: unknown; 조문참고자료?: unknown; 조문내용?: unknown; 항?: unknown },
  versionEffectiveDate: string | null,
  toIso: (v: unknown) => string | null,
): EffectiveNote[] {
  const notes: EffectiveNote[] = [];
  const structured = toIso(unit.조문시행일자);
  if (structured && versionEffectiveDate && structured !== versionEffectiveDate) {
    notes.push({ date: structured, scope: 'unknown', scopeText: '', source: '조문시행일자', raw: `조문시행일자=${structured}` });
  }
  notes.push(...parseEffectiveMarkers(typeof unit.조문참고자료 === 'string' ? unit.조문참고자료 : null, '조문참고자료'));
  notes.push(...parseEffectiveMarkers(typeof unit.조문내용 === 'string' ? unit.조문내용 : null, '조문내용'));
  for (const { text, at } of nestedBodies(unit.항)) notes.push(...parseEffectiveMarkers(text, '항·호·목', at));
  return normalizeEffectiveNotes(notes);
}

const BODY_KEYS = new Set(['항내용', '호내용', '목내용']);
const CHILD_KEYS = new Set(['항', '호', '목']);

/** 동그라미 숫자 ①~⑳(U+2460~), ㉑~㉟(U+3251~), ㊱~㊿(U+32B1~) → 숫자 */
function circled(ch: string): string {
  const c = ch.codePointAt(0) ?? 0;
  if (c >= 0x2460 && c <= 0x2473) return String(c - 0x2460 + 1);
  if (c >= 0x3251 && c <= 0x325f) return String(c - 0x3251 + 21);
  if (c >= 0x32b1 && c <= 0x32bf) return String(c - 0x32b1 + 36);
  return '';
}

/**
 * 항·호·목 번호 → 자리 글자(법령 조항 행 라벨과 같은 꼴 — law-rows `ordinalLabel`). `②`→`제2항`, 호 `1.`+가지 `2`(또는 `1의2.`)→`제1호의2`,
 * `가.`→`가목`. 이 꼴이어야 범위 판정(`제N호`)도 읽는다.
 * 읽을 수 없으면 ''
 */
function placeOf(node: Record<string, unknown>): string {
  const clean = (v: unknown) => String(v ?? '').replace(/[.)\s]/g, '');
  const hang = clean(node.항번호);
  if (hang) {
    const n = /^\d+$/.test(hang) ? hang : [...hang].length === 1 ? circled(hang) : '';
    return n ? `제${n}항` : '';
  }
  const ho = clean(node.호번호);
  if (ho) {
    const m = /^(\d+)(?:의(\d+))?$/.exec(ho);
    const branch = clean(node.호가지번호) || m?.[2];
    if (!m || (branch && !/^\d+$/.test(branch))) return '';
    return branch ? `제${m[1]}호의${branch}` : `제${m[1]}호`;
  }
  const mok = clean(node.목번호);
  return /^[가나다라마바사아자차카타파하]$/.test(mok) ? `${mok}목` : '';
}

/** 항·호·목 본문 문자열과 그 자리 — 법제처는 하나면 객체, 여럿이면 배열로 주고, 본문도 줄 배열로 오기도 한다 */
function nestedBodies(value: unknown, at = '', out: { text: string; at: string }[] = []): { text: string; at: string }[] {
  if (typeof value === 'string') out.push({ text: value, at });
  else if (Array.isArray(value)) for (const v of value) nestedBodies(v, at, out);
  else if (value && typeof value === 'object') {
    const node = value as Record<string, unknown>;
    const here = at + placeOf(node);
    for (const [key, v] of Object.entries(node)) if (BODY_KEYS.has(key) || CHILD_KEYS.has(key)) nestedBodies(v, here, out);
  }
  return out;
}

/** 두 기록이 같은가 — 정규화한 뒤 모든 칸이 같으면 같다(DB 의 JSON 은 키 순서가 바뀌므로 문자열로 견주지 않는다) */
export function sameEffectiveNotes(a: EffectiveNote[] | null | undefined, b: EffectiveNote[] | null | undefined): boolean {
  const x = normalizeEffectiveNotes(a ?? []);
  const y = normalizeEffectiveNotes(b ?? []);
  return (
    x.length === y.length &&
    x.every((n, i) => n.date === y[i].date && n.scope === y[i].scope && n.scopeText === y[i].scopeText && n.source === y[i].source && n.raw === y[i].raw)
  );
}

/** 사람에게 같은 뜻인가 — 날짜와 범위 문구만 견준다(표기 띄어쓰기·출처 칸이 달라도 같은 안내다) */
export function sameEffectiveMeaning(a: EffectiveNote[], b: EffectiveNote[]): boolean {
  const key = (notes: EffectiveNote[]) => [...new Set(notes.map((n) => `${n.date}|${n.scopeText}`))].sort().join('\n');
  return key(a) === key(b);
}

/** DB 의 JSON 칸에서 읽는다 — 모양이 어긋나면 null(미수집으로 본다) */
export function readEffectiveNotes(value: unknown): EffectiveNote[] | null {
  if (!Array.isArray(value)) return null;
  return value.filter(
    (n): n is EffectiveNote =>
      !!n && typeof n === 'object' && typeof (n as EffectiveNote).date === 'string' && typeof (n as EffectiveNote).scopeText === 'string',
  );
}

/**
 * 사내 규정 트리에서 이 칸을 뗀다 — 법제처 가져오기(사내 규정 세션)는 법령 매퍼의 트리를 그대로 쓰는데, 표기는 법령 조항에만
 * 쓰는 정보다. 세션 트리에 남기면 트리 고치기(PATCH)로 검증 안 된 값이 들어갈 길도 생긴다
 */
export function withoutEffectiveNotes<T extends { effectiveNotes?: unknown; children?: T[] }>(nodes: T[]): T[] {
  return nodes.map((node) => {
    const { effectiveNotes: _drop, ...rest } = node;
    // children 이 배열이 아니면(트리 검사가 통과시킨 모양) 손대지 않는다 — 예전처럼 그대로 저장된다
    return (Array.isArray(node.children) ? { ...rest, children: withoutEffectiveNotes(node.children) } : rest) as T;
  });
}
