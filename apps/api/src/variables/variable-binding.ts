import { diffChars } from 'diff';

/**
 * 변수 값·연결(바인딩) 도우미 — DB 없는 계산만 (T-109, 특허 도 9).
 *
 * 위치는 저장된 본문 문자열의 UTF-16 [start, end) 다(자바스크립트 `slice` 와 같은 좌표).
 */

/** 연결에 함께 적어 두는 앞뒤 문맥 길이 — 화면에 보이고, 위치를 옮기지 못한 연결을 사람이 다시 이을 때 쓴다 */
export const CONTEXT_CHARS = 20;

/** 본문의 변수 표식 `{{KEY}}` — 등록된 변수의 키일 때만 표식으로 본다 */
const MARKER_RE = /\{\{([A-Za-z0-9_]+)\}\}/g;

export type ValueRow = {
  id: string;
  value: string;
  validFrom: Date | null;
  validTo: Date | null;
  periodConfirmed: boolean;
};

export type ValuePick =
  | { ok: true; value: ValueRow }
  | { ok: false; reason: 'none' | 'ambiguous' | 'unconfirmed' };

/** [시작, 종료) 안에 그 날이 드는가 — 시작 없음은 처음부터, 종료 없음은 끝 없음 */
export function coversDate(v: Pick<ValueRow, 'validFrom' | 'validTo'>, date: Date): boolean {
  const t = date.getTime();
  return (!v.validFrom || v.validFrom.getTime() <= t) && (!v.validTo || t < v.validTo.getTime());
}

/**
 * 그 날 쓸 값 — 기간을 확인한 값 중 그 날을 덮는 것이 **정확히 하나**일 때만 고른다(코덱스 자문 결정 4).
 * 둘 이상이면 기간이 겹친 것이라 고르지 않는다("늦게 시작한 값이 이긴다" 같은 규칙으로 조용히 정하지 않는다).
 * 덮는 값이 기간 미확정(옛 기본값을 옮긴 것)뿐이면 `unconfirmed`.
 */
export function selectValue(values: ValueRow[], date: Date): ValuePick {
  const hits = values.filter((v) => v.periodConfirmed && coversDate(v, date));
  if (hits.length === 1) return { ok: true, value: hits[0] };
  if (hits.length > 1) return { ok: false, reason: 'ambiguous' };
  if (values.some((v) => !v.periodConfirmed && coversDate(v, date))) return { ok: false, reason: 'unconfirmed' };
  return { ok: false, reason: 'none' };
}

/** 기간이 겹치는 값들(기간을 확인한 값끼리) — 화면이 "검토 필요"로 보인다 */
export function overlappingValueIds(values: ValueRow[]): Set<string> {
  const out = new Set<string>();
  const confirmed = values.filter((v) => v.periodConfirmed);
  const lo = (v: ValueRow) => (v.validFrom ? v.validFrom.getTime() : -Infinity);
  const hi = (v: ValueRow) => (v.validTo ? v.validTo.getTime() : Infinity);
  for (let i = 0; i < confirmed.length; i++) {
    for (let j = i + 1; j < confirmed.length; j++) {
      const a = confirmed[i];
      const b = confirmed[j];
      if (lo(a) < hi(b) && lo(b) < hi(a)) {
        out.add(a.id);
        out.add(b.id);
      }
    }
  }
  return out;
}

export type Marker = { key: string; start: number; end: number };

/** 본문의 표식 중 등록된 변수 키인 것만, 앞에서부터 */
export function findMarkers(content: string, keys: Set<string>): Marker[] {
  const out: Marker[] = [];
  for (const m of content.matchAll(MARKER_RE)) {
    if (keys.has(m[1])) out.push({ key: m[1], start: m.index!, end: m.index! + m[0].length });
  }
  return out;
}

/** 본문에 나오는 표식 키(등록 여부와 무관) */
export function markerKeys(content: string): Set<string> {
  return new Set([...content.matchAll(MARKER_RE)].map((m) => m[1]));
}

/**
 * 여러 구간을 한 번에 바꾼다 — **뒤에서 앞으로**(시작 위치 내림차순) 바꿔야 앞쪽 위치가 밀리지 않는다.
 * 돌려주는 `spans` 는 바꾼 뒤 본문 기준 위치(입력 순서대로). 구간이 겹치면 예외.
 */
