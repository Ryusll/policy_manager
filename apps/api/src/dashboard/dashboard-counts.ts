import { Prisma } from '@prisma/client';
import { currentVersionsSql } from '../common/as-of';
import { kstDayStart, parseDateOnly, toDateOnlyString } from '../common/date-only';
import { ourLinks } from '../law-links/our-links';
import { candidateListWhere } from '../amendments/amendment-list-where';
import { affectedEventsWhere, groupImpactArticles, reachOfEvents } from '../law-changes/law-link-reach';
import { VERSION_LABEL_SELECT, presentVersion } from '../laws/law-version-present';
import { finishRecentLines, pickLineKeys, pickRecentLines, type LineEvent, type LineGroup, type LineKey, type RecentLawLine } from './recent-law-lines';

/*
 * 대시보드 집계 조각 — T-213, SRS LAW-29·LAW-19 수정. 모두 같은 스냅숏 트랜잭션(tx) 안에서 부른다(dashboard.service).
 * 회사 경계: 규정은 tenantId, 조문 버전은 조문의 실제 소속, 연결은 ourLinks, 후보는 candidateListWhere.
 * 법령·변경은 전 고객사 공용이라 회사 조건은 연결·후보에서 건다(ADR-0020).
 */

type Tx = Prisma.TransactionClient;

/** ① 관리 규정 — 활성·비활성 규정 수와 활성 규정의 오늘 시행 중인 조 수 */
export async function policyCounts(tx: Tx, tenantId: string, today: Date) {
  const active = await tx.policy.count({ where: { tenantId, isActive: true } });
  const inactive = await tx.policy.count({ where: { tenantId, isActive: false } });
  // 조 = 같은 장에서 조 번호·가지 번호가 같은 행(머리·항·호)의 묶음. 그 가운데 하나라도 오늘 시행 중인 판이 있으면 1 —
  // 현재 판 고르기는 규정 상세·검색·규정 질문과 같은 SQL(currentVersionsSql), 폐지는 폐지일이 오늘 이하인 것(asOfState 와 같다)
  const [{ n }] = await tx.$queryRaw<{ n: number }[]>(Prisma.sql`
    SELECT COUNT(DISTINCT (a.chapter_id, a.number, COALESCE(a.branch_number, 0)))::int AS n
    FROM (${currentVersionsSql(tenantId, today, { activePoliciesOnly: true })}) cv
    JOIN articles a ON a.id = cv.article_id
    WHERE cv.repealed_on IS NULL OR cv.repealed_on > ${today}`);
  return { active, inactive, articlesInForce: n };
}

/** ② 연결 법령 — 확정 연결 수·연결 법령 수·추천 연결 수, 연결 법령의 확인 상태(LAW-17 의 법령별 '마지막 확인') */
export async function linkStatus(tx: Tx, tenantId: string) {
  const confirmed = await tx.lawLink.findMany({
    where: ourLinks(tenantId, { confirmState: 'confirmed' }),
    select: { lawArticle: { select: { lawId: true } } },
  });
  const suggested = await tx.lawLink.count({ where: ourLinks(tenantId, { confirmState: 'suggested' }) });
  const lawIds = [...new Set(confirmed.map((l) => l.lawArticle.lawId))];
  const laws = lawIds.length
    ? await tx.law.findMany({ where: { id: { in: lawIds } }, select: { lastCheckedAt: true, lastCheckError: true } })
    : [];
  // 확인 실패(마지막 확인이 실패)가 먼저 — 처음부터 실패 중인 법령을 '확인 전'에 두 번 세지 않는다
  const failedLaws = laws.filter((l) => l.lastCheckError != null).length;
  const uncheckedLaws = laws.filter((l) => l.lastCheckError == null && l.lastCheckedAt == null).length;
  const checked = laws.map((l) => l.lastCheckedAt).filter((d): d is Date => d != null);
  const oldest = checked.length ? new Date(Math.min(...checked.map((d) => d.getTime()))) : null;
  return {
    confirmedLinks: confirmed.length,
    suggestedLinks: suggested,
    linkedLaws: lawIds.length,
    oldestCheckedAt: oldest ? oldest.toISOString() : null,
    failedLaws,
    uncheckedLaws,
  };
}

/** ③ 개정 검토 대기 — 메뉴 배지·개정 검토 기본 목록과 같은 조건(candidateListWhere)으로 작성·검토 수 */
export async function candidateCounts(tx: Tx, tenantId: string) {
  const draft = await tx.amendmentCandidate.count({ where: candidateListWhere(tenantId, { state: 'draft' }) });
  const review = await tx.amendmentCandidate.count({ where: candidateListWhere(tenantId, { state: 'review' }) });
  return { draft, review };
}

const LINE_EVENT_SELECT = {
  id: true,
  lawId: true,
  lawEffectiveDate: true,
  promulgatedDate: true,
  detectedAt: true,
  law: { select: { lawName: true, shortTitle: true } },
  lawVersion: VERSION_LABEL_SELECT,
} satisfies Prisma.LawChangeEventSelect;
type LineEventRow = Prisma.LawChangeEventGetPayload<{ select: typeof LINE_EVENT_SELECT }>;

