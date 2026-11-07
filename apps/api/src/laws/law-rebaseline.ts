import type { LawEventChannel, Prisma } from '@prisma/client';
import type { PrismaService } from '../common/prisma/prisma.service';
import type { LawGoKrService } from '../lawgokr/lawgokr.service';
import type { LawSearchResultItem } from '../lawgokr/lawgokr.types';
import { lawBibliography, prepareVersion, saveArticles, toDate } from './law-articles-save';
import { baseVersionIndex, groupVersions, needsNextPage, startedOn, versionOrderKey, type LawVersionEntry } from './law-version-plan';
import { TX_OPTIONS } from './law-tx';
import { revisionInfoFields } from './law-revision-info';

/**
 * 묻힌 법령 보정 (T-150 ④).
 *
 * 등록한 판의 본문에 등록 때 아직 시행 전이던 개정이 들어 있으면, 그 개정이 변경 이벤트 없이 묻힌다 — 회사들의 개정 후보도 생기지 않는다.
 * 두 경우다: T-150 ③ 전에 시행 예정 판(MST)으로 등록했거나, 등록한 판(현행)보다 먼저 공포된 판이 아직 시행 전이었다(판 본문은 공포 순으로
 * 쌓인다 — T-150 검토, 2026-11 운영의 근로기준법·자본시장법·산업안전보건법). 보정은 기준을 묻힌 판들 가운데 가장 먼저 공포된 판의 바로 앞
 * 판으로 되돌린다(`baseVersionIndex` — 등록과 같은 규칙). 되돌릴 때는 이벤트를 만들지 않고(앞 판으로 가는 것은 개정이 아니다) 확인 시각을
 * 비워, 다음 동기화가 묻힌 판부터 공포 순으로 반영해 이벤트·후보를 만들게 한다. 조항은 nodeKey 로 덮어 id 를 지킨다 — 걸어 둔
 * 연결(`LawLink`)이 그대로 이어진다.
 *
 * 판 기록이 기준판 하나뿐이고 이벤트가 0건일 때 되돌린다. 동기화가 그 뒤 판을 이미 반영했으면 되돌려 다시 걸을 때 같은 판이 두 번
 * 들어가므로 기본으로는 손대지 않고 알린다. **다시 걸기(`reset`)** 는 그 법령에 걸린 연결·개정 후보·후보로 발행한 조문 판이 하나도 없을
 * 때만 한다 — 그 법령의 변경 이벤트와 판 기록을 지우고 앞 판부터 다시 걷는다. 연결이 있으면 다시 걸을 때 이미 시행된 옛 개정까지 후보로
 * 쏟아지고, 후보가 있으면 그 원인(이벤트)이 사라진다(사람이 본다). DB 백업 뒤, 동기화 cron 을 멈추고(런북 7-5).
 */

type LawGoKr = Pick<LawGoKrService, 'searchVersions' | 'getLaw'>;
export interface RebaselineDeps {
  prisma: PrismaService;
  lawGoKr: LawGoKr;
}

export type RebaselinePlan =
  | { kind: 'not_buried'; lawName: string; storedMst: string }
  | { kind: 'blocked'; lawName: string; storedMst: string; reason: string }
  | {
      kind: 'plan';
      lawId: string;
      lawName: string;
      /** 법령 행이 지금 가리키는 판 — 동기화가 걸었으면 기준판보다 뒤다 */
      stored: LawVersionEntry;
      /** 등록 때 기준판(판 기록의 baseline) */
      baselineMst: string;
      /** 등록 때 아직 시행 전이던, 기준판까지의 판 — 그 개정이 묻혔다 */
      buried: LawVersionEntry[];
      target: LawVersionEntry;
      /** 다음 동기화가 다시 반영할 판(앞 판 뒤부터 지금 판까지) */
      replay: LawVersionEntry[];
      /** 다시 걸기 — 지울 판 기록(기준판 밖)·이벤트 수. 동기화가 아직 걷지 않았으면 null */
      reset: { versions: number; events: number } | null;
      /**
       * 되돌리기(`--apply`, 동기화가 아직 반영하지 않은 법령)에도 걸려 있는 연결 — 막지는 않는다(연결한 회사에 바른 방향의 후보가
       * 생기는 것이 보정의 목적이다). 다만 등록 때 이미 시행 중이던 판의 개정까지 그 회사의 후보가 되니 계획에 드러낸다(T-150 기록 검증)
       */
      linked: string | null;
    };

