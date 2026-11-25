import { createHash } from 'crypto';
import { formatJo } from '../common/article-label';

/**
 * 재파싱 조문과 저장된 조문의 대응 판정 — DB 없는 계산 (T-110, 특허 청구항 2, 도 6 S610~S641).
 *
 * 계층 정보와 내용 지문 두 축으로 본다. 조문 식별자(Article.id)는 지문이 아니라 이 판정으로 유지된다.
 * - 같은 번호·같은 본문 → 같은 조문(그대로)
 * - 번호·장·절·제목이 달라도 본문이 같고 근거가 충분하면 → 옮김(추천)
 * - 같은 자리인데 본문이 다르면 → 개정인지 새 조문인지 사람이 고른다
 * - 후보가 여럿이거나 근거가 약하면 → 판정 보류(후보 중 고르기). 한 축만 맞는다는 이유로 고르지 않는다
 * - 남은 재파싱 조문 → 새 조문 후보, 남은 저장 조문 → 삭제 여부 확인 대상(이력은 지우지 않는다)
 */

/** 정규화 규칙 버전 — 바뀌면 지문끼리 비교할 수 없으므로 판정 결과에 함께 남긴다 */
export const NORMALIZE_VERSION = 'norm/1';
/** 판정 규칙 버전 */
export const REPARSE_ALGORITHM = 'reparse/1';

const ZERO_WIDTH = /[\u00AD\u200B-\u200D\u2060\uFEFF]/g;
const SPACE_LIKE = /[\u00A0\u1680\u2000-\u200A\u202F\u205F\u3000]/g;
const FULLWIDTH_ASCII = /[\uFF01-\uFF5E]/g;
/** 모양만 다른 같은 문자 — 문장 부호를 지우지 않고 한 가지로 맞춘다 */
const SAME_CHAR: [RegExp, string][] = [
  [/[\u2219\u318D\u30FB\uFF65\u2027]/g, '\u00B7'], // 가운뎃점(ㆍ∙・ → ·)
  [/[\u201C\u201D\u201E\u201F\u2033]/g, '"'], // 큰따옴표
  [/[\u2018\u2019\u201A\u201B\u2032]/g, "'"], // 작은따옴표
  [/[\u2010\u2011\u2012\u2013\u2212\uFE63]/g, '-'], // 붙임표·줄표(짧은 것)·빼기
  [/[\u301C\u223C]/g, '~'], // 물결
];

/**
 * 비교 문자열(엄격) — 줄바꿈·중복 공백·문자 표현 형식만 맞춘다. 수치·부정 표현·단위·문장 부호는 그대로 둔다.
 * NFKC 는 쓰지 않는다 — "10⁴"가 "104"가 되는 것처럼 수치의 뜻이 바뀐다. 공백은 한 칸으로 줄이되 지우지 않는다
 * ("1 2"와 "12"는 다르다). 같은 문장이 지면 폭 때문에 다른 곳에서 줄이 나뉜 경우는 `looseText` 로 후보만 찾는다.
 */
export function normalizeText(text: string): string {
  let s = (text ?? '').normalize('NFC').replace(ZERO_WIDTH, '').replace(SPACE_LIKE, ' ');
  s = s.replace(FULLWIDTH_ASCII, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));
  for (const [re, to] of SAME_CHAR) s = s.replace(re, to);
  return s.replace(/\s+/g, ' ').trim();
}

/**
 * 띄어쓰기를 뺀 비교 문자열 — PDF 줄이 단어 중간에서 나뉘어 생긴 공백("관리한 다")을 무시한다. 숫자 사이의 공백은
 * 남긴다("1 2"와 "12"는 다른 수치). 이것만 같으면 본문 변경으로 보지 않되, 이것만으로 다른 자리의 조문과 잇지는
 * 않는다(번호·상위 조 같은 다른 근거가 있어야 한다).
 */
