import type { Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { PrismaService } from '../common/prisma/prisma.service';

/**
 * 법령 확인 기록(T-104, T-153 ⑤) — 동기화가 법령마다 남기는 시각과 오류. 판 걷기 결과(walkResult)와 동기화 서비스가 종류를 고르고,
 * 쓰는 칸은 여기 한 곳에서 정한다. 성공·실패는 오류 문구가 아니라 종류로 가른다 — 문구 없는 실패가 확인 성공으로 찍히지 않게.
 * - `checked` 확인 끝(오류 없음): 확인·시도 시각을 찍고 오류를 지운다
 * - `error` 실패: 시도 시각과 오류만 — 확인 시각은 그대로 둬 실패를 성공처럼 보이지 않게. 시도 시각이 찍혀 차례 뒤로 간다
 * - `clearError` 판을 반영했는데 판이 남음(판 수·시간 상한, 경합): 오류만 지운다. 시각은 그대로 — 이어서 반영하려고 차례 앞에 남는다
 * - `none` 쓰지 않음(경합이나 늦게 시작한 시간 상한으로 반영한 판이 없다 — 새로 확인한 것이 없으니 앞선 오류도 그대로)
 */
export type CheckMark = 'checked' | 'error' | 'clearError' | 'none';

/** 실패인데 사유 문구가 비었을 때 — 비워 두면 화면이 확인 실패를 알리지 못한다 */
const UNKNOWN_ERROR = '확인에 실패했습니다 — 다음 동기화에서 다시 시도합니다.';

/** 확인 기록에 쓸 칸. 순수 함수 — `none` 이면 null(쓰지 않는다) */
export function markData(how: CheckMark, error: string | null, now: Date): Prisma.LawUpdateInput | null {
  switch (how) {
    case 'checked':
      return { lastCheckedAt: now, lastAttemptedAt: now, lastCheckError: null };
    case 'error':
      return { lastAttemptedAt: now, lastCheckError: error || UNKNOWN_ERROR };
    case 'clearError':
      return { lastCheckError: null };
    case 'none':
      return null;
  }
}

export function errorText(e: unknown): string {
  const message = (e as { message?: unknown } | null)?.message;
  return typeof message === 'string' && message ? message : String(e);
}

/** 그새 법령이 삭제됐다 — 확인 기록을 남길 곳이 없다 */
const isNotFound = (e: unknown) => e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2025';

/**
 * 확인 기록을 남긴다 — 실패해도 동기화 결과(반영한 판·이벤트·판정)는 바꾸지 않는다. 그새 법령이 지워졌으면(P2025) 남길 곳이 없으니
 * 넘어가고, 그 밖의 실패는 로그와 결과 안내(돌려주는 문구)로 알린다
 */
export async function markLaw(
  prisma: Pick<PrismaService, 'law'>,
  log: Pick<Logger, 'error'>,
  law: { id: string; lawName: string },
  how: CheckMark,
  error: string | null,
): Promise<string | null> {
  const data = markData(how, error, new Date());
  if (!data) return null;
  try {
    await prisma.law.update({ where: { id: law.id }, data });
    return null;
  } catch (e) {
    if (isNotFound(e)) return null;
    log.error(`확인 기록을 남기지 못했습니다 [${law.lawName}]: ${errorText(e)}`);
    return `확인 기록을 남기지 못했습니다: ${errorText(e)}`;
  }
}
