import type { Prisma } from '@prisma/client';
import type { PrismaService } from '../common/prisma/prisma.service';
import { toDateOnlyString, todayDateOnly } from '../common/date-only';
import { SNAPSHOT_MAX_WAIT_MS, SNAPSHOT_TIMEOUT_MS } from '../common/read-snapshot';
import { affectedEventsWhere, groupImpactArticles, reachOfEvents } from '../law-changes/law-link-reach';
import { VERSION_LABEL_SELECT, presentVersion } from '../laws/law-version-present';
import { candidateListWhere } from './amendment-list-where';

/**
 * 대시보드 법령 개정 배너(T-158, SRS LAW-19, ADR-0021 결과) — 사실만 센다. 읽기만 한다. 메뉴 배지는 이 요약이 아니라 목록의 건수를 쓴다.
 *
 * - 처리 대기 = 개정 검토 화면 기본 목록(작성·검토)의 건수 — AI 의견·신뢰도와 상관없이 전부(candidateListWhere).
 * - 시행 예정 개정 줄 = 법령 시행일이 오늘 뒤인 변경을 법령·시행일로 묶은 줄(판의 시행일이 곧 변경의 시행일 — 판 기록이 있든 없든
 *   한 줄). 우리 조문 N개(확정 연결이 닿는 조문 — 위 조항 연결 포함 T-148 규칙 — 과 그 줄의 처리 대기 후보 조문을 합쳐 한 번씩),
 *   처리 대기 후보 K건. 시행일 빠른 순 세 줄까지.
 * - 시행일 지난 미처리 = 법령 시행일이 오늘이거나 지났는데 처리하지 않은 후보 — 법은 이미 시행 중이다. 시행일이 없는 후보는 총수에만.
 */

const EVENT_SELECT = {
  id: true,
  lawId: true,
  lawVersionId: true,
  lawEffectiveDate: true,
  law: { select: { lawName: true, shortTitle: true } },
  lawVersion: VERSION_LABEL_SELECT,
} satisfies Prisma.LawChangeEventSelect;
type EventRow = Prisma.LawChangeEventGetPayload<{ select: typeof EVENT_SELECT }>;

export type SummaryEvent = {
  id: string;
  lawId: string;
  lawVersionId: string | null;
  /** 법령 시행일(YYYY-MM-DD) */
  lawEffectiveDate: string | null;
  lawName: string;
  shortTitle: string | null;
  version: { lawType: string | null; promulgationNo: string | null; revisionType: string | null } | null;
};

/** 처리 대기 후보 하나 — 그 후보의 조문과 변경 */
export type SummaryCandidate = SummaryEvent & { articleId: string };

export type SummaryLine = {
  lawId: string;
  /** 줄에 보일 이름 — 약칭이 있으면 약칭(T-152), 없으면 정식 제명 */
  lawName: string;
  lawFullName: string;
  version: SummaryEvent['version'];
  effectiveDate: string;
  /** 우리 조문 수 — 확정 연결이 닿는 조문과 처리 대기 후보 조문의 합집합 */
  articles: number;
  /** 처리 대기 후보 수 */
  pending: number;
};

export type AmendmentSummary = {
  /** 처리 대기 후보 모두 — 개정 검토 기본 목록의 건수와 같은 조건 */
  pending: number;
  /** 법령 시행일이 오늘이거나 지났는데 처리하지 않은 후보 */
  overdue: number;
  /** 법령 시행일이 없는 처리 대기 후보 */
  undated: number;
  upcoming: SummaryLine[];
  /** 보인 줄 밖에 남은 시행 예정 개정 수 */
  more: number;
};

export const SUMMARY_LINES = 3;