const MAX_PAGES = 10;
const kstDate = (d: Date) => new Date(d.getTime() + 9 * 3600_000).toISOString().slice(0, 10);

type HoldsDb = Pick<Prisma.TransactionClient, 'lawLink' | 'amendmentCandidate' | 'articleVersion'>;
/** 다시 걸기를 막는 것 — 이 법령에 걸린 연결·개정 후보·후보로 발행한 조문 판. 없으면 null */
async function heldBy(db: HoldsDb, lawId: string): Promise<string | null> {
  const [links, candidates, published] = await Promise.all([
    db.lawLink.count({ where: { lawArticle: { lawId } } }),
    db.amendmentCandidate.count({ where: { changeEvent: { lawId } } }),
    db.articleVersion.count({ where: { changeEvent: { lawId } } }),
  ]);
  const parts = [links && `연결 ${links}건`, candidates && `개정 후보 ${candidates}건`, published && `후보로 발행한 조문 판 ${published}개`].filter(Boolean);
  return parts.length ? parts.join('·') : null;
}

export async function planRebaseline(deps: RebaselineDeps, lawId: string, o: { reset?: boolean } = {}): Promise<RebaselinePlan> {
  const law = await deps.prisma.law.findUnique({
    where: { id: lawId },
    select: { id: true, lawName: true, externalId: true, externalLawId: true, createdAt: true },
  });
  if (!law) throw new Error(`법령을 찾을 수 없습니다(id ${lawId}).`);
  const head = { lawName: law.lawName, storedMst: law.externalId };
  if (!law.externalLawId) return { kind: 'blocked', ...head, reason: '법령ID 가 없어 판 목록을 받을 수 없습니다(T-154).' };
  const [changeVersions, events, baseline] = await Promise.all([
    deps.prisma.lawVersion.count({ where: { lawId, kind: { not: 'baseline' } } }),
    deps.prisma.lawChangeEvent.count({ where: { lawId } }),
    deps.prisma.lawVersion.findFirst({ where: { lawId, kind: 'baseline' }, select: { mst: true } }),
  ]);

  // 등록일 세 해 전까지 받는다 — 그보다 옛 행의 이상(빈 공포일 등)으로 멈추지 않게. 목록은 공포일 내림차순(`sort: 'ddes'`)이고 기준일을
  // 넘는 쪽까지 받으므로, 등록 때 시행 중이던 앞 판이 세 해보다 옛것(개정이 뜸한 법령)이어도 그 쪽에 들어온다(tests/lawRebaseline.test.ts)
  const registeredOn = kstDate(law.createdAt);
  const since = `${Number(registeredOn.slice(0, 4)) - 3}${registeredOn.slice(4)}`;
  const items: LawSearchResultItem[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const res = await deps.lawGoKr.searchVersions(law.externalLawId, page);
    items.push(...res.items);
    if (!needsNextPage(res, since)) break;
  }
  const grouped = groupVersions(items, law.externalLawId, since);
  if (grouped.kind === 'invalid') return { kind: 'blocked', ...head, reason: grouped.reason };
  const versions = grouped.versions;
  // 묻혔는지는 등록 때 기준판으로 본다 — 동기화가 걸었으면 법령 행은 그보다 뒤 판을 가리킨다
  const baselineMst = baseline?.mst ?? law.externalId;
  const at = versions.findIndex((v) => v.mst === baselineMst);
  if (at === -1) return { kind: 'blocked', ...head, reason: `등록 때 기준판(MST ${baselineMst})을 법제처 판 목록에서 찾지 못했습니다.` };
  const base = baseVersionIndex(versions, at, registeredOn);
  if (base === at) return { kind: 'not_buried', ...head };
  if (base === null) return { kind: 'blocked', ...head, reason: `등록일(${registeredOn})에 시행 중이던 앞 판이 목록에 없습니다.` };
  const storedAt = versions.findIndex((v) => v.mst === law.externalId);
  if (storedAt === -1) return { kind: 'blocked', ...head, reason: `저장된 판(MST ${law.externalId})을 법제처 판 목록에서 찾지 못했습니다.` };
  const plan = {
    kind: 'plan' as const,
    lawId,
    lawName: law.lawName,
    stored: versions[storedAt],
    baselineMst,
    buried: versions.slice(base + 1, at + 1).filter((v) => !startedOn(v, registeredOn)),
    target: versions[base],
    replay: versions.slice(base + 1, storedAt + 1),
  };
  if (!changeVersions && !events) return { ...plan, reset: null, linked: await heldBy(deps.prisma, lawId) };
  const walked = `동기화가 이미 판 ${changeVersions}개·이벤트 ${events}건을 반영했습니다`;
  if (!o.reset) {
    return {
      kind: 'blocked',
      ...head,
      reason: `${walked} — 되돌려 다시 걸으면 같은 판이 두 번 들어가 손대지 않습니다. 이 법령에 걸린 연결·개정 후보가 없으면 --reset 으로 다시 걸 수 있습니다(런북 7-5).`,
    };
  }
  const holds = await heldBy(deps.prisma, lawId);
  if (holds) return { kind: 'blocked', ...head, reason: `${walked} — 이 법령에 걸린 ${holds}이(가) 있어 다시 걸지 않습니다(사람이 봐야 합니다).` };
  return { ...plan, reset: { versions: changeVersions, events }, linked: null };
}

