import { commonParticleLength, diffTokens, tokenize } from './amendment-text';

/**
 * 변경 전후 비교 정보 (T-106, 특허 도 10 단계 1050).
 *
 * 제1 조문(기준 발행본)과 후보 본문의 **실제 차이**를 규칙의 설명과 따로 계산한다. 규칙이
 * "여기를 고쳤다"고 기록한 자리와 실제로 달라진 자리를 대조해, 근거가 연결되지 않은 변경은
 * 검토 대상으로 드러낸다 — 규칙 엔진의 실수든 사람이 손댄 곳이든(T-107) 근거 없이 바뀐
 * 문구가 승인 화면에서 묻히면 안 된다.
 */

export interface Span {
  start: number;
  end: number;
  text: string;
}

export interface CandidateDiffPart {
  op: 'equal' | 'insert' | 'delete';
  text: string;
}

export interface CandidateChange {
  index: number;
  kind: 'replace' | 'insert' | 'delete';
  /** 제1 조문 쪽 구간 (insert 면 길이 0) */
  base: Span;
  /** 후보 쪽 구간 (delete 면 길이 0) */
  candidate: Span;
  /** 이 변경을 설명하는 근거(규칙 적용) 번호. 비어 있으면 근거 없는 변경 */
  rationaleRefs: number[];
}

export interface CandidateDiff {
  /** 화면 표시용 — 삭제는 취소선, 추가는 밑줄 */
  parts: CandidateDiffPart[];
  changes: CandidateChange[];
  /** 근거가 연결되지 않은 변경 수 */
  unexplained: number;
}

/** 규칙이 고쳤다고 기록한 자리 (근거 대조용) */
export interface ExplainedEdit {
  id: number;
  base: { start: number; end: number };
  candidate: { start: number; end: number };
}

/** 반열린 구간 겹침. 길이 0 구간(삽입 지점)은 경계에 닿기만 해도 겹친 것으로 본다 */
function overlaps(a: { start: number; end: number }, b: { start: number; end: number }): boolean {
  if (a.start === a.end) return b.start <= a.start && a.start <= b.end;
  if (b.start === b.end) return a.start <= b.start && b.start <= a.end;
  return a.start < b.end && b.start < a.end;
}

/**
 * 토큰 단위로 찾은 변경을 좁힌다. 양끝의 같은 공백과, 같은 조사로 끝나면 그 조사를 뗀다
 * ("근로자에게"→"노동자에게"는 "근로자"→"노동자"). 글자 단위로 더 쪼개지 않는다 —
 * "근로"→"노동"·"150"의 "5"→"6"처럼 낱말·숫자 한가운데를 표시하면 검토자가 읽을 수 없다.
 */
function narrow(base: string, cand: string, b: [number, number], c: [number, number]) {
  let [bs, be] = b;
  let [cs, ce] = c;
  if (be > bs && ce > cs) {
    while (bs < be && cs < ce && /\s/.test(base[bs]) && base[bs] === cand[cs]) {
      bs++;
      cs++;
    }
    while (be > bs && ce > cs && /\s/.test(base[be - 1]) && base[be - 1] === cand[ce - 1]) {
      be--;
      ce--;
    }
    const p = commonParticleLength(base.slice(bs, be), cand.slice(cs, ce));
    be -= p;
    ce -= p;
  }
  return { bs, be, cs, ce };
}

