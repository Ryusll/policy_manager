import { BadRequestException, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { LawEventChannel } from '@prisma/client';
import type { LawDetailMeta } from '../lawgokr/lawgokr.types';
import type { RegulationArticleNode } from '../regulation-parse/regulation-tree.builder';
import { buildLawArticleRows } from './law-rows';
import { lawAggregateVersionKey } from './law-version-key';
import { detectLawArticleChanges, type ExistingLawArticleSnapshot } from './law-change-detect';
import { eventEffectiveInfo } from './law-effective-info';
import { EFFECTIVE_NOTES_VERSION, readEffectiveNotes } from '../common/effective-notes';

/**
 * 법령 판 하나의 조항 저장 — 등록(laws.service)과 판 반영(law-version-apply, T-151)이 같은 함수를 쓴다.
 * 두 경로가 갈라지면 같은 판을 등록과 동기화가 다르게 저장한다.
 */

const log = new Logger('LawArticlesSave');

/** `YYYY-MM-DD` → Date(UTC 자정). 날짜 컬럼이라 시간대에 끌려가면 안 된다 */
export function toDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return null;
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
}

type LawArticleRows = ReturnType<typeof buildLawArticleRows>['rows'];

export interface PreparedVersion {
  rows: LawArticleRows;
  skipped: number;
  versionKey: string;
  lawEffectiveDate: Date | null;
}

/**
 * 같은 nodeKey 가 둘 이상이면 마지막 것만 남긴다 — 조항 저장(upsert)도 마지막 행이 이기므로 저장 결과와 같다. 남겨 두면 한 판에서
 * 같은 조항 이벤트가 둘 생겨 (판, 조항) 유일(T-151)에 걸려 그 판을 영영 반영하지 못한다
 */
function lastPerNodeKey<T extends { nodeKey: string }>(rows: T[]): { rows: T[]; dropped: number } {
  const byKey = new Map<string, T>();
  for (const row of rows) {
    byKey.delete(row.nodeKey); // 순서는 마지막 등장 자리로
    byKey.set(row.nodeKey, row);
  }
  return { rows: [...byKey.values()], dropped: rows.length - byKey.size };
}

/** 본문 트리 → 조항 행·본문 지문. 조문이 하나도 없으면 저장하지 않는다(별표·서식만 있는 문서) */
export function prepareVersion(mst: string, meta: LawDetailMeta, tree: { roots: RegulationArticleNode[] }): PreparedVersion {
  const built = buildLawArticleRows(tree.roots);
  const { skipped } = built;
  const { rows, dropped } = lastPerNodeKey(built.rows);
  if (dropped) log.warn(`MST=${mst}: 같은 자리(nodeKey)의 조항 ${dropped}건이 겹쳐 마지막 것만 남겼습니다.`);
  if (!rows.length) {
    throw new BadRequestException(`법제처 응답에 조문이 없어 등록할 수 없습니다 (MST=${mst}). 별표·서식만 있는 문서일 수 있습니다.`);
  }
  if (skipped) log.warn(`MST=${mst}: 조 번호를 읽을 수 없는 ${skipped}건을 건너뛰었습니다.`);
  return {
    rows,
    skipped,
    versionKey: lawAggregateVersionKey(rows.map((r) => r.versionKey)),
    lawEffectiveDate: toDate(meta.effectiveDate),
  };
}

/**
 * 법령 행의 서지 값. 등록·판 반영이 같은 함수를 쓴다. 확인 시각(lastCheckedAt·lastCheckError)은 넣지 않는다 —
 * 등록은 따로 찍고, 동기화는 한 법령의 판을 다 걷고 난 끝에서만 찍는다(일부만 반영한 법령이 "확인 성공"처럼 보이지 않게)
 */
export function lawBibliography(meta: LawDetailMeta, version: PreparedVersion) {
  return {
    // 응답에 법령ID 가 빠지는 일이 있어도 저장된 값을 null 로 덮지 않는다 — 동기화의 열쇠다
    externalLawId: meta.lawId ?? undefined,
    lawName: meta.title,
    lawNo: meta.promulgationNo,
    lawType: meta.lawType,
    ministry: meta.ministry,
    promulgatedDate: toDate(meta.promulgationDate),
    effectiveDate: version.lawEffectiveDate,
    versionKey: version.versionKey,
    // T-144: 조항의 시행일 표기를 이 판의 읽기 규칙으로 썼다 — 동기화가 같은 규칙이면 다시 읽지 않는다
    effectiveNotesVersion: EFFECTIVE_NOTES_VERSION,
    sourceUrl: meta.sourceUrl,
  };
}

export interface SaveArticlesArgs {
  lawId: string;
  meta: LawDetailMeta;
  version: PreparedVersion;
  receivedVia: LawEventChannel;
  /** 저장 전 법령 행의 표기 읽기 판(T-144) — 이벤트의 앞뒤 표기를 같은 규칙으로 읽었는지 가린다 */
  beforeRules: number | null;
  /** 이 저장을 만든 법령 판 기록(T-151). 등록(같은 판을 다시 읽음)은 null */
  lawVersionId: string | null;
}

/**
 * 조항을 nodeKey 기준으로 갱신하고, 달라진 조항을 `LawChangeEvent` 로 남긴다(T-103).
 * @returns 만들어진 변경 이벤트 수
 */