/** 모든 법령의 보정 계획(쓰지 않는다) — 법령마다 계획 또는 계획 실패. `--rebaseline all` 점검 */
export type RebaselineSurveyItem = { lawId: string; plan: RebaselinePlan } | { lawId: string; error: string };
export async function surveyRebaselines(deps: RebaselineDeps): Promise<{ items: RebaselineSurveyItem[]; needsAttention: number }> {
  const laws = await deps.prisma.law.findMany({ select: { id: true }, orderBy: { lawName: 'asc' } });
  const items: RebaselineSurveyItem[] = [];
  for (const { id } of laws) {
    try {
      items.push({ lawId: id, plan: await planRebaseline(deps, id) });
    } catch (e) {
      items.push({ lawId: id, error: (e as Error).message });
    }
  }
  // 묻힌 법령(계획)만이 아니라 확인이 필요한 법령(blocked — 동기화가 이미 반영해 --reset 이 필요한 것 포함)과 계획 실패도 센다
  return { items, needsAttention: items.filter((i) => 'error' in i || i.plan.kind !== 'not_buried').length };
}

/**
 * 계획대로 기준을 앞 판으로 되돌린다. 계획 뒤에 판·이벤트가 바뀌었거나 법령 행이 다른 판을 가리키면 손대지 않는다.
 * 다시 걸기는 회사 화면의 연결 만들기를 잠그지 않는다 — FK 확인을 막는 FOR UPDATE 는 지우기 전 두 곳에만 둔다(행 잠금 규칙, T-131).
 * 그래서 커밋 뒤에 연결·후보를 다시 세어 그 틈에 생긴 것을 `lateHolds` 로 알린다 — 다음 동기화 전에 사람이 본다(T-150 마지막 검토)
 */
export async function applyRebaseline(
  deps: RebaselineDeps,
  plan: Extract<RebaselinePlan, { kind: 'plan' }>,
  receivedVia: LawEventChannel = 'manual',
): Promise<{ articles: number; deletedEvents: number; lateHolds: string | null }> {
  const done = await rebaselineTx(deps, plan, receivedVia);
  if (!plan.reset) return { ...done, lateHolds: null };
  // 다시 세기가 실패해도 적용은 이미 커밋됐다 — 실패로 읽히지 않게 경고로 돌려준다
  const lateHolds = await heldBy(deps.prisma, plan.lawId).catch((e: Error) => `다시 세지 못함(${e.message}) — 연결·개정 후보를 직접 확인`);
  return { ...done, lateHolds };
}