export function looseText(normalized: string): string {
  return normalized.replace(/(?<!\d) | (?!\d)/g, '');
}

/** 내용 지문 — 정규화한 본문의 SHA-256. 빈 본문은 지문이 없다(제목으로 대신하지 않는다) */
export function contentFingerprint(normalized: string): string | null {
  return normalized ? createHash('sha256').update(normalized, 'utf8').digest('hex') : null;
}

export type RowKind = 'jo' | 'hang' | 'mok';

export interface Position {
  number: number;
  branch: number | null;
  clause: number | null;
  item: number | null;
}

export function kindOf(p: Pick<Position, 'clause' | 'item'>): RowKind {
  if (p.item != null) return 'mok';
  return p.clause != null ? 'hang' : 'jo';
}

/** "제3조의2제1항제2목" */
export function positionLabel(p: Position): string {
  return `${formatJo(p.number, p.branch)}${p.clause != null ? `제${p.clause}항` : ''}${p.item != null ? `제${p.item}목` : ''}`;
}

const posKey = (p: Position) => `${p.number}|${p.branch ?? 0}|${p.clause ?? 0}|${p.item ?? 0}`;
const joKey = (p: Position) => `${p.number}|${p.branch ?? 0}`;

export interface ParsedRow extends Position {
  /** 재파싱 행 순번(buildCommitPlan 순서) */
  index: number;
  /** 미리보기 트리 노드 — 화면에서 원문 위치를 짚을 때 */
  nodeId: string | null;
  chapterIndex: number;
  sectionIndex: number | null;
  title: string;
  content: string;
  /** 원문 번호를 그대로 쓰지 못해 다시 매긴 행 — 번호로는 대응시키지 않는다 */
  renumbered: boolean;
}

export interface ParsedChapter {
  index: number;
  number: number;
  title: string;
  hidden: boolean;
  sections: { index: number; number: number; title: string }[];
}

export interface StoredRow extends Position {
  articleId: string;
  chapterId: string;
  sectionId: string | null;
  title: string;
  /** 비교 대상 버전 — 최근 발행본, 발행 이력이 없으면 최신 작업본. 버전이 없는 조 머리 행은 null */
  base: { versionId: string; status: string; content: string } | null;
  /** 마지막 발행이 폐지다 — 자동 대응에서 빼고 수동 후보로만 보인다 */
  repealed: boolean;
  /** 비교 대상보다 뒤의 작업본(초안·검토 중) */
  pending: { versionId: string; status: string } | null;
  /** 저장 순서(장·조·가지·항·목) */
  order: number;
}

export interface StoredChapter {
  id: string;
  number: number;
  title: string;
  hidden: boolean;
  sections: { id: string; number: number; title: string }[];
}

export type MatchKind = 'same' | 'moved' | 'changed' | 'ambiguous' | 'new' | 'missing';
export type MatchReason =
  | 'position'
  | 'content'
  | 'spacing'
  | 'parent'
  | 'children'
  | 'neighbor'
  | 'empty'
  | 'renumbered'
  | 'repealed'
  | 'duplicate';

export interface MatchItem {
  kind: MatchKind;
  /** 재파싱 행 순번 */
  parsed: number | null;
  /** 대응한 저장 조문 */
  articleId: string | null;
  /** 판정 보류일 때 고를 수 있는 저장 조문 */
  candidates: string[];
  /** 판정 근거 */
  reasons: MatchReason[];
  /** 결정을 미리 골라 둘 만큼 근거가 있다(옮김·새 조문) */
  recommended: boolean;
  changes: {
    content: boolean;
    /** 띄어쓰기만 다르다 — 본문 변경으로 보지 않는다 */
    spacingOnly: boolean;
    position: boolean;
    chapter: boolean;
    section: boolean;
    title: boolean;
  } | null;
}

export interface ChapterMatch {
  parsed: number | null;
  storedId: string | null;
  change: 'same' | 'renumbered' | 'renamed' | 'renumbered_renamed' | 'new' | 'missing';
}

