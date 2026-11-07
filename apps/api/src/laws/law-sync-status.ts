import type { PrismaService } from '../common/prisma/prisma.service';

/**
 * 법령 동기화가 멈췄는지(T-153 ④, SRS LAW-17) — 마지막 성공 실행이 36시간을 넘으면 플랫폼 관리자 화면과 법령 화면이 경고한다.
 * 화면이 읽을 때 계산한다 — 예약 실행이 멈추면 아무도 쓰지 못하므로 저장하지 않는다.
 *
 * 성공 실행 = 실패 없이, 또는 일부만 실패하고 끝난 실행(succeeded·partial — summarizeRun). 확인할 법령이 0건이었거나 판 수·시간
 * 상한으로 판을 반영하고 남은 실행도 여기 든다(실행 시간을 절반 넘게 남기고 시작했는데도 시간 상한까지 한 판도 반영하지 못한 법령은
 * 실패로 센다 — walkResult. 실행은 결과가 모두 실패일 때만 실패다). 일부 법령의
 * 실패는 법령마다의 확인 실패 표시가 따로 알리고, 이 경고는 예약 실행이 멈췄거나 모든 확인이 실패하는 것을 잡는다. 한 법령만 점검한
 * 실행(화면 수동·CLI `--law`)도 성공으로 센다(실행 기록에 범위 칸이 없다 — 알고 둔다). 끝난 시각(finishedAt) 기준이다.
 */
export const STALE_AFTER_HOURS = 36;
const HOUR_MS = 3_600_000;

export type LawSyncStatus = {
  /** 마지막 성공 실행이 끝난 시각(ISO), 없으면 null */
  lastSuccessAt: string | null;
  /** 36시간을 넘었는지 — 성공 실행이 한 번도 없으면 false(everSucceeded 로 가른다: 새 설치에 경고를 내지 않게) */
  stale: boolean;
  everSucceeded: boolean;
  staleAfterHours: number;
};

/** 순수 계산 — 36시간 정각은 아직 정상, 넘으면 경고 */
export function syncStatus(lastSuccessAt: Date | null, now: Date = new Date()): LawSyncStatus {
  return {
    lastSuccessAt: lastSuccessAt ? lastSuccessAt.toISOString() : null,
    stale: !!lastSuccessAt && now.getTime() - lastSuccessAt.getTime() > STALE_AFTER_HOURS * HOUR_MS,
    everSucceeded: !!lastSuccessAt,
    staleAfterHours: STALE_AFTER_HOURS,
  };
}

/** 마지막 성공 실행 — 플랫폼 관리자 화면과 고객 법령 화면이 같은 계산을 쓴다(고객 응답도 시각과 참·거짓뿐이다) */
export async function lawSyncStatus(prisma: Pick<PrismaService, 'lawSyncRun'>, now: Date = new Date()): Promise<LawSyncStatus> {
  const last = await prisma.lawSyncRun.findFirst({
    where: { status: { in: ['succeeded', 'partial'] }, finishedAt: { not: null } },
    orderBy: { finishedAt: 'desc' },
    select: { finishedAt: true },
  });
  return syncStatus(last?.finishedAt ?? null, now);
}
