import { Logger, ServiceUnavailableException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { TX_BUSY_MESSAGE } from './row-locks';
import type { PrismaService } from './prisma/prisma.service';

/** 스냅숏 안에서 읽는 클라이언트 — 하위 도우미는 이것을 첫 인자로 받는다(this.prisma 를 직접 쓰지 않는다) */
export type SnapshotDb = Prisma.TransactionClient;

/**
 * 시작 대기·제한(코덱스 자문 10/25). 시작 대기는 T-180 전 읽기가 쿼리마다 풀을 기다리던 시간(Prisma pool_timeout 기본 10초)에 맞춘다 —
 * 일관성 때문에 붐빌 때의 상세 화면이 더 빨리 실패하지 않게. 제한은 실측 p99 가 7~8초를 넘는 경로가 생기면 그 경로만 다시 정한다
 */
export const SNAPSHOT_MAX_WAIT_MS = 10_000;
export const SNAPSHOT_TIMEOUT_MS = 10_000;
export const SNAPSHOT_TIMEOUT_MESSAGE = '규정 본문을 읽는 데 너무 오래 걸려 멈췄습니다 — 잠시 뒤 다시 시도하세요.';

const logger = new Logger('ReadSnapshot');

/**
 * 연결을 못 얻음 — 시작 대기를 넘긴 P2028 "Unable to start"는 lock-busy 필터가 503 으로 바꾼다. 풀 대기(pool_timeout)도 기본 10초라
 * P2024 가 먼저 올 수도 있어 같은 503 으로(실측으로는 P2028 이 먼저였지만 두 시계의 순서에 기대지 않는다)
 */
const isPoolTimeout = (e: unknown) => e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2024';
/**
 * 제한을 넘김 — Prisma 쪽 만료(P2028 "Transaction already closed … expired transaction") 또는 DB 쪽 문장 제한(57014: 날 SQL 은
 * P2010 의 meta.code, 모델 조회는 알 수 없는 오류의 문구). 읽기만 했으니 다시 해도 된다
 */
const isExpired = (e: unknown) => {
  if (e instanceof Prisma.PrismaClientKnownRequestError) {
    // 실측한 만료 꼴만 — "Transaction not found" 같은 다른 P2028(종료 중 연결 끊김 등)은 원인이 달라 기본 처리(500, 오류 로그)로 둔다
    if (e.code === 'P2028') return /expired transaction|transaction already closed/i.test(e.message);
    return (e.meta as { code?: string } | undefined)?.code === '57014';
  }
  return e instanceof Prisma.PrismaClientUnknownRequestError && /\b57014\b|statement timeout/i.test(e.message);
};

/**
 * 시점 조회 스냅숏(T-180, PAT-22 — 특허 도 13 문단 466~467 "하나의 시점 조회 요청을 처리하는 동안 동일한 조회 기준일 및 동일한 발행
 * 이력 상태를 기준으로"). 한 요청이 규정 전문(비교라면 두 쪽·여러 규정)을 만드는 모든 읽기를 **읽기 전용 REPEATABLE READ 트랜잭션
 * 하나**로 묶는다. Prisma 는 관계마다 SELECT 를 따로 내므로, READ COMMITTED 면 문장마다 스냅숏이 달라 그 사이 커밋된 발행·폐지·
 * 시행일 보정·재파싱 반영(계층과 판을 한 커밋에 바꾼다)이 한 전문에 반쯤 섞인다. 트랜잭션의 첫 조회(제한 설정) 때 잡힌 스냅숏을 끝까지
 * 쓰면 섞이지 않는다.
 *
 * - 읽기만 한다 — 첫 조회 전에 READ ONLY(쓰기가 끼면 DB 가 거절한다). 쓰기 경로의 격리는 그대로 둔다(잠근 뒤 다시 읽기는
 *   READ COMMITTED 에 기댄다, row-locks.ts)
 * - 같은 tx 안의 Promise.all 은 한 연결에서 차례로 돈다 — 스냅숏을 함께 쓴다
 * - `work` 안에서는 읽기(와 그에 붙은 조문 고르기)까지만 — 상세·시점 전문의 조립과 비교표 맞대기는 돌려받은 뒤 tx 밖에서, 연결을 오래 쥐지 않게
 * - 제한은 Prisma 쪽(트랜잭션 시작부터 10초, 만료)과 DB 쪽(문장마다 그 문장 시작부터 10초, statement_timeout) 둘 다. Prisma 는 돌던
 *   문장을 끊지 않고 그 문장이 끝난 뒤에 만료를 알린다 — 문장 제한이 없으면 503 도 연결 반납도 그 문장이 끝날 때까지 늦어진다. 문장
 *   제한은 그 문장 하나를 10초 안으로 묶는다. Promise.all 로 줄 선 조회(한 묶음)는 마감 뒤 다음 문장부터 거절된다(Prisma 5.22 실측).
 *   관계를 펼치는 조회 하나가 내는 여러 문장 사이에서 만료를 보는지는 재지 않았다 — 그 사이라면 문장마다 10초씩 더 늦어질 수 있다
 * - 시작 대기를 넘기면 503(TX_BUSY), 제한을 넘기면 503 — 아무것도 바꾸지 않았으니 다시 시도하면 된다
 * - 같은 날짜로 나중에 같은 결과가 나온다는 보장은 아니다 — 그 사이 과거 시행일 발행·시행일 보정이 있으면 달라진다
 */
export async function readSnapshot<T>(prisma: PrismaService, work: (db: SnapshotDb) => Promise<T>): Promise<T> {
  try {
    return await prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`SET TRANSACTION READ ONLY`;
        await tx.$executeRaw`SELECT set_config('statement_timeout', ${String(SNAPSHOT_TIMEOUT_MS)}, true)`;
        return work(tx);
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, maxWait: SNAPSHOT_MAX_WAIT_MS, timeout: SNAPSHOT_TIMEOUT_MS },
    );
  } catch (e) {
    if (isPoolTimeout(e)) {
      logger.warn(`스냅숏 읽기가 연결을 얻지 못해 503(P2024 풀 대기 초과) — 풀이 마르고 있다`);
      throw new ServiceUnavailableException(TX_BUSY_MESSAGE);
    }
    if (!isExpired(e)) throw e;
    // 원 오류의 코드·마지막 줄을 함께 — 어느 시계(Prisma 만료·DB 문장 제한)에 걸렸는지 운영 로그에서 가른다
    const code = e instanceof Prisma.PrismaClientKnownRequestError ? `${e.code}${(e.meta as { code?: string } | undefined)?.code ? `/${(e.meta as { code?: string }).code}` : ''}` : 'unknown';
    const last = (e instanceof Error ? e.message : '').split('\n').map((l) => l.trim()).filter(Boolean).pop() ?? '';
    logger.warn(`스냅숏 읽기가 제한 ${SNAPSHOT_TIMEOUT_MS}ms 를 넘겨 503(${code}: ${last.slice(0, 160)}) — 큰 규정·3단비교면 제한을 다시 잰다`);
    throw new ServiceUnavailableException(SNAPSHOT_TIMEOUT_MESSAGE);
  }
}