export interface MatchResult {
  items: MatchItem[];
  chapters: ChapterMatch[];
  /** 재파싱 장·절 → 저장된 장·절(대응 못 하면 null = 새로 만들 장·절) */
  chapterMap: Record<number, string | null>;
  sectionMap: Record<string, string | null>;
}

interface Pair {
  p: number;
  s: number;
  reasons: Set<MatchReason>;
  /** 본문(엄격) 일치·공백만 다름·빈 본문 둘 다 */
  contentEqual: boolean;
  spacingOnly: boolean;
  /** 본문 일치만으로(유일 지문) 맺었다 — 다른 근거가 있어야 추천 */
  contentOnly: boolean;
  /** 띄어쓰기를 빼야 같다 — 후보 찾기로 맺은 짝이라 추천하지 않는다(사람이 확인) */
  looseOnly: boolean;
}

/**
 * 대응 판정. 재파싱 쪽은 `buildCommitPlan` 의 행과 장·절, 저장 쪽은 대상 규정의 조문(비교 대상 버전 본문)과 장·절.
 * 순서가 결과를 바꾸므로 단계마다 남은 것만 본다 — 다만 지문의 "유일"은 남은 것이 아니라 **전체**에서 센다
 * (앞 단계에서 다른 후보가 빠져 하나가 남은 것은 유일하다는 근거가 아니다).
 */
