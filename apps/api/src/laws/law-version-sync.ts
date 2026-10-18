import type { LawEventChannel } from '@prisma/client';
import type { PrismaService } from '../common/prisma/prisma.service';
import type { LawGoKrService } from '../lawgokr/lawgokr.service';
import type { LawSearchResultItem } from '../lawgokr/lawgokr.types';
import { applyChain, type ChainOutcome } from './law-version-chain';
import { applyLawVersion, LawVersionRaceError } from './law-version-apply';
import { prepareVersion, toDate } from './law-articles-save';
import type { LawSyncResult, SyncedVersion } from './law-sync-logic';
import {
  groupVersions,
  isRepealVersion,
  needsNextPage,
  planVersions,
  versionLabel,
  versionOrderKey,
  type LawVersionEntry,
} from './law-version-plan';

/**
 * 법령 하나의 판 걷기(T-151, PAT-07 — 특허 도 7 S770): 판 목록 받기 → 계획 → 저장 판 기록 보장 → 차례 반영.
 * 확인 시각·오류 기록(markChecked)은 부르는 쪽(LawSyncService.syncOne)이 `walkResult` 의 지시대로 한 곳에서 한다.
 * 판 목록은 **법령ID 로** 받는다(시행일법령 목록 `LID`) — 법령명으로 찾으면 제명이 바뀐 판을 놓치고 시행령이 섞인다.
 */

/** 판 목록은 보통 1쪽에서 끝난다. 이보다 길면 끝까지 받지 못한 것으로 보고 반영하지 않는다(일부 목록으로 판단하지 않는다) */
export const MAX_VERSION_LIST_PAGES = 10;

/** 한 번의 동기화에서 법령당 반영할 판 수 — 남으면 다음 동기화가 잇는다 */
export function maxVersionsPerRun(): number {
  const n = Math.trunc(Number(process.env.LAW_SYNC_MAX_VERSIONS || 5));
  return Number.isFinite(n) && n > 0 ? Math.min(n, 50) : 5;
}

/** 실행 "중단됨" 판정(30분)보다 짧게 — 넘기면 다음 cron 이 앞 실행을 중단으로 닫고 겹쳐 돈다 */
const MAX_RUN_BUDGET_MS = 25 * 60 * 1000;
/** 한 실행의 시간 상한(ms). 숫자가 아니면 기본 20분, 1분~25분으로 자른다 */
export function runBudgetMs(): number {
  const n = Math.trunc(Number(process.env.LAW_SYNC_BUDGET_MS || 20 * 60 * 1000));
  if (!Number.isFinite(n) || n <= 0) return 20 * 60 * 1000;
  return Math.min(MAX_RUN_BUDGET_MS, Math.max(60_000, n));
}

type LawGoKr = Pick<LawGoKrService, 'searchVersions' | 'getLaw'>;
export interface WalkDeps {
  prisma: PrismaService;
  lawGoKr: LawGoKr;
}

export interface WalkTarget {
  id: string;
  lawName: string;
  externalId: string;
  externalLawId: string;
  promulgatedDate: Date | null;
}

export interface VersionWalkPlan {
  /** 지금 시행 중인 판(목록의 현행연혁코드) — 없을 수 있다 */
  current: LawVersionEntry | null;
  stored: LawVersionEntry;
  pending: LawVersionEntry[];
}

const iso = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

/**
 * 판 목록을 쪽마다 받는다. 기준은 목록 안 저장 판의 공포일 — 저장 판 행을 본 뒤에는 그보다 오래된 행이 나온 쪽에서 멈추고(같은 날은
 * 더 받는다), 아직 못 봤으면 끝까지 받는다. 법령 행의 공포일(DB)로 멈추면 둘이 다를 때 저장 판 행이 있는 쪽 앞에서 멈출 수 있다
 */
async function fetchVersionPages(lawGoKr: LawGoKr, lawId: string, storedMst: string): Promise<LawSearchResultItem[]> {
  const out: LawSearchResultItem[] = [];
  let total: number | null = null;
  for (let page = 1; page <= MAX_VERSION_LIST_PAGES; page++) {
    const res = await lawGoKr.searchVersions(lawId, page);
    // 쪽마다 캐시가 따로 만료된다 — 받는 사이 목록이 바뀌면 쪽 경계의 행이 밀려 어느 쪽에도 보이지 않을 수 있다
    if (total !== null && res.total !== total) {
      throw new Error(`법제처 판 목록이 받는 사이 바뀌었습니다(법령ID ${lawId}, ${total} → ${res.total}건) — 다음 동기화에서 다시 확인합니다.`);
    }
    total = res.total;
    out.push(...res.items);
    const stored = out.find((i) => i.mst === storedMst && i.promulgationDate);
    if (!needsNextPage(res, stored?.promulgationDate ?? null)) return out;
  }
  throw new Error(
    out.some((i) => i.mst === storedMst)
      ? `법제처 판 목록이 ${MAX_VERSION_LIST_PAGES}쪽을 넘습니다(법령ID ${lawId}) — 끝까지 받지 못해 반영하지 않습니다.`
      : `저장된 판(MST ${storedMst})을 법제처 판 목록 ${MAX_VERSION_LIST_PAGES}쪽 안에서 찾지 못했습니다(법령ID ${lawId}) — 사이 판이 빠지지 않았다고 확인할 수 없어 반영하지 않습니다.`,
  );
}