const day = (d: Date | null) => (d ? toDateOnlyString(d) : null);
const toLineEvent = (e: LineEventRow): LineEvent => ({
  id: e.id,
  lawId: e.lawId,
  lawEffectiveDate: day(e.lawEffectiveDate),
  promulgatedDate: day(e.promulgatedDate),
  detectedAt: e.detectedAt.toISOString(),
  lawName: e.law.lawName,
  shortTitle: e.law.shortTitle,
  version: presentVersion(e.lawVersion),
});

/** 고른 줄의 변경 — recent-law-lines 의 lineKey 와 같은 묶음: (법령, 시행일) / (법령, 시행일 없음, 공포일) / (법령, 날짜 없음, 감지한 날) */
const lineWhere = (k: LineKey): Prisma.LawChangeEventWhereInput => {
  if (k.lawEffectiveDate) return { lawId: k.lawId, lawEffectiveDate: parseDateOnly(k.lawEffectiveDate) };
  if (k.promulgatedDate) return { lawId: k.lawId, lawEffectiveDate: null, promulgatedDate: parseDateOnly(k.promulgatedDate) };
  const start = kstDayStart(k.detectedDay)!;
  return { lawId: k.lawId, lawEffectiveDate: null, promulgatedDate: null, detectedAt: { gte: start, lt: new Date(start.getTime() + DAY_MS) } };
};
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * 줄 고르기에 쓸 묶음 — 변경 행·관계는 받지 않고 DB 가 (법령, 법령 시행일, 공포일)로 묶은 값만. 날짜가 둘 다 없는 변경은
 * 감지한 날로 가르려고 감지 시각만 따로 받는다(드물다)
 */
async function lineGroups(tx: Tx, where: Prisma.LawChangeEventWhereInput): Promise<LineGroup[]> {
  const rows = await tx.lawChangeEvent.groupBy({ by: ['lawId', 'lawEffectiveDate', 'promulgatedDate'], where, _max: { detectedAt: true } });
  const groups: LineGroup[] = rows
    .filter((g) => g.lawEffectiveDate || g.promulgatedDate)
    .map((g) => ({ lawId: g.lawId, lawEffectiveDate: day(g.lawEffectiveDate), promulgatedDate: day(g.promulgatedDate), detectedAt: g._max.detectedAt!.toISOString() }));
  const bare = rows.filter((g) => !g.lawEffectiveDate && !g.promulgatedDate).map((g) => g.lawId);
  if (bare.length) {
    const events = await tx.lawChangeEvent.findMany({
      where: { AND: [where, { lawId: { in: bare }, lawEffectiveDate: null, promulgatedDate: null }] },
      select: { lawId: true, detectedAt: true },
    });
    groups.push(...events.map((e) => ({ lawId: e.lawId, lawEffectiveDate: null, promulgatedDate: null, detectedAt: e.detectedAt.toISOString() })));
  }
  return groups;
}

/**
 * ④ 최근 법령 개정 다섯 줄 — 우리 확정 연결이 닿는 변경과 우리 후보의 변경(recent-law-lines).
 * 변경은 지워지지 않고 쌓이므로 줄 고르기는 DB 가 묶은 값으로 하고(변경 행·관계를 받지 않는다), 고른 다섯 줄의 변경·후보만 읽는다.
 * 확정 연결로 닿는 변경(법령 id 로 거르는 인덱스를 탄다)과 우리 후보의 변경(id 로)은 따로 묶어 합친다 — 한 OR 안에 후보 하위 질의를
 * 섞으면 모든 회사가 함께 쓰는 변경 표를 통째로 훑을 수 있다
 */
export async function recentLawChanges(tx: Tx, tenantId: string): Promise<RecentLawLine[]> {
  const affected = await affectedEventsWhere(tx, tenantId);
  const ours = candidateListWhere(tenantId, { state: 'all' });
  const ourEvents = await tx.amendmentCandidate.groupBy({ by: ['changeEventId'], where: ours });
  const groups = [
    ...(await lineGroups(tx, affected)),
    ...(ourEvents.length ? await lineGroups(tx, { id: { in: ourEvents.map((c) => c.changeEventId) } }) : []),
  ];
  if (!groups.length) return [];
  const laws = await tx.law.findMany({ where: { id: { in: [...new Set(groups.map((g) => g.lawId))] } }, select: { id: true, lawName: true } });
  const nameOf = new Map(laws.map((l) => [l.id, l.lawName]));
  const keys = pickLineKeys(groups, (id) => nameOf.get(id) ?? '');
  const picked = { OR: keys.map(lineWhere) };
  const events = await tx.lawChangeEvent.findMany({
    where: { AND: [affected, picked] },
    select: { ...LINE_EVENT_SELECT, lawArticleId: true, nodeKey: true },
  });
  const candidates = await tx.amendmentCandidate.findMany({
    where: { AND: [ours, { changeEvent: picked }] },
    select: { articleId: true, reviewState: true, changeEvent: { select: LINE_EVENT_SELECT } },
  });
  const lines = pickRecentLines(
    events.map(toLineEvent),
    candidates.map((c) => ({ event: toLineEvent(c.changeEvent), articleId: c.articleId, state: c.reviewState })),
  );
  const reached = await groupImpactArticles(tx, tenantId, await reachOfEvents(tx, events));
  return finishRecentLines(lines, (ids) => reached(ids).confirmed);
}