export function matchReparse(
  parsedRows: ParsedRow[],
  parsedChapters: ParsedChapter[],
  storedRows: StoredRow[],
  storedChapters: StoredChapter[],
): MatchResult {
  const P = parsedRows.map((r) => {
    const norm = normalizeText(r.content);
    return { row: r, kind: kindOf(r), norm, loose: looseText(norm) };
  });
  const S = [...storedRows]
    .sort((a, b) => a.order - b.order)
    .map((r) => {
      const norm = normalizeText(r.base?.content ?? '');
      return { row: r, kind: kindOf(r), norm, loose: looseText(norm) };
    });

  const pairOfP = new Map<number, Pair>();
  const pairOfS = new Map<number, Pair>();
  const pair = (p: number, s: number, reasons: MatchReason[], contentOnly = false) => {
    const a = P[p];
    const b = S[s];
    const strictEq = a.norm === b.norm;
    const looseEq = a.loose === b.loose;
    const x: Pair = {
      p,
      s,
      reasons: new Set(reasons),
      contentEqual: strictEq || looseEq,
      spacingOnly: !strictEq && looseEq && !!a.norm,
      contentOnly,
      looseOnly: !strictEq && looseEq,
    };
    if (!a.norm && !b.norm) x.reasons.add('empty');
    if (x.spacingOnly) x.reasons.add('spacing');
    pairOfP.set(p, x);
    pairOfS.set(s, x);
  };
  const freeP = (p: number) => !pairOfP.has(p);
  const freeS = (s: number) => !pairOfS.has(s) && !S[s].row.repealed;

  const group = <T>(list: T[], key: (x: T, i: number) => string | null) => {
    const m = new Map<string, number[]>();
    list.forEach((x, i) => {
      const k = key(x, i);
      if (k == null) return;
      const arr = m.get(k);
      if (arr) arr.push(i);
      else m.set(k, [i]);
    });
    return m;
  };
  // 번호로 찾기 — 다시 매긴 재파싱 행은 번호를 믿을 수 없어 넣지 않는다. 폐지된 조문은 자동 대응에서 뺀다
  const pByPos = group(P, (x) => (x.row.renumbered ? null : posKey(x.row)));
  const sByPos = group(S, (x) => (x.row.repealed ? null : posKey(x.row)));
  // 지문의 유일성은 전체에서 센다(폐지된 조문도 센다 — 같은 본문이 폐지본에 있으면 확정하지 않는다)
  const pByNorm = group(P, (x) => x.norm || null);
  const sByNorm = group(S, (x) => x.norm || null);
  const pByLoose = group(P, (x) => x.loose || null);
  const sByLoose = group(S, (x) => x.loose || null);

  // 조 머리 행(조·가지) — 항·목의 부모
  const pJo = group(P, (x) => (x.kind === 'jo' ? joKey(x.row) : null));
  const sJo = group(S, (x) => (x.kind === 'jo' ? joKey(x.row) : null));
  const parentOfP = (p: number): number | null => {
    if (P[p].kind === 'jo') return null;
    const arr = pJo.get(joKey(P[p].row));
    return arr && arr.length === 1 ? arr[0] : null;
  };
  const parentOfS = (s: number): number | null => {
    if (S[s].kind === 'jo') return null;
    const arr = sJo.get(joKey(S[s].row));
    return arr && arr.length === 1 ? arr[0] : null;
  };
  const childrenOfP = new Map<number, number[]>();
  P.forEach((_, i) => {
    const parent = parentOfP(i);
    if (parent != null) childrenOfP.set(parent, [...(childrenOfP.get(parent) ?? []), i]);
  });
  const childrenOfS = new Map<number, number[]>();
  S.forEach((_, i) => {
    const parent = parentOfS(i);
    if (parent != null) childrenOfS.set(parent, [...(childrenOfS.get(parent) ?? []), i]);
  });

  // 1) 같은 번호, 같은 본문(띄어쓰기만 다름 포함) — 번호가 양쪽에서 하나뿐일 때만. 빈 머리 행은 하위 조문으로 본다(3)
  for (const [key, ps] of pByPos) {
    const ss = sByPos.get(key);
    if (ps.length !== 1 || !ss || ss.length !== 1) continue;
    const a = P[ps[0]];
    const b = S[ss[0]];
    if (a.kind !== b.kind || !a.norm) continue;
    if (a.norm === b.norm || a.loose === b.loose) pair(ps[0], ss[0], ['position', 'content']);
  }

  // 2) 본문이 전체에서 양쪽 모두 하나뿐 — 번호가 달라도 같은 조문(옮김). 근거는 뒤에서 다시 본다
  for (const [norm, ps] of pByNorm) {
    const ss = sByNorm.get(norm);
    if (ps.length !== 1 || !ss || ss.length !== 1) continue;
    const [p] = ps;
    const [s] = ss;
    if (!freeP(p) || !freeS(s) || P[p].kind !== S[s].kind) continue;
    pair(p, s, ['content'], true);
  }

  // 3) 본문 없는 조 머리 행 — 먼저 모든 머리 행을 하위 항·목이 따라간 조로 잇고(한 조로만 대응될 때), 그다음에야
  //    남은 머리 행을 같은 번호의 빈 머리 행과 잇는다. 순서를 섞으면 앞에 끼어든 새 조의 머리 행이 번호만 보고
  //    옛 조를 먼저 차지해, 실제로 옮겨 간 조가 새 조문으로 보인다
  const emptyHeads = P.map((x, i) => i).filter((p) => P[p].kind === 'jo' && !P[p].norm);
  for (const p of emptyHeads) {
    if (!freeP(p)) continue;
    const targets = new Set<number>();
    for (const c of childrenOfP.get(p) ?? []) {
      const x = pairOfP.get(c);
      if (!x || !x.contentEqual) continue;
      const parent = parentOfS(x.s);
      if (parent != null) targets.add(parent);
    }
    if (targets.size !== 1) continue;
    const [s] = [...targets];
    if (freeS(s) && !S[s].norm) pair(p, s, ['children']);
  }
  for (const p of emptyHeads) {
    if (!freeP(p) || P[p].row.renumbered) continue;
    const ss = sByPos.get(posKey(P[p].row));
    if (ss && ss.length === 1 && freeS(ss[0]) && !S[ss[0]].norm && (pByPos.get(posKey(P[p].row))?.length ?? 0) === 1) {
      pair(p, ss[0], ['position', 'empty']);
    }
  }

  // 4) 같은 본문이 여럿인 항·목 — 부모 조가 대응된 쪽의 같은 본문이 하나면 그것
  for (let p = 0; p < P.length; p += 1) {
    if (!freeP(p) || P[p].kind === 'jo' || !P[p].norm) continue;
    const parent = parentOfP(p);
    const parentPair = parent != null ? pairOfP.get(parent) : undefined;
    if (!parentPair) continue;
    const under = (childrenOfS.get(parentPair.s) ?? []).filter(
      (s) => freeS(s) && S[s].kind === P[p].kind && (S[s].norm === P[p].norm || S[s].loose === P[p].loose),
    );
    if (under.length === 1) pair(p, under[0], ['parent', 'content']);
  }

  // 4-2) 띄어쓰기를 빼면 전체에서 양쪽 모두 하나뿐인 본문 — 짝으로 보이되 추천하지 않는다(같은 자리의 다른 조문과
  //      본문이 다르다고 묶기 전에 잡는다 — PDF 줄바꿈 위치만 달라진 조문이 옮겨진 경우)
  for (const [loose, ps] of pByLoose) {
    const ss = sByLoose.get(loose);
    if (ps.length !== 1 || !ss || ss.length !== 1) continue;
    const [p] = ps;
    const [s] = ss;
    if (!freeP(p) || !freeS(s) || P[p].kind !== S[s].kind) continue;
    pair(p, s, ['content'], true);
  }

  // 5) 같은 자리, 다른 본문 — 먼저 모든 행을 대응된 부모 조 안의 같은 항·목 번호로, 그다음에야 같은 번호(양쪽에서
  //    하나뿐)로. 순서를 섞으면 앞에 끼어든 새 조의 항이 번호만 보고 옮겨 간 조의 항을 먼저 차지한다
  for (let p = 0; p < P.length; p += 1) {
    if (!freeP(p) || P[p].row.renumbered) continue;
    const a = P[p];
    const parent = parentOfP(p);
    const parentPair = parent != null ? pairOfP.get(parent) : undefined;
    if (!parentPair) continue;
    const under = (childrenOfS.get(parentPair.s) ?? []).filter(
      (s) => freeS(s) && S[s].kind === a.kind && S[s].row.clause === a.row.clause && S[s].row.item === a.row.item,
    );
    if (under.length === 1) pair(p, under[0], ['parent', 'position']);
  }
  for (let p = 0; p < P.length; p += 1) {
    if (!freeP(p) || P[p].row.renumbered) continue;
    const a = P[p];
    const key = posKey(a.row);
    const ss = sByPos.get(key);
    if ((pByPos.get(key)?.length ?? 0) === 1 && ss && ss.length === 1 && freeS(ss[0]) && S[ss[0]].kind === a.kind) {
      pair(p, ss[0], ['position']);
    }
  }

  // 옮김의 근거 — 본문만으로 맺은 짝은 부모·하위·이웃 중 하나가 같은 쪽으로 대응돼야 추천한다
  const pOrderJo = P.map((x, i) => i).filter((i) => P[i].kind === 'jo');
  const sOrderJo = S.map((x, i) => i).filter((i) => S[i].kind === 'jo');
  const pJoIndex = new Map(pOrderJo.map((p, i) => [p, i]));
  const sJoIndex = new Map(sOrderJo.map((s, i) => [s, i]));
  const neighborSupport = (x: Pair): boolean => {
    if (P[x.p].kind !== 'jo') return false;
    const pi = pJoIndex.get(x.p)!;
    const si = sJoIndex.get(x.s)!;
    for (const d of [-1, 1]) {
      const pn = pOrderJo[pi + d];
      const sn = sOrderJo[si + d];
      if (pn == null || sn == null) continue;
      const np = pairOfP.get(pn);
      if (np && np.s === sn) return true;
    }
    return false;
  };
  const support = (x: Pair): MatchReason | null => {
    const pp = parentOfP(x.p);
    const sp = parentOfS(x.s);
    if (pp != null && sp != null && pairOfP.get(pp)?.s === sp) return 'parent';
    if (P[x.p].kind === 'jo') {
      for (const c of childrenOfP.get(x.p) ?? []) {
        const cp = pairOfP.get(c);
        if (cp && cp.contentEqual && parentOfS(cp.s) === x.s) return 'children';
      }
    }
    return neighborSupport(x) ? 'neighbor' : null;
  };

  // 장·절 대응 — 대응된 조문이 가장 많이 온 저장 장·절(같으면 번호가 같은 쪽)
  const chapterMap: Record<number, string | null> = {};
  const sectionMap: Record<string, string | null> = {};
  const votes = new Map<number, Map<string, number>>();
  const sectionVotes = new Map<string, Map<string, number>>();
  for (const x of pairOfP.values()) {
    const a = P[x.p].row;
    const b = S[x.s].row;
    const v = votes.get(a.chapterIndex) ?? new Map<string, number>();
    v.set(b.chapterId, (v.get(b.chapterId) ?? 0) + 1);
    votes.set(a.chapterIndex, v);
    if (a.sectionIndex != null && b.sectionId) {
      const k = `${a.chapterIndex}:${a.sectionIndex}`;
      const sv = sectionVotes.get(k) ?? new Map<string, number>();
      sv.set(b.sectionId, (sv.get(b.sectionId) ?? 0) + 1);
      sectionVotes.set(k, sv);
    }
  }
  const usedChapters = new Set<string>();
  const chapterById = new Map(storedChapters.map((c) => [c.id, c]));
  for (const ch of [...parsedChapters].sort((a, b) => a.index - b.index)) {
    const v = votes.get(ch.index);
    const ranked = v
      ? [...v.entries()]
          .filter(([id]) => !usedChapters.has(id))
          .sort((a, b) => b[1] - a[1] || Number(chapterById.get(b[0])?.number === ch.number) - Number(chapterById.get(a[0])?.number === ch.number))
      : [];
    let id: string | null = ranked[0]?.[0] ?? null;
    if (!id) {
      // 대응된 조문이 없는 장 — 같은 번호·같은 제목(숨김 장끼리 포함)이면 그 장
      const same = storedChapters.find(
        (c) => !usedChapters.has(c.id) && c.number === ch.number && (c.title === ch.title || (c.hidden && ch.hidden)),
      );
      id = same?.id ?? null;
    }
    chapterMap[ch.index] = id;
    if (id) usedChapters.add(id);
    const stored = id ? chapterById.get(id) : undefined;
    const usedSections = new Set<string>();
    for (const sec of ch.sections) {
      const k = `${ch.index}:${sec.index}`;
      const sv = sectionVotes.get(k);
      let sid: string | null = null;
      if (sv && stored) {
        const ranked2 = [...sv.entries()]
          .filter(([sId]) => !usedSections.has(sId) && stored.sections.some((s) => s.id === sId))
          .sort((a, b) => b[1] - a[1]);
        sid = ranked2[0]?.[0] ?? null;
      }
      if (!sid && stored) {
        sid = stored.sections.find((s) => !usedSections.has(s.id) && s.number === sec.number && s.title === sec.title)?.id ?? null;
      }
      sectionMap[k] = sid;
      if (sid) usedSections.add(sid);
    }
  }
  const chapters: ChapterMatch[] = parsedChapters.map((ch) => {
    const id = chapterMap[ch.index];
    const stored = id ? chapterById.get(id) : undefined;
    if (!stored) return { parsed: ch.index, storedId: null, change: 'new' };
    const renumbered = stored.number !== ch.number;
    const renamed = stored.title !== ch.title && !(stored.hidden && ch.hidden);
    return {
      parsed: ch.index,
      storedId: stored.id,
      change: renumbered && renamed ? 'renumbered_renamed' : renumbered ? 'renumbered' : renamed ? 'renamed' : 'same',
    };
  });
  for (const c of storedChapters) {
    if (!usedChapters.has(c.id)) chapters.push({ parsed: null, storedId: c.id, change: 'missing' });
  }

  // 결과 — 재파싱 순서대로, 원문에 없는 저장 조문은 저장 순서대로 뒤에
  const items: MatchItem[] = [];
  for (let p = 0; p < P.length; p += 1) {
    const x = pairOfP.get(p);
    const a = P[p].row;
    if (x) {
      const b = S[x.s].row;
      const chapterChanged = chapterMap[a.chapterIndex] !== b.chapterId;
      const sectionTarget = a.sectionIndex == null ? null : sectionMap[`${a.chapterIndex}:${a.sectionIndex}`] ?? null;
      const sectionChanged = a.sectionIndex == null ? b.sectionId != null : sectionTarget !== b.sectionId;
      const positionChanged = posKey(a) !== posKey(b);
      const titleChanged = normalizeText(a.title) !== normalizeText(b.title);
      const reasons = x.reasons;
      let recommended = !x.looseOnly;
      if (x.contentOnly) {
        const why = support(x);
        if (why) reasons.add(why);
        recommended = recommended && why != null;
      }
      const structural = chapterChanged || sectionChanged || positionChanged || titleChanged;
      items.push({
        kind: !x.contentEqual ? 'changed' : structural ? 'moved' : 'same',
        parsed: p,
        articleId: b.articleId,
        candidates: [],
        reasons: [...reasons],
        recommended: x.contentEqual ? recommended : false,
        changes: {
          content: !x.contentEqual,
          spacingOnly: x.spacingOnly,
          position: positionChanged,
          chapter: chapterChanged,
          section: sectionChanged,
          title: titleChanged,
        },
      });
      continue;
    }
    // 6) 판정 보류 — 같은 본문(엄격·공백 무시)의 후보가 남아 있다(폐지된 조문 포함, 고르는 건 사람)
    const cands = new Set<number>();
    if (P[p].norm) {
      for (const s of sByNorm.get(P[p].norm) ?? []) if (!pairOfS.has(s)) cands.add(s);
      for (const s of sByLoose.get(P[p].loose) ?? []) if (!pairOfS.has(s)) cands.add(s);
    }
    const candList = [...cands].filter((s) => S[s].kind === P[p].kind);
    if (candList.length) {
      const reasons: MatchReason[] = ['content'];
      if ((pByNorm.get(P[p].norm)?.length ?? 0) > 1 || candList.length > 1) reasons.push('duplicate');
      if (candList.some((s) => S[s].row.repealed)) reasons.push('repealed');
      if ((pByLoose.get(P[p].loose)?.length ?? 0) > 1) reasons.push('duplicate');
      if (a.renumbered) reasons.push('renumbered');
      items.push({
        kind: 'ambiguous',
        parsed: p,
        articleId: null,
        candidates: candList.map((s) => S[s].row.articleId),
        reasons: [...new Set(reasons)],
        recommended: false,
        changes: null,
      });
      continue;
    }
    // 7) 새 조문 후보
    items.push({
      kind: 'new',
      parsed: p,
      articleId: null,
      candidates: [],
      reasons: a.renumbered ? ['renumbered'] : [],
      recommended: true,
      changes: null,
    });
  }
  for (let s = 0; s < S.length; s += 1) {
    if (pairOfS.has(s) || S[s].row.repealed) continue;
    items.push({
      kind: 'missing',
      parsed: null,
      articleId: S[s].row.articleId,
      candidates: [],
      reasons: [],
      recommended: false,
      changes: null,
    });
  }
  return { items, chapters, chapterMap, sectionMap };
}