/**
 * 판 목록을 받아 계획한다 — **DB 에 아무것도 쓰지 않는다**(CLI `--plan` 도 이것을 쓴다. 법제처 응답 캐시는 쓴다). 목록이 이상하면 throw.
 * 저장 판의 공포일까지 받는다(같은 날 포함) — 저장 판보다 앞의 판은 계획에 쓰지 않는다
 */
export async function planLawVersions(deps: WalkDeps, law: WalkTarget): Promise<VersionWalkPlan> {
  const items = await fetchVersionPages(deps.lawGoKr, law.externalLawId, law.externalId);
  // 빈 행을 가르는 기준일은 목록 안 저장 판의 공포일 — 법령 행의 공포일(DB)은 비어 있을 수 있어 대신으로만 쓴다
  const storedDate =
    items.find((i) => i.lawId === law.externalLawId && i.mst === law.externalId && i.promulgationDate)?.promulgationDate ??
    iso(law.promulgatedDate);
  const grouped = groupVersions(items, law.externalLawId, storedDate);
  if (grouped.kind === 'invalid') throw new Error(grouped.reason);
  const plan = planVersions(grouped.versions, law.externalId);
  if (plan.kind === 'stored_missing') {
    throw new Error(
      `저장된 판(MST ${law.externalId})을 법제처 판 목록에서 찾지 못했습니다 — 사이 판이 빠지지 않았다고 확인할 수 없어 반영하지 않습니다.`,
    );
  }
  return { current: grouped.versions.find((v) => v.current) ?? null, stored: plan.stored, pending: plan.pending };
}

/** 저장 판의 기록을 보장한다 — 없으면 기준판으로 만들고, 있으면 빈 칸(순서 키·단계 시행일·제개정구분)을 목록 값으로 채운다. 이벤트 없음 */
export async function ensureStoredVersionRow(prisma: PrismaService, lawId: string, stored: LawVersionEntry, receivedVia: LawEventChannel) {
  const stages = stored.stageEffectiveDates.map((d) => toDate(d)).filter((d): d is Date => d !== null);
  const row = await prisma.lawVersion.upsert({
    where: { lawId_mst: { lawId, mst: stored.mst } },
    create: {
      lawId,
      mst: stored.mst,
      kind: 'baseline',
      orderKey: versionOrderKey(stored),
      promulgatedDate: toDate(stored.promulgationDate),
      promulgationNo: stored.promulgationNo,
      revisionType: stored.revisionType,
      stageEffectiveDates: stages,
      receivedVia,
    },
    update: {},
    select: { id: true, orderKey: true, stageEffectiveDates: true, revisionType: true },
  });
  const fill: { orderKey?: string; stageEffectiveDates?: Date[]; revisionType?: string } = {};
  if (!row.orderKey) fill.orderKey = versionOrderKey(stored);
  if (!row.stageEffectiveDates.length && stages.length) fill.stageEffectiveDates = stages;
  if (!row.revisionType && stored.revisionType) fill.revisionType = stored.revisionType;
  if (Object.keys(fill).length) await prisma.lawVersion.update({ where: { id: row.id }, data: fill });
}

