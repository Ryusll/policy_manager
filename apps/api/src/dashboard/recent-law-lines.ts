import { toDateOnlyString, todayDateOnly } from '../common/date-only';

/**
 * 대시보드 '최근 법령 개정' 줄 — T-213, SRS LAW-19 수정(2026-11-19).
 *
 * 줄 단위와 '우리 조문' 세는 법은 T-158 배너(`amendments/amendment-summary.ts` 의 summarize)와 같다:
 * 한 줄 = 법령 · 법령 시행일, 우리 조문 = 확정 연결로 닿는 조문 ∪ 그 줄의 후보 조문(한 번씩 센다).
 * 배너와 다른 점 — 시행 전후를 가리지 않고 최근 순(공포일이 늦은 순, 공포일이 없으면 감지한 날)으로 고르고, 법령 시행일이 없는
 * 변경도 줄로 둔다(공포일로, 공포일도 없으면 감지한 날로 가른다 — 서로 다른 개정을 한 줄로 합치지 않게). 후보 현황은 그 줄의
 * 변경으로 만든 우리 후보를 상태별로 센다(대기 = 작성·검토).
 *
 * DB 를 읽지 않는 순수 계산이다(회사 경계는 부르는 쪽 조회가 건다 — affectedEventsWhere·candidateListWhere).
 * 부르는 쪽은 ① DB 가 (법령, 법령 시행일, 공포일)로 묶은 값으로 줄을 고르고(pickLineKeys) ② 고른 줄의 변경·후보만 읽어
 * 묶고(pickRecentLines) ③ 그 변경에 대해서만 연결 도달을 계산해 조문 수를 채운다(finishRecentLines) — 변경 이력 전체를 읽지 않게.
 */

export type LawVersionLabel = { lawType: string | null; promulgationNo: string | null; revisionType: string | null };

export type LineEvent = {
  id: string;
  lawId: string;
  /** 법령 시행일(YYYY-MM-DD) */
  lawEffectiveDate: string | null;
  /** 공포일(YYYY-MM-DD) */
  promulgatedDate: string | null;
  /** 감지한 시각(ISO) */
  detectedAt: string;
  lawName: string;
  shortTitle: string | null;
  version: LawVersionLabel | null;
};

export type CandidateState = 'draft' | 'review' | 'approved' | 'rejected';
export type LineCandidate = { event: LineEvent; articleId: string; state: CandidateState };

export type RecentLawLine = {
  /** 줄 구분 — 같은 법령의 줄이 여럿일 수 있다 */
  key: string;
  lawId: string;
  /** 줄에 보일 이름 — 약칭이 있으면 약칭, 없으면 정식 제명(배너와 같다) */
  lawName: string;
  lawFullName: string;
  /** 줄의 판이 하나일 때만 — 같은 날 시행되는 판이 둘 이상이면 하나로 단정하지 않는다 */
  version: LawVersionLabel | null;
  promulgatedDate: string | null;
  effectiveDate: string | null;
  /** 줄의 변경을 마지막으로 감지한 날(한국 날짜) — 공포일이 없으면 이 날로 줄을 세운다 */
  detectedDate: string;
  /** 우리 조문 수 */
  articles: number;
  /** 후보 현황 — 대기(작성·검토)·승인·반려 */
  pending: number;
  approved: number;
  rejected: number;
};

export type PickedLine = {
  key: string;
  lawId: string;
  lawName: string;
  shortTitle: string | null;
  effectiveDate: string | null;
  promulgatedDate: string | null;
  detectedAt: string;
  versions: Map<string, LawVersionLabel>;
  /** 확정 연결이 닿는 변경 id — 도달 계산 대상 */
  eventIds: Set<string>;
  candidateArticles: Set<string>;
  pending: number;
  approved: number;
  rejected: number;
};

export const RECENT_LAW_LINES = 5;

const later = (a: string | null, b: string | null) => (a === null ? b : b === null ? a : a > b ? a : b);

/** 감지 시각(ISO) → 한국 날짜 — UTC 로 자르면 한국 시간 0~9시 감지가 전날이 된다 */
export const serviceDay = (iso: string) => toDateOnlyString(todayDateOnly(new Date(iso)));

type Dated = { lawId: string; lawEffectiveDate: string | null; promulgatedDate: string | null; detectedAt: string };

/**
 * 줄 묶음 — 법령 · 법령 시행일. 법령 시행일이 없으면 법령 · 공포일, 둘 다 없으면 법령 · 감지한 날(한국 날짜 — 한 번의 동기화가
 * 한 개정을 들여온다). 서로 다른 개정을 한 줄로 합치지 않게
 */
export function lineKey(e: Dated): string {
  if (e.lawEffectiveDate) return `${e.lawId}|${e.lawEffectiveDate}`;
  if (e.promulgatedDate) return `${e.lawId}||${e.promulgatedDate}`;
  return `${e.lawId}||@${serviceDay(e.detectedAt)}`;
}

type Sortable = { promulgatedDate: string | null; detectedAt: string; lawName: string };

/**
 * 최근 순 — 공포일이 늦은 순, 공포일이 없으면 감지한 날(법령 시행일로 세우면 공포일 없는 먼 미래 시행 개정이 늘 맨 위에 붙는다).
 * 같으면 늦게 감지한 것, 그다음 법령 이름. 날짜는 줄마다 한 번만 계산한다
 */
