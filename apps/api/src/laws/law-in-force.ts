/**
 * 법령의 현행 본문과 시행 예정 개정을 가른다 (T-150 ②, SRS LAW-15) — DB 없이 검사할 수 있는 순수 함수.
 *
 * T-151 부터 동기화는 공포된 판을 시행 전이라도 공포 순으로 반영한다. 그래서 법령조항의 본문(`LawArticle.content`)은
 * "마지막으로 반영한 판"의 문구이고, 시행 전 문구가 오늘 시행 중인 것처럼 보였다(D-18 ①). 시행일에 삭제될 조항은
 * 받자마자 삭제 표시(`deletedAt`)가 붙어 목록에서 사라졌다. 현행 본문은 **시행일이 오늘 뒤인 변경 이벤트**에서 되살린다 —
 * 조항마다 가장 먼저 시행될 예정 변경의 "바뀌기 전" 문구가 지금 시행 중인 문구다(뒤 판의 '전'은 앞 판의 '후'라 사슬이다).
 *
 * - 현행·예정은 판의 시행일(본문 기본정보 시행일 = 이벤트의 `lawEffectiveDate`)로 가른다. 여러 날에 나눠 시행되는 판의
 *   계획용 날짜는 D-17 결정 전까지 이 날짜다(A안). 조마다 다른 시행일 표기는 화면이 `effectiveNotes` 로 함께 보인다.
 * - 시행일을 모르는 이벤트(null)는 이미 시행된 것으로 본다 — 예정이라고 짐작하지 않는다.
 * - 날짜는 한국 날짜(`todayDateOnly`)로 요청마다 다시 가른다 — 시행일이 지나면 같은 데이터가 현행이 된다(저장하지 않는다).
 */

export type LawChangeKind = 'created' | 'modified' | 'deleted';

export interface InForceArticleRow {
  id: string;
  nodeKey: string;
  articleNo: number;
  clauseNo: number | null;
  itemNo: number | null;
  label: string;
  title: string | null;
  content: string;
  sortOrder: number;
  effectiveNotes: unknown;
  /** 마지막 반영 판에서 사라졌다(T-124) — 시행 예정 삭제면 아직 현행이다 */
  deletedAt: Date | null;
}

export interface ScheduledEventRow {
  id: string;
  nodeKey: string;
  changeType: LawChangeKind;
  beforeContent: string | null;
  afterContent: string | null;
  lawEffectiveDate: Date | null;
  lawVersionId: string | null;
  detectedAt: Date;
}

export interface LawVersionRow {
  id: string;
  mst: string;
  orderKey: string | null;
  lawType: string | null;
  promulgatedDate: Date | null;
  promulgationNo: string | null;
  revisionType: string | null;
  effectiveDate: Date | null;
  stageEffectiveDates: Date[];
}

export interface VersionSummary {
  id: string | null;
  mst: string | null;
  lawType: string | null;
  promulgationNo: string | null;
  promulgatedDate: string | null;
  revisionType: string | null;
  effectiveDate: string | null;
  stageEffectiveDates: string[];
}

export interface ScheduledChange {
  eventId: string;
  changeType: LawChangeKind;
  /** 시행일부터의 문구 — 삭제면 null */
  content: string | null;
  effectiveDate: string;
  versionId: string | null;
  /** 이 조항에 이어서 시행될 예정 변경이 더 있다(뒤 판들) */
  laterCount: number;
}

export interface InForceArticle {
  id: string;
  nodeKey: string;
  articleNo: number;
  clauseNo: number | null;
  itemNo: number | null;
  label: string;
  title: string | null;
  /** 오늘 시행 중인 문구 — 시행일에 신설될 조항이면 null */
  content: string | null;
  sortOrder: number;
  effectiveNotes: unknown;
  /** 가장 먼저 시행될 예정 변경 — 없으면 null */
  scheduled: ScheduledChange | null;
}

export interface LawInForce {
  today: string;
  /** 오늘 시행 중인 판 — 판 기록이 없으면 null(법령 행의 값으로 대신한다) */
  current: VersionSummary | null;
  /** 시행 예정 판(시행일 순). 판 기록이 없는 옛 이벤트는 시행일마다 판 없는 항목으로 묶는다 */
  scheduled: Array<VersionSummary & { changeCount: number }>;
  articles: InForceArticle[];
}

const iso = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

function summarize(v: LawVersionRow): VersionSummary {
  return {
    id: v.id,
    mst: v.mst,
    lawType: v.lawType,
    promulgationNo: v.promulgationNo,
    promulgatedDate: iso(v.promulgatedDate),
    revisionType: v.revisionType,
    effectiveDate: iso(v.effectiveDate),
    stageEffectiveDates: v.stageEffectiveDates.map((d) => iso(d)!).filter(Boolean),
  };
}

