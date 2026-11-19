import { describe, it, expect } from 'vitest';
import { ServiceUnavailableException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { readSnapshot, SNAPSHOT_TIMEOUT_MESSAGE } from '../apps/api/src/common/read-snapshot';
import { DASHBOARD_SNAPSHOT, DashboardService } from '../apps/api/src/dashboard/dashboard.service';

/**
 * T-213 대시보드 집계는 규정 본문과 같은 readSnapshot 으로 읽는다 — 제한을 넘기면 503 이되, 문구와 로그 이름은 대시보드 것이다
 * (규정 본문 문구로 답하지 않고, 운영 로그에서 어느 읽기가 제한에 걸렸는지 가른다).
 */
const expired = () =>
  new Prisma.PrismaClientKnownRequestError(
    'Transaction API error: Transaction already closed: A commit cannot be executed on an expired transaction. The timeout for this transaction was 10000 ms, however 10012 ms passed since the start of the transaction.',
    { code: 'P2028', clientVersion: '5.22.0' },
  );
// 시험용 가짜 PrismaService — 트랜잭션만 흉내 낸다
const failing = () => ({ $transaction: () => Promise.reject(expired()) }) as never;

describe('대시보드 스냅숏 — 제한을 넘기면 대시보드 문구의 503 (T-213)', () => {
  it('이름을 주면 그 문구로, 주지 않으면 규정 본문 문구로 답한다', async () => {
    const labelled = await readSnapshot(failing(), () => Promise.resolve(1), { name: 'x', timeoutMessage: '시험 문구' }).catch((e: unknown) => e);
    expect(labelled).toBeInstanceOf(ServiceUnavailableException);
    expect((labelled as ServiceUnavailableException).message).toBe('시험 문구');
    const plain = await readSnapshot(failing(), () => Promise.resolve(1)).catch((e: unknown) => e);
    expect((plain as ServiceUnavailableException).message).toBe(SNAPSHOT_TIMEOUT_MESSAGE);
  });

  it('GET /dashboard/overview 는 readSnapshot 에 대시보드 이름·문구를 넘긴다', async () => {
    const e = await new DashboardService(failing()).overview('tenant-1').catch((x: unknown) => x);
    expect(e).toBeInstanceOf(ServiceUnavailableException);
    expect((e as ServiceUnavailableException).message).toBe(DASHBOARD_SNAPSHOT.timeoutMessage);
    expect(DASHBOARD_SNAPSHOT.timeoutMessage).not.toBe(SNAPSHOT_TIMEOUT_MESSAGE);
    expect(DASHBOARD_SNAPSHOT.timeoutMessage).not.toMatch(/규정 본문/);
  });
});
