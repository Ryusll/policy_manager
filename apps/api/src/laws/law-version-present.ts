import type { PrismaService } from '../common/prisma/prisma.service';

/**
 * 이벤트·개정 후보가 가리키는 판의 표기(T-150 ② "법률 제21700호")와 제개정구분(T-152) — 법령 변경 목록·영향과 개정 후보 상세가
 * 같은 칸을 쓴다. 큰 글(법제처 개정 이유)은 여기서 고르지 않는다 — 목록 100행마다 실리지 않게, 한 건을 볼 때 revisionReasonOf 로 읽는다
 */
export const VERSION_LABEL_SELECT = { select: { id: true, lawType: true, promulgationNo: true, revisionType: true } } as const;

/** 판 기록이 없는 옛 이벤트(T-151 전)는 null */
export function presentVersion(v: { lawType: string | null; promulgationNo: string | null; revisionType: string | null } | null) {
  return v ? { lawType: v.lawType, promulgationNo: v.promulgationNo, revisionType: v.revisionType } : null;
}

/** 판의 법제처 개정 이유(제개정이유, T-152) — 판 기록이 없거나 법제처가 주지 않은 판은 null. 법령 데이터는 회사 공용이다(ADR-0020) */
export async function revisionReasonOf(prisma: Pick<PrismaService, 'lawVersion'>, versionId: string | null | undefined): Promise<string | null> {
  if (!versionId) return null;
  const v = await prisma.lawVersion.findUnique({ where: { id: versionId }, select: { revisionReason: true } });
  return v?.revisionReason ?? null;
}

/** 펼친 한 건(법령 변경의 영향)에 법제처 개정 이유를 더한다(T-152) — 목록에는 싣지 않는다 */
export async function withRevisionReason<T extends object>(prisma: Pick<PrismaService, 'lawVersion'>, event: T, versionId: string | null | undefined) {
  return { ...event, revisionReason: await revisionReasonOf(prisma, versionId) };
}