export async function saveArticles(tx: Prisma.TransactionClient, args: SaveArticlesArgs): Promise<number> {
  const { lawId, meta, version, receivedVia, beforeRules, lawVersionId } = args;
  const { rows, lawEffectiveDate } = version;

  // T-103: 변경 감지의 "이전" 스냅샷 — 아래 upsert 루프가 값을 갈아끼우기 전에 찍는다.
  // 이미 사라진 조항(T-124)은 빼야 동기화마다 "삭제됨" 이벤트가 되풀이되지 않는다
  const existingBefore = await tx.lawArticle.findMany({
    where: { lawId, deletedAt: null },
    select: { id: true, nodeKey: true, content: true, versionKey: true, effectiveNotes: true },
  });
  // T-144: 이벤트에 남길 "그때의" 조별 시행일 표기 — null = 그때는 수집하지 않았다
  const notesBefore = new Map(existingBefore.map((a) => [a.nodeKey, readEffectiveNotes(a.effectiveNotes)]));
  const existingArticles: ExistingLawArticleSnapshot[] = existingBefore.map((a) => ({
    lawArticleId: a.id,
    nodeKey: a.nodeKey,
    content: a.content,
    versionKey: a.versionKey,
  }));

  const articleIdByNodeKey = new Map<string, string>();
  for (const row of rows) {
    const saved = await tx.lawArticle.upsert({
      where: { lawId_nodeKey: { lawId, nodeKey: row.nodeKey } },
      update: {
        articleNo: row.articleNo,
        clauseNo: row.clauseNo,
        itemNo: row.itemNo,
        label: row.label,
        title: row.title,
        content: row.content,
        versionKey: row.versionKey,
        // 계획용 날짜는 판 시행일 그대로다. 법제처의 구조화된 조문시행일자는 늘 판 시행일과 같고(T-144 조사), 조마다 다른 날은
        // 글자 표기뿐이라 날짜와 범위를 `effectiveNotes` 에 따로 남긴다 — 범위를 잘못 읽어 기준일을 옮기지 않으려는 것이다
        effectiveDate: lawEffectiveDate,
        effectiveNotes: row.effectiveNotes as unknown as Prisma.InputJsonValue,
        sortOrder: row.sortOrder,
        // 사라졌던 조항이 다시 나타나면 되살린다(같은 행이라 걸어 둔 연결이 그대로 이어진다)
        deletedAt: null,
      },
      create: {
        lawId,
        nodeKey: row.nodeKey,
        articleNo: row.articleNo,
        clauseNo: row.clauseNo,
        itemNo: row.itemNo,
        label: row.label,
        title: row.title,
        content: row.content,
        versionKey: row.versionKey,
        effectiveDate: lawEffectiveDate,
        effectiveNotes: row.effectiveNotes as unknown as Prisma.InputJsonValue,
        sortOrder: row.sortOrder,
      },
    });
    articleIdByNodeKey.set(row.nodeKey, saved.id);
  }

  // T-103: 이전 스냅샷과 이번 응답을 견줘 실제로 달라진 조항만 이벤트로 남긴다
  // (최초 등록은 비교 대상이 없어 빈 결과 — detectLawArticleChanges 주석 참고).
  // deleteMany(아래) 보다 반드시 먼저다 — 삭제될 조문의 lawArticleId 가 아직 살아
  // 있어야 이벤트에 담을 수 있다(그 뒤 deleteMany 가 SetNull 로 FK 만 끊는다).
  const changes = detectLawArticleChanges(existingArticles, rows, articleIdByNodeKey);
  if (changes.length) {
    const rowByNodeKey = new Map(rows.map((r) => [r.nodeKey, r]));
    await tx.lawChangeEvent.createMany({
      data: changes.map((change) => {
        // T-144: 그때의 시행일 표기 스냅샷 — 본문이 바뀐 이벤트에만 붙는다(표기만 바뀐 판은 이벤트를 만들지 않는다)
        const info = eventEffectiveInfo({
          nodeKey: change.nodeKey,
          mst: meta.mst,
          before: change.type === 'created' ? null : (notesBefore.get(change.nodeKey) ?? null),
          after: change.type === 'deleted' ? null : (rowByNodeKey.get(change.nodeKey)?.effectiveNotes ?? null),
          beforeRules,
        });
        return {
          lawId,
          lawArticleId: change.lawArticleId,
          nodeKey: change.nodeKey,
          changeType: change.type,
          beforeContent: change.type === 'created' ? null : change.before.content,
          afterContent: change.type === 'deleted' ? null : change.after.content,
          beforeVersionKey: change.type === 'created' ? null : change.before.versionKey,
          afterVersionKey: change.type === 'deleted' ? null : change.after.versionKey,
          // T-151: 공포일·법령 시행일은 이 이벤트를 만든 판의 값 — 판을 차례로 반영하므로 중간 판의 변경이 마지막 판의 날짜로 묶이지 않는다
          promulgatedDate: toDate(meta.promulgationDate),
          lawEffectiveDate,
          effectiveInfo: info ? (info as unknown as Prisma.InputJsonValue) : undefined,
          receivedVia,
          lawVersionId,
        };
      }),
    });
  }

  // 새 응답에 없는 nodeKey — 조문이 실제로 삭제된 개정(전부개정 같은 구조 변경).
  // **지우지 않고 "삭제됨"으로 표시한다(T-124).** 지우면 회사들이 걸어 둔 LawLink 가 cascade 로
  // 함께 지워져, 위에서 만든 "삭제됨" 이벤트의 영향(T-105)·개정 후보(T-106)에서 그 조항에 걸려 있던
  // 사내 조문을 찾을 수 없었다. 표시만 하면 이벤트의 lawArticleId 와 연결이 그대로 이어진다.
  await tx.lawArticle.updateMany({
    where: { lawId, deletedAt: null, nodeKey: { notIn: rows.map((r) => r.nodeKey) } },
    data: { deletedAt: new Date() },
  });

  return changes.length;
}
