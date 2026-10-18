import { Prisma } from '@prisma/client';
import type { LawEventChannel } from '@prisma/client';
import type { PrismaService } from '../common/prisma/prisma.service';
import type { LawDetailMeta } from '../lawgokr/lawgokr.types';
import { lawBibliography, saveArticles, toDate, type PreparedVersion } from './law-articles-save';
import { versionOrderKey, type LawVersionEntry } from './law-version-plan';
import { TX_OPTIONS } from './law-tx';

/**
 * 법령 판 하나를 반영한다(T-151, PAT-07 — 특허 도 7 S770). **판 하나 = 트랜잭션 하나.**
 *
 * 1. 법령 행이 아직 직전 판(prevMst)을 가리킬 때만 이 판으로 바꾼다 — 행 잠금과 비교·교체(CAS)를 한 문장으로.
 *    0건이면 다른 경로(겹친 실행·재등록)가 먼저 판을 바꾼 것이라 손을 뗀다
 * 2. 잠근 뒤에 이전 표기 규칙(T-144 beforeRules)을 읽는다
 * 3. 판 기록(law_versions)을 넣고, 서지를 고치고, 조항을 갱신하며 생긴 이벤트가 이 판을 가리키게 한다
 *
 * 셋이 함께 커밋되지 않으면 이 판은 확정되지 않는다 — 특허의 "이벤트 저장이 끝나야 저장된 버전을 변경 후 버전으로 확정".
 * 같은 판을 두 번 넣으려 하면 CAS·(법령, MST) 유일·(판, 조항) 유일이 통째로 되돌린다.
 */

/** 다른 경로가 먼저 이 법령의 판을 바꿨다 — 실패가 아니다(다음 동기화가 새 자리에서 다시 계획한다) */
export class LawVersionRaceError extends Error {}
/** 판 기록에 이 판이 이미 있다 — 법령 행과 판 기록이 어긋난 상태라 사람이 봐야 한다 */
export class LawVersionDuplicateError extends Error {}
/** 이 판(MST)이 이미 별도 법령 행으로 등록돼 있다(같은 법령ID 의 다른 판 등록 — T-154 ② 가 막을 자리) */
export class LawVersionConflictError extends Error {}

export interface ApplyLawVersionArgs {
  lawId: string;
  /** 법령 행이 지금 가리켜야 하는 판 — 아니면 손을 뗀다 */
  prevMst: string;
  /** 판 목록의 이 판(단계 시행일·제개정구분·공포번호) */
  entry: LawVersionEntry;
  /** 이 판 본문의 메타(기본정보) */
  meta: LawDetailMeta;
  version: PreparedVersion;
  receivedVia: LawEventChannel;
}

const isUniqueViolation = (e: unknown) => e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002';

export async function applyLawVersion(prisma: PrismaService, a: ApplyLawVersionArgs): Promise<{ events: number; versionId: string }> {
  return prisma.$transaction(async (tx) => {
    // ① 잠금 + 비교·교체 — 등록(lockLawRowsForRegister)·표기 채우기(updateMany)도 법령 행부터 잡으므로 잠금 순서가 같다
    let claimed: Prisma.BatchPayload;
    try {
      claimed = await tx.law.updateMany({ where: { id: a.lawId, externalId: a.prevMst }, data: { externalId: a.entry.mst } });
    } catch (e) {
      if (isUniqueViolation(e)) {
        throw new LawVersionConflictError(
          `같은 법령이 따로 등록돼 있어 새 판(MST ${a.entry.mst})을 반영하지 못했습니다 — 아스트룸에 문의하세요.`,
        );
      }
      throw e;
    }
    if (claimed.count !== 1) {
      throw new LawVersionRaceError(`법령이 더는 MST ${a.prevMst} 을 가리키지 않습니다 — 다른 경로가 먼저 판을 바꿨습니다.`);
    }
    // ② 잠근 뒤 읽는다 — 표기 채우기(collectEffectiveNotes)가 먼저 끝났으면 그 규칙을 본다
    const prior = await tx.law.findUnique({ where: { id: a.lawId }, select: { effectiveNotesVersion: true } });

    // ③ 판 기록
    let row: { id: string };
    try {
      row = await tx.lawVersion.create({
        data: {
          lawId: a.lawId,
          mst: a.entry.mst,
          previousMst: a.prevMst,
          kind: 'change',
          orderKey: versionOrderKey(a.entry),
          lawType: a.meta.lawType,
          promulgatedDate: toDate(a.meta.promulgationDate ?? a.entry.promulgationDate),
          promulgationNo: a.meta.promulgationNo ?? a.entry.promulgationNo,
          revisionType: a.entry.revisionType ?? a.meta.revisionType,
          effectiveDate: a.version.lawEffectiveDate,
          stageEffectiveDates: a.entry.stageEffectiveDates.map((d) => toDate(d)).filter((d): d is Date => d !== null),
          versionKey: a.version.versionKey,
          receivedVia: a.receivedVia,
        },
        select: { id: true },
      });
    } catch (e) {
      if (isUniqueViolation(e)) {
        throw new LawVersionDuplicateError(
          `판 기록에 MST ${a.entry.mst} 이(가) 이미 있습니다 — 법령 행과 판 기록이 어긋났습니다(확인 필요).`,
        );
      }
      throw e;
    }

    // ④ 서지 — 확인 시각은 쓰지 않는다(법령의 판을 다 걷은 끝에서 한 번)
    await tx.law.update({ where: { id: a.lawId }, data: lawBibliography(a.meta, a.version) });

    // ⑤ 조항·이벤트 — 이벤트가 이 판을 가리킨다
    const events = await saveArticles(tx, {
      lawId: a.lawId,
      meta: a.meta,
      version: a.version,
      receivedVia: a.receivedVia,
      beforeRules: prior?.effectiveNotesVersion ?? null,
      lawVersionId: row.id,
    });
    await tx.lawVersion.update({ where: { id: row.id }, data: { eventCount: events } });
    return { events, versionId: row.id };
  }, TX_OPTIONS);
}