async function rebaselineTx(
  deps: RebaselineDeps,
  plan: Extract<RebaselinePlan, { kind: 'plan' }>,
  receivedVia: LawEventChannel,
): Promise<{ articles: number; deletedEvents: number }> {
  const { meta, tree } = await deps.lawGoKr.getLaw(plan.target.mst);
  const version = prepareVersion(plan.target.mst, meta, tree);
  return deps.prisma.$transaction(async (tx) => {
    // 법령 행부터 잡는다(등록·판 반영과 같은 잠금 순서) — 저장 판이 그대로일 때만
    const claimed = await tx.law.updateMany({
      where: { id: plan.lawId, externalId: plan.stored.mst },
      data: { externalId: plan.target.mst },
    });
    if (claimed.count !== 1) throw new Error('법령이 더는 계획한 판을 가리키지 않습니다 — 다시 계획하세요.');
    const [changeVersions, events] = await Promise.all([
      tx.lawVersion.count({ where: { lawId: plan.lawId, kind: { not: 'baseline' } } }),
      tx.lawChangeEvent.count({ where: { lawId: plan.lawId } }),
    ]);
    if (!plan.reset) {
      if (changeVersions || events) throw new Error('계획 뒤에 판·이벤트가 반영됐습니다 — 손대지 않았습니다.');
    } else {
      if (changeVersions !== plan.reset.versions || events !== plan.reset.events) throw new Error('계획 뒤에 판·이벤트가 바뀌었습니다 — 다시 계획하세요.');
      const holds = await heldBy(tx, plan.lawId);
      if (holds) throw new Error(`계획 뒤에 ${holds}이(가) 생겼습니다 — 다시 걸지 않았습니다.`);
      // 개정 후보가 이벤트를 가리키면(Restrict) 여기서 실패해 트랜잭션 전체가 되돌려진다
      await tx.lawChangeEvent.deleteMany({ where: { lawId: plan.lawId } });
    }
    await tx.lawVersion.deleteMany({ where: { lawId: plan.lawId } });
    await tx.lawVersion.create({
      data: {
        lawId: plan.lawId,
        mst: plan.target.mst,
        kind: 'baseline',
        orderKey: versionOrderKey(plan.target),
        lawType: meta.lawType,
        promulgatedDate: toDate(plan.target.promulgationDate),
        promulgationNo: plan.target.promulgationNo,
        revisionType: plan.target.revisionType,
        effectiveDate: version.lawEffectiveDate,
        stageEffectiveDates: plan.target.stageEffectiveDates.map((d) => toDate(d)).filter((d): d is Date => d !== null),
        versionKey: version.versionKey,
        ...revisionInfoFields(meta), // 개정 정보(T-152) — 대상 판 본문에서
        receivedVia,
      },
    });
    // 확인 시각을 비워 다음 동기화의 맨 앞에 — 묻힌 판부터 공포 순으로 반영해 변경 이벤트·개정 후보를 만든다
    await tx.law.update({ where: { id: plan.lawId }, data: { ...lawBibliography(meta, version), lastCheckedAt: null, lastAttemptedAt: null, lastCheckError: null } });
    // 앞 판 본문으로 되돌릴 뿐 변경이 아니다 — 이벤트를 남기면 다음 동기화가 묻힌 판을 다시 반영할 때 같은 변경이 두 번 들어간다
    await saveArticles(tx, { lawId: plan.lawId, meta, version, receivedVia, beforeRules: null, lawVersionId: null, recordEvents: false });
    return { articles: version.rows.length, deletedEvents: plan.reset ? events : 0 };
  }, TX_OPTIONS);
}
