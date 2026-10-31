import type { LawEventChannel } from '@prisma/client';
import type { PrismaService } from '../common/prisma/prisma.service';
import type { LawGoKrService } from '../lawgokr/lawgokr.service';
import type { LawSearchResultItem } from '../lawgokr/lawgokr.types';
import { lawBibliography, prepareVersion, saveArticles, toDate } from './law-articles-save';
import { groupVersions, needsNextPage, versionOrderKey, type LawVersionEntry } from './law-version-plan';
import { TX_OPTIONS } from './law-tx';

/**
 * 묻힌 법령 보정 (T-150 ④).
 *
 * T-150 ③ 전에는 시행 예정 판(MST)으로도 등록됐다. 그러면 그 판의 본문이 기준판이 돼, 그 판이 바꾸는 조가 변경 이벤트 없이
 * 묻힌다 — 회사들의 개정 후보도 생기지 않는다. 보정은 기준을 **등록 때 시행 중이던 앞 판**(공포 순)으로 되돌린다. 되돌릴 때는
 * 이벤트를 만들지 않고(앞 판으로 가는 것은 개정이 아니다) 확인 시각을 비워, 다음 동기화가 묻힌 판부터 공포 순으로 반영해
 * 이벤트·후보를 만들게 한다. 조항은 nodeKey 로 덮어 id 를 지킨다 — 걸어 둔 연결(`LawLink`)이 그대로 이어진다.
 *
 * **판 기록이 기준판 하나뿐이고 이벤트가 0건일 때만** 되돌린다. 동기화가 그 뒤 판을 이미 반영했으면 되돌려 다시 걸을 때 같은
 * 판이 두 번 들어가므로 손대지 않고 알린다(사람이 본다). 그래서 T-151 첫 동기화 전에 돌린다(런북 7-5).
 */

type LawGoKr = Pick<LawGoKrService, 'searchVersions' | 'getLaw'>;
export interface RebaselineDeps {
  prisma: PrismaService;
  lawGoKr: LawGoKr;
}

export type RebaselinePlan =
  | { kind: 'not_buried'; lawName: string; storedMst: string }
  | { kind: 'blocked'; lawName: string; storedMst: string; reason: string }
  | { kind: 'plan'; lawId: string; lawName: string; stored: LawVersionEntry; target: LawVersionEntry; replay: LawVersionEntry[] };

const MAX_PAGES = 10;
const kstDate = (d: Date) => new Date(d.getTime() + 9 * 3600_000).toISOString().slice(0, 10);
/** 그날 이 판의 단계 중 하나라도 시행 중이었나 */
const inForceOn = (v: LawVersionEntry, day: string) => v.stageEffectiveDates.length > 0 && v.stageEffectiveDates[0] <= day;

export async function planRebaseline(deps: RebaselineDeps, lawId: string): Promise<RebaselinePlan> {
  const law = await deps.prisma.law.findUnique({
    where: { id: lawId },
    select: { id: true, lawName: true, externalId: true, externalLawId: true, promulgatedDate: true, createdAt: true },
  });
  if (!law) throw new Error(`법령을 찾을 수 없습니다(id ${lawId}).`);
  const base = { lawName: law.lawName, storedMst: law.externalId };
  if (!law.externalLawId) return { kind: 'blocked', ...base, reason: '법령ID 가 없어 판 목록을 받을 수 없습니다(T-154).' };
  const [changeVersions, events] = await Promise.all([
    deps.prisma.lawVersion.count({ where: { lawId, kind: { not: 'baseline' } } }),
    deps.prisma.lawChangeEvent.count({ where: { lawId } }),
  ]);
  if (changeVersions || events) {
    return { kind: 'blocked', ...base, reason: `동기화가 이미 판 ${changeVersions}개·이벤트 ${events}건을 반영했습니다 — 되돌려 다시 걸으면 같은 판이 두 번 들어가 손대지 않습니다(사람이 봐야 합니다).` };
  }

  // 등록일 세 해 전까지 받는다 — 등록 때 시행 중이던 앞 판은 그 안에 있고, 그보다 옛 행의 이상(빈 공포일 등)으로 멈추지 않게
  const registeredOn = kstDate(law.createdAt);
  const since = `${Number(registeredOn.slice(0, 4)) - 3}${registeredOn.slice(4)}`;
  const items: LawSearchResultItem[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const res = await deps.lawGoKr.searchVersions(law.externalLawId, page);
    items.push(...res.items);
    if (!needsNextPage(res, since)) break;
  }
  const grouped = groupVersions(items, law.externalLawId, since);
  if (grouped.kind === 'invalid') return { kind: 'blocked', ...base, reason: grouped.reason };
  const at = grouped.versions.findIndex((v) => v.mst === law.externalId);
  if (at === -1) return { kind: 'blocked', ...base, reason: `저장된 판(MST ${law.externalId})을 법제처 판 목록에서 찾지 못했습니다.` };
  const stored = grouped.versions[at];
  if (inForceOn(stored, registeredOn)) return { kind: 'not_buried', ...base };
  const before = grouped.versions.slice(0, at).filter((v) => inForceOn(v, registeredOn));
  const target = before[before.length - 1];
  if (!target) return { kind: 'blocked', ...base, reason: `등록일(${registeredOn})에 시행 중이던 앞 판이 목록에 없습니다.` };
  const replay = grouped.versions.slice(grouped.versions.indexOf(target) + 1, at + 1);
  return { kind: 'plan', lawId, lawName: law.lawName, stored, target, replay };
}

/** 계획대로 기준을 앞 판으로 되돌린다. 계획 뒤에 판·이벤트가 생겼거나 법령 행이 다른 판을 가리키면 손대지 않는다 */
export async function applyRebaseline(
  deps: RebaselineDeps,
  plan: Extract<RebaselinePlan, { kind: 'plan' }>,
  receivedVia: LawEventChannel = 'manual',
): Promise<{ articles: number }> {
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
    if (changeVersions || events) throw new Error('계획 뒤에 판·이벤트가 반영됐습니다 — 손대지 않았습니다.');
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
        receivedVia,
      },
    });
    // 확인 시각을 비워 다음 동기화의 맨 앞에 — 묻힌 판부터 공포 순으로 반영해 변경 이벤트·개정 후보를 만든다
    await tx.law.update({ where: { id: plan.lawId }, data: { ...lawBibliography(meta, version), lastCheckedAt: null, lastCheckError: null } });
    // 앞 판 본문으로 되돌릴 뿐 변경이 아니다 — 이벤트를 남기면 다음 동기화가 묻힌 판을 다시 반영할 때 같은 변경이 두 번 들어간다
    await saveArticles(tx, { lawId: plan.lawId, meta, version, receivedVia, beforeRules: null, lawVersionId: null, recordEvents: false });
    return { articles: version.rows.length };
  }, TX_OPTIONS);
}