export function sortRecent<T extends Sortable>(items: T[]): T[] {
  return items
    .map((it) => ({ it, day: it.promulgatedDate ?? serviceDay(it.detectedAt) }))
    .sort((a, b) => b.day.localeCompare(a.day) || b.it.detectedAt.localeCompare(a.it.detectedAt) || a.it.lawName.localeCompare(b.it.lawName, 'ko'))
    .map(({ it }) => it);
}

/** DB 가 (법령, 법령 시행일, 공포일)로 묶어 준 값 — detectedAt 은 그 묶음의 가장 늦은 감지 시각(날짜가 둘 다 없는 변경은 하나씩) */
export type LineGroup = Dated;
/** 고른 줄 — 그 줄의 변경을 다시 읽을 조건(법령 시행일이 없으면 공포일, 둘 다 없으면 감지한 날까지) */
export type LineKey = { key: string; lawId: string; lawEffectiveDate: string | null; promulgatedDate: string | null; detectedDay: string | null };

/** 묶음 값만으로 줄을 고른다 — pickRecentLines 와 같은 묶음(lineKey)·같은 순서(sortRecent) */
export function pickLineKeys(groups: LineGroup[], lawName: (lawId: string) => string, limit = RECENT_LAW_LINES): LineKey[] {
  const lines = new Map<string, LineKey & Sortable>();
  for (const g of groups) {
    const key = lineKey(g);
    const line = lines.get(key);
    if (!line) {
      const detectedDay = g.lawEffectiveDate || g.promulgatedDate ? null : serviceDay(g.detectedAt);
      lines.set(key, { key, lawId: g.lawId, lawEffectiveDate: g.lawEffectiveDate, promulgatedDate: g.promulgatedDate, detectedDay, detectedAt: g.detectedAt, lawName: lawName(g.lawId) });
      continue;
    }
    line.promulgatedDate = later(line.promulgatedDate, g.promulgatedDate);
    line.detectedAt = later(line.detectedAt, g.detectedAt) as string;
  }
  return sortRecent([...lines.values()])
    .slice(0, Math.max(0, limit))
    .map(({ key, lawId, lawEffectiveDate, promulgatedDate, detectedDay }) => ({ key, lawId, lawEffectiveDate, promulgatedDate, detectedDay }));
}

/**
 * 줄을 묶고 최근 순으로 고른다.
 * - `affected`: 우리 확정 연결이 닿는 변경(시행 전후 모두)
 * - `candidates`: 우리 후보(상태 무관) — 후보를 만든 뒤 연결을 지운 변경도 줄이 된다(그 후보의 조문은 우리 조문이다)
 */
export function pickRecentLines(affected: LineEvent[], candidates: LineCandidate[], limit = RECENT_LAW_LINES): PickedLine[] {
  const lines = new Map<string, PickedLine>();
  const lineOf = (e: LineEvent) => {
    const key = lineKey(e);
    const line =
      lines.get(key) ??
      ({
        key,
        lawId: e.lawId,
        lawName: e.lawName,
        shortTitle: e.shortTitle,
        effectiveDate: e.lawEffectiveDate,
        promulgatedDate: null,
        detectedAt: e.detectedAt,
        versions: new Map(),
        eventIds: new Set<string>(),
        candidateArticles: new Set<string>(),
        pending: 0,
        approved: 0,
        rejected: 0,
      } satisfies PickedLine);
    line.promulgatedDate = later(line.promulgatedDate, e.promulgatedDate);
    line.detectedAt = later(line.detectedAt, e.detectedAt) as string;
    if (e.version) line.versions.set(`${e.version.lawType}|${e.version.promulgationNo}`, e.version);
    lines.set(key, line);
    return line;
  };
  for (const e of affected) lineOf(e).eventIds.add(e.id);
  for (const c of candidates) {
    const line = lineOf(c.event);
    line.candidateArticles.add(c.articleId);
    if (c.state === 'approved') line.approved++;
    else if (c.state === 'rejected') line.rejected++;
    else line.pending++;
  }
  return sortRecent([...lines.values()]).slice(0, Math.max(0, limit));
}

/** 고른 줄에 우리 조문 수를 채운다 — `articles` 는 변경 묶음에 확정 연결로 닿는 우리 조문 id(groupImpactArticles 의 confirmed) */
export function finishRecentLines(lines: PickedLine[], articles: (eventIds: string[]) => Set<string>): RecentLawLine[] {
  return lines.map((l) => ({
    key: l.key,
    lawId: l.lawId,
    lawName: l.shortTitle || l.lawName,
    lawFullName: l.lawName,
    version: l.versions.size === 1 ? [...l.versions.values()][0] : null,
    promulgatedDate: l.promulgatedDate,
    effectiveDate: l.effectiveDate,
    detectedDate: serviceDay(l.detectedAt),
    articles: new Set([...(l.eventIds.size ? articles([...l.eventIds]) : []), ...l.candidateArticles]).size,
    pending: l.pending,
    approved: l.approved,
    rejected: l.rejected,
  }));
}