/** 예정 이벤트인가 — 시행일이 오늘(한국 날짜)보다 뒤 */
export function isScheduled(lawEffectiveDate: Date | null, today: string): boolean {
  const d = iso(lawEffectiveDate);
  return d !== null && d > today;
}

export function splitLawInForce(input: {
  today: string;
  articles: InForceArticleRow[];
  events: ScheduledEventRow[];
  versions: LawVersionRow[];
}): LawInForce {
  const { today } = input;
  const orderOf = new Map(input.versions.map((v) => [v.id, v.orderKey ?? '']));
  // 조항마다 예정 이벤트를 시행될 순서(시행일, 같으면 판의 공포 순, 판이 없으면 감지 순)로
  const byNode = new Map<string, ScheduledEventRow[]>();
  for (const e of input.events) {
    if (!isScheduled(e.lawEffectiveDate, today)) continue;
    const list = byNode.get(e.nodeKey) ?? [];
    list.push(e);
    byNode.set(e.nodeKey, list);
  }
  const rank = (e: ScheduledEventRow) => `${iso(e.lawEffectiveDate)}|${e.lawVersionId ? orderOf.get(e.lawVersionId) ?? '' : ''}|${e.detectedAt.toISOString()}`;
  for (const list of byNode.values()) list.sort((a, b) => (rank(a) < rank(b) ? -1 : rank(a) > rank(b) ? 1 : 0));

  const articles: InForceArticle[] = [];
  for (const row of input.articles) {
    const chain = byNode.get(row.nodeKey);
    // 마지막 판에서 사라진 조항은 그 삭제가 아직 시행 전일 때만 현행이다
    if (row.deletedAt && !chain) continue;
    const first = chain?.[0];
    articles.push({
      id: row.id,
      nodeKey: row.nodeKey,
      articleNo: row.articleNo,
      clauseNo: row.clauseNo,
      itemNo: row.itemNo,
      label: row.label,
      title: row.title,
      content: first ? (first.changeType === 'created' ? null : first.beforeContent) : row.content,
      sortOrder: row.sortOrder,
      effectiveNotes: row.effectiveNotes,
      scheduled: first
        ? {
            eventId: first.id,
            changeType: first.changeType,
            content: first.changeType === 'deleted' ? null : first.afterContent,
            effectiveDate: iso(first.lawEffectiveDate)!,
            versionId: first.lawVersionId,
            laterCount: chain!.length - 1,
          }
        : null,
    });
  }

  const scheduledIds = new Set<string>();
  const changeCount = new Map<string, number>();
  const unversioned = new Map<string, number>();
  for (const list of byNode.values()) {
    for (const e of list) {
      if (e.lawVersionId) {
        scheduledIds.add(e.lawVersionId);
        changeCount.set(e.lawVersionId, (changeCount.get(e.lawVersionId) ?? 0) + 1);
      } else {
        const d = iso(e.lawEffectiveDate)!;
        unversioned.set(d, (unversioned.get(d) ?? 0) + 1);
      }
    }
  }
  const byOrder = (a: LawVersionRow, b: LawVersionRow) => ((a.orderKey ?? '') < (b.orderKey ?? '') ? -1 : (a.orderKey ?? '') > (b.orderKey ?? '') ? 1 : 0);
  const isFuture = (v: LawVersionRow) => scheduledIds.has(v.id) || isScheduled(v.effectiveDate, today);
  const inForce = input.versions.filter((v) => !isFuture(v)).sort(byOrder);
  const future = input.versions.filter(isFuture).sort(byOrder);

  const scheduled: LawInForce['scheduled'] = future.map((v) => ({ ...summarize(v), changeCount: changeCount.get(v.id) ?? 0 }));
  for (const [date, count] of unversioned) {
    scheduled.push({
      id: null,
      mst: null,
      lawType: null,
      promulgationNo: null,
      promulgatedDate: null,
      revisionType: null,
      effectiveDate: date,
      stageEffectiveDates: [date],
      changeCount: count,
    });
  }
  scheduled.sort((a, b) => ((a.effectiveDate ?? '') < (b.effectiveDate ?? '') ? -1 : (a.effectiveDate ?? '') > (b.effectiveDate ?? '') ? 1 : 0));

  return {
    today,
    current: inForce.length ? summarize(inForce[inForce.length - 1]) : null,
    scheduled,
    articles,
  };
}