/** 순수 계산 — 처리 대기 후보마다의 변경과, 우리 확정 연결이 닿는 시행 예정 변경으로 배너 숫자를 만든다 */
export function summarize(input: {
  today: string;
  pending: SummaryCandidate[];
  upcoming: SummaryEvent[];
  /** 변경 묶음에 확정 연결로 닿는 우리 조문 id(합쳐 한 번씩 — groupImpactArticles) */
  articles: (eventIds: string[]) => Set<string>;
}): AmendmentSummary {
  const { today } = input;
  type Line = { event: SummaryEvent; versions: Map<string, SummaryEvent['version']>; eventIds: Set<string>; candidates: Set<string>; pending: number };
  const lines = new Map<string, Line>();
  const lineOf = (e: SummaryEvent) => {
    const key = `${e.lawId}|${e.lawEffectiveDate}`;
    const line = lines.get(key) ?? { event: e, versions: new Map(), eventIds: new Set<string>(), candidates: new Set<string>(), pending: 0 };
    if (e.version) line.versions.set(`${e.version.lawType}|${e.version.promulgationNo}`, e.version); // 판 기록이 있는 변경의 표기
    lines.set(key, line);
    return line;
  };
  for (const e of input.upcoming) if (e.lawEffectiveDate && e.lawEffectiveDate > today) lineOf(e).eventIds.add(e.id);
  let overdue = 0;
  let undated = 0;
  for (const c of input.pending) {
    if (!c.lawEffectiveDate) undated++;
    else if (c.lawEffectiveDate <= today) overdue++;
    else {
      const line = lineOf(c);
      line.pending++;
      line.candidates.add(c.articleId);
    }
  }
  const all = [...lines.values()]
    .map(({ event: e, versions, eventIds, candidates, pending }) => ({
      lawId: e.lawId,
      lawName: e.shortTitle || e.lawName,
      lawFullName: e.lawName,
      // 같은 날 시행되는 판이 둘 이상이면 하나로 단정하지 않는다
      version: versions.size === 1 ? [...versions.values()][0] : null,
      effectiveDate: e.lawEffectiveDate as string,
      // 후보가 생긴 뒤 연결을 지웠거나 조항 행이 없는 변경이어도 그 후보의 조문은 우리 조문이다 — "0개, 후보 2건"이 되지 않게
      articles: new Set([...(eventIds.size ? input.articles([...eventIds]) : []), ...candidates]).size,
      pending,
    }))
    .filter((l) => l.articles > 0 || l.pending > 0)
    .sort((a, b) => a.effectiveDate.localeCompare(b.effectiveDate) || a.lawFullName.localeCompare(b.lawFullName, 'ko'));
  return { pending: input.pending.length, overdue, undated, upcoming: all.slice(0, SUMMARY_LINES), more: Math.max(0, all.length - SUMMARY_LINES) };
}

const day = (d: Date | null) => (d ? toDateOnlyString(d) : null);
const toEvent = (e: EventRow): SummaryEvent => ({
  id: e.id,
  lawId: e.lawId,
  lawVersionId: e.lawVersionId,
  lawEffectiveDate: day(e.lawEffectiveDate),
  lawName: e.law.lawName,
  shortTitle: e.law.shortTitle,
  version: presentVersion(e.lawVersion),
});

/**
 * 회사 하나의 배너 숫자 — 처리 대기 후보(회사 경계는 목록과 같은 조건), 우리 확정 연결이 닿는 시행 예정 변경(T-148 affectedEventsWhere).
 * 한 스냅숏으로 읽는다 — 그 사이 동기화·연결 확정이 끼면 후보는 있는데 변경이 없는 줄이 생길 수 있다(law-in-force.query 와 같은 이유)
 */
export async function amendmentSummary(prisma: PrismaService, tenantId: string, today = todayDateOnly()): Promise<AmendmentSummary> {
  return prisma.$transaction(
    async (tx) => {
      const pending = await tx.amendmentCandidate.findMany({
        where: candidateListWhere(tenantId, {}),
        select: { articleId: true, changeEvent: { select: EVENT_SELECT } },
      });
      const affected = await affectedEventsWhere(tx, tenantId);
      const upcoming = await tx.lawChangeEvent.findMany({
        where: { AND: [affected, { lawEffectiveDate: { gt: today } }] },
        select: { ...EVENT_SELECT, lawArticleId: true, nodeKey: true },
      });
      const reached = await groupImpactArticles(tx, tenantId, await reachOfEvents(tx, upcoming));
      return summarize({
        today: toDateOnlyString(today),
        pending: pending.map((c) => ({ ...toEvent(c.changeEvent), articleId: c.articleId })),
        upcoming: upcoming.map(toEvent),
        articles: (ids) => reached(ids).confirmed,
      });
    },
    { isolationLevel: 'RepeatableRead', maxWait: SNAPSHOT_MAX_WAIT_MS, timeout: SNAPSHOT_TIMEOUT_MS }, // 규정 본문 스냅숏 읽기와 같은 대기·제한
  );
}