/** 판 목록을 받아 저장 판 뒤의 판을 차례로 반영한다. 반영할 판이 없으면 outcome null */
export async function walkLawVersions(
  deps: WalkDeps,
  law: WalkTarget,
  o: { cap: number; deadline?: number; now?: () => number },
): Promise<{ plan: VersionWalkPlan; outcome: ChainOutcome<LawVersionEntry> | null }> {
  const plan = await planLawVersions(deps, law);
  await ensureStoredVersionRow(deps.prisma, law.id, plan.stored, 'poll');
  if (!plan.pending.length) return { plan, outcome: null };
  const outcome = await applyChain<LawVersionEntry>(plan.pending, law.externalId, {
    cap: o.cap,
    deadline: o.deadline,
    now: o.now,
    isRepeal: isRepealVersion,
    isRace: (e) => e instanceof LawVersionRaceError,
    apply: async (entry, prevMst) => {
      const { meta, tree } = await deps.lawGoKr.getLaw(entry.mst);
      // 응답에 법령ID 가 빠지는 일이 있어 값이 있을 때만 견준다
      if (meta.lawId && meta.lawId !== law.externalLawId) {
        throw new Error(`MST ${entry.mst} 본문의 법령ID(${meta.lawId})가 이 법령(${law.externalLawId})과 다릅니다.`);
      }
      if (meta.promulgationDate && entry.promulgationDate && meta.promulgationDate !== entry.promulgationDate) {
        throw new Error(`MST ${entry.mst} 본문의 공포일(${meta.promulgationDate})이 판 목록(${entry.promulgationDate})과 다릅니다.`);
      }
      const version = prepareVersion(entry.mst, meta, tree);
      const r = await applyLawVersion(deps.prisma, { lawId: law.id, prevMst, entry, meta, version, receivedVia: 'poll' });
      return r.events;
    },
  });
  return { plan, outcome };
}

/** 동기화 결과에 싣는 판 요약 */
export function syncedVersions(applied: ChainOutcome<LawVersionEntry>['applied']): SyncedVersion[] {
  return applied.map(({ entry, events }) => ({
    mst: entry.mst,
    label: versionLabel(entry),
    promulgationDate: entry.promulgationDate,
    revisionType: entry.revisionType,
    stageEffectiveDates: entry.stageEffectiveDates,
    events,
  }));
}

/**
 * 판 걷기 결과 → 동기화 결과와 확인 시각 처리. 순수 함수.
 * - `checked` — 확인 끝(오류 없음): 확인 시각을 찍는다
 * - `error` — 실패: 확인 시각과 오류를 남긴다
 * - `clearError` — 판이 남음(상한·시간): 오류만 지우고 확인 시각은 그대로 둬 다음 실행 앞에 선다
 * - `none` — 경합: 아무것도 쓰지 않는다(다음 동기화가 새 자리에서 다시 계획한다)
 */
export function walkResult(
  base: Pick<LawSyncResult, 'lawId' | 'lawName' | 'fromMst'>,
  outcome: ChainOutcome<LawVersionEntry>,
): { result: LawSyncResult; mark: 'checked' | 'error' | 'clearError' | 'none' } {
  const versions = syncedVersions(outcome.applied);
  const events = versions.reduce((n, v) => n + v.events, 0);
  const moved = versions.length ? { toMst: outcome.lastMst, versions, events } : { events: 0 };
  const stop = outcome.stop;
  if (!stop) return { result: { ...base, outcome: 'updated', ...moved }, mark: 'checked' };
  const done = versions.length ? `${outcome.lastMst}까지 반영했습니다` : '반영한 판이 없습니다';
  switch (stop.kind) {
    case 'cap':
    case 'deadline':
      return {
        result: {
          ...base,
          outcome: versions.length ? 'updated' : 'unchanged',
          ...moved,
          remaining: outcome.remaining,
          note: `판 ${outcome.remaining}개가 남았습니다 — 다음 동기화가 이어서 반영합니다(${stop.kind === 'cap' ? '한 번에 반영하는 판 수 상한' : '실행 시간 상한'}).`,
        },
        mark: 'clearError',
      };
    case 'race':
      return {
        result: {
          ...base,
          outcome: versions.length ? 'updated' : 'unchanged',
          ...moved,
          remaining: outcome.remaining,
          note: `다른 경로가 먼저 이 법령의 판을 바꿨습니다 — 다음 동기화에서 이어서 확인합니다. (${stop.message})`,
        },
        // 앞 판을 반영했으면 법령은 이미 앞으로 갔다 — 어제의 오류가 남아 실패로 보이지 않게 오류만 지운다
        mark: versions.length ? 'clearError' : 'none',
      };
    case 'repeal':
      return {
        result: {
          ...base,
          outcome: 'failed',
          ...moved,
          remaining: outcome.remaining,
          error: `폐지 판(MST ${stop.mst})입니다 — 이벤트를 만들지 않았습니다(${done}). 추적 해제를 검토하세요.`,
        },
        mark: 'error',
      };
    case 'failed':
      return {
        result: {
          ...base,
          outcome: 'failed',
          ...moved,
          remaining: outcome.remaining,
          error: `MST ${stop.mst} 반영 실패(${done}): ${stop.message}`,
        },
        mark: 'error',
      };
  }
}