export function diffCandidate(base: string, candidate: string, edits: ExplainedEdit[] = []): CandidateDiff {
  const ops = diffTokens(tokenize(base), tokenize(candidate));

  const raw: Array<{ bs: number; be: number; cs: number; ce: number }> = [];
  let bPos = 0;
  let cPos = 0;
  let i = 0;
  while (i < ops.length) {
    const op = ops[i];
    if (op.op === 'equal') {
      const len = op.tokens.reduce((n, t) => n + t.text.length, 0);
      bPos += len;
      cPos += len;
      i++;
      continue;
    }
    const bs = bPos;
    const cs = cPos;
    while (i < ops.length && ops[i].op !== 'equal') {
      const len = ops[i].tokens.reduce((n, t) => n + t.text.length, 0);
      if (ops[i].op === 'delete') bPos += len;
      else cPos += len;
      i++;
    }
    const n = narrow(base, candidate, [bs, bPos], [cs, cPos]);
    if (n.be > n.bs || n.ce > n.cs) raw.push(n);
  }

  const changes: CandidateChange[] = raw.map((r, index) => {
    const kind: CandidateChange['kind'] = r.be === r.bs ? 'insert' : r.ce === r.cs ? 'delete' : 'replace';
    const b = { start: r.bs, end: r.be };
    const c = { start: r.cs, end: r.ce };
    const rationaleRefs = edits
      .filter((e) => overlaps(c, e.candidate) || overlaps(b, e.base))
      .map((e) => e.id);
    return {
      index,
      kind,
      base: { ...b, text: base.slice(r.bs, r.be) },
      candidate: { ...c, text: candidate.slice(r.cs, r.ce) },
      rationaleRefs,
    };
  });

  const parts: CandidateDiffPart[] = [];
  const push = (op: CandidateDiffPart['op'], text: string) => {
    if (!text) return;
    const last = parts[parts.length - 1];
    if (last && last.op === op) last.text += text;
    else parts.push({ op, text });
  };
  let pos = 0;
  for (const ch of changes) {
    push('equal', base.slice(pos, ch.base.start));
    push('delete', ch.base.text);
    push('insert', ch.candidate.text);
    pos = ch.base.end;
  }
  push('equal', base.slice(pos));

  return { parts, changes, unexplained: changes.filter((c) => c.rationaleRefs.length === 0).length };
}

/** 근거 재연결에 쓰는 규칙 적용 — 제1 조문 쪽 구간과 규칙이 낸 문구만 있으면 된다 */
export interface AppliedRule {
  id: number;
  base: { start: number; end: number };
  candidate: { text: string };
}

/**
 * 사람이 손질한 본문의 비교 정보를 다시 만든다 (T-107, 특허 도 11 — 수정되면 비교 정보를 다시 생성).
 *
 * 제1 조문은 바뀌지 않으므로 규칙 적용의 **제1 조문 쪽 구간은 그대로 유효**하다. 새 본문과 제1 조문의
 * 차이를 다시 계산한 뒤, 규칙마다 그 구간을 새 본문 좌표로 옮겨 **규칙이 낸 문구가 그 자리에 그대로
 * 남아 있으면** 겹치는 변경 구간에 그 규칙을 근거로 잇는다. 사람이 그 자리를 다시 고쳤으면 규칙 근거는
 * 끊기고, 근거 없는 변경(검토 대상)으로 남는다.
 */
export function relinkDiff(base: string, content: string, applied: AppliedRule[]): CandidateDiff {
  const d = diffCandidate(base, content, []);

  // 같은 부분은 두 본문에서 1:1 로 대응한다 — 그 대응으로 제1 조문 위치를 새 본문 위치로 옮긴다
  const equal: Array<{ b0: number; b1: number; c0: number }> = [];
  let b = 0;
  let c = 0;
  for (const part of d.parts) {
    if (part.op === 'equal') {
      equal.push({ b0: b, b1: b + part.text.length, c0: c });
      b += part.text.length;
      c += part.text.length;
    } else if (part.op === 'delete') b += part.text.length;
    else c += part.text.length;
  }
  const inChange = (x: number) => d.changes.find((ch) => ch.base.start <= x && x <= ch.base.end);
  const mapStart = (x: number) => {
    const seg = equal.find((s) => s.b0 <= x && x < s.b1);
    if (seg) return seg.c0 + (x - seg.b0);
    return inChange(x)?.candidate.start ?? content.length;
  };
  const mapEnd = (x: number) => {
    if (x === 0) return 0;
    const seg = equal.find((s) => s.b0 < x && x <= s.b1);
    if (seg) return seg.c0 + (x - seg.b0);
    return inChange(x)?.candidate.end ?? content.length;
  };

  for (const a of applied) {
    const cs = mapStart(a.base.start);
    const ce = mapEnd(a.base.end);
    if (content.slice(cs, ce) !== a.candidate.text) continue; // 사람이 그 자리를 다시 고쳤다
    for (const ch of d.changes) {
      if (overlaps(ch.base, a.base) || overlaps(ch.candidate, { start: cs, end: ce })) {
        if (!ch.rationaleRefs.includes(a.id)) ch.rationaleRefs.push(a.id);
      }
    }
  }
  return { ...d, unexplained: d.changes.filter((ch) => ch.rationaleRefs.length === 0).length };
}