export function replaceSpans(
  content: string,
  reps: Array<{ start: number; end: number; text: string }>,
): { content: string; spans: Array<{ start: number; end: number }> } {
  const order = reps.map((r, i) => ({ ...r, i })).sort((a, b) => a.start - b.start);
  for (let k = 1; k < order.length; k++) {
    if (order[k].start < order[k - 1].end) throw new Error('replaceSpans: 겹치는 구간');
  }
  let out = content;
  for (const r of [...order].reverse()) out = out.slice(0, r.start) + r.text + out.slice(r.end);
  // 바꾼 뒤 위치 — 앞쪽 구간들이 늘이거나 줄인 길이만큼 밀린다
  const spans: Array<{ start: number; end: number }> = new Array(reps.length);
  let delta = 0;
  for (const r of order) {
    const start = r.start + delta;
    spans[r.i] = { start, end: start + r.text.length };
    delta += r.text.length - (r.end - r.start);
  }
  return { content: out, spans };
}

/** 앞뒤 문맥 */
export function contextOf(content: string, start: number, end: number) {
  return {
    contextBefore: content.slice(Math.max(0, start - CONTEXT_CHARS), start),
    contextAfter: content.slice(end, end + CONTEXT_CHARS),
  };
}

/** 같은 문구 중 몇 번째 출현인지(0부터, 겹치지 않게 앞에서부터 센다) */
export function occurrenceOf(content: string, text: string, start: number): number {
  let n = 0;
  for (let i = content.indexOf(text); i !== -1 && i < start; i = content.indexOf(text, i + text.length)) n++;
  return n;
}

export type AnchoredSpan = { start: number; end: number; text: string };
export type Reanchor = { ok: true; start: number; end: number } | { ok: false; reason: 'span_changed' };

/**
 * 옛 본문의 구간을 새 본문의 같은 자리로 옮긴다(코덱스 자문 결정 6·8).
 *
 * 글자 단위 차이로 옮긴다 — 구간 안이 지워지거나 구간 안에 무엇이 끼어들지 않았고, 옮긴 자리의 문구가 그대로일 때만
 * 확정한다. 차이 비교는 한 자리만 내놓으므로 같은 문구가 여럿이어도 엉뚱한 자리로 가지 않는다. 그 밖에는 확정하지 않는다
 * (`span_changed`) — 같은 문구가 있다는 이유만으로, 순번이 같다는 이유만으로 옮기지 않는다. 앞뒤 문맥은 화면에 보이고
 * 사람이 다시 이을 때 쓴다.
 */
export function reanchor(oldContent: string, newContent: string, span: AnchoredSpan): Reanchor {
  if (oldContent === newContent) {
    return newContent.slice(span.start, span.end) === span.text
      ? { ok: true, start: span.start, end: span.end }
      : { ok: false, reason: 'span_changed' };
  }
  const { start: s, end: e } = span;
  let o = 0;
  let n = 0;
  let ns: number | null = null;
  let ne: number | null = null;
  for (const p of diffChars(oldContent, newContent)) {
    const len = p.value.length;
    if (p.added) {
      n += len;
      continue;
    }
    if (p.removed) {
      o += len;
      continue;
    }
    // 바뀌지 않은 부분에 든 시작·끝만 옮긴다 — 구간 안이 지워지거나 무엇이 끼어들면 옮긴 자리의 문구가 달라진다
    if (ns === null && s >= o && s < o + len) ns = n + (s - o);
    if (ne === null && e > o && e <= o + len) ne = n + (e - o);
    o += len;
    n += len;
  }
  if (ns !== null && ne !== null && newContent.slice(ns, ne) === span.text) return { ok: true, start: ns, end: ne };
  return { ok: false, reason: 'span_changed' };
}

/**
 * 값을 바꿔 넣은 구간을 새 본문으로 옮긴다(T-109 ②) — 구간 문구 자체는 바뀌었으니 그 안은 대응시키지 않고, 구간
 * **바로 앞 글자와 바로 뒤 글자**가 바뀌지 않은 채 새 본문에 있으면 그 사이를 새 자리로 본다. 그 사이 문구가
 * 넣은 값과 같을 때만 확정한다(바로 옆이 함께 고쳐졌으면 확정하지 않는다).
 */
export function reanchorReplaced(oldContent: string, newContent: string, span: { start: number; end: number }, newText: string): Reanchor {
  const map = new Map<number, number>();
  let o = 0;
  let n = 0;
  for (const p of diffChars(oldContent, newContent)) {
    const len = p.value.length;
    if (p.added) {
      n += len;
      continue;
    }
    if (p.removed) {
      o += len;
      continue;
    }
    for (const x of [span.start - 1, span.end]) if (x >= o && x < o + len) map.set(x, n + (x - o));
    o += len;
    n += len;
  }
  const start = span.start === 0 ? 0 : map.has(span.start - 1) ? map.get(span.start - 1)! + 1 : null;
  const end = span.end === oldContent.length ? newContent.length : map.get(span.end) ?? null;
  if (start !== null && end !== null && newContent.slice(start, end) === newText) return { ok: true, start, end };
  return { ok: false, reason: 'span_changed' };
}
