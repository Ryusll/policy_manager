import { describe, it, expect } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { AI_QA_LOG_RETENTION_DAYS, purgeAiQaLogs, retentionCutoff } from '../apps/api/src/ask/ask-retention';
import { aiQaNotice } from '../apps/api/src/ask/ask-notice';

describe('질문 기록 보관 기간 (T-146)', () => {
  it('90일 — 관리자가 동의한 고지에 같은 일수가 실린다', () => {
    expect(AI_QA_LOG_RETENTION_DAYS).toBe(90);
    expect(aiQaNotice().retention.join(' ')).toContain(`${AI_QA_LOG_RETENTION_DAYS}일 보관`);
  });

  it('월 한도가 세는 기간(그달, 최대 31일)보다 길다 — 짧으면 지운 만큼 한도가 샌다', () => {
    expect(AI_QA_LOG_RETENTION_DAYS).toBeGreaterThan(31);
  });
});

describe('질문 기록 파기 (T-146)', () => {
  const now = new Date('2026-10-14T03:00:00Z');

  it('기준 시각은 지금에서 N일 전', () => {
    expect(retentionCutoff(90, now).toISOString()).toBe('2026-07-16T03:00:00.000Z');
  });

  it('기준 시각보다 먼저 만든 기록만 모든 회사에서 지우고 건수만 돌려준다 — 기본은 보관 기간 상수', async () => {
    const calls: unknown[] = [];
    const db = {
      aiQaLog: {
        deleteMany: (args: unknown) => {
          calls.push(args);
          return Promise.resolve({ count: 3 });
        },
      },
    } as unknown as Pick<PrismaClient, 'aiQaLog'>;
    const r = await purgeAiQaLogs(db, undefined, now);
    expect(calls).toEqual([{ where: { createdAt: { lt: new Date('2026-07-16T03:00:00.000Z') } } }]);
    expect(r).toEqual({ deleted: 3, cutoff: new Date('2026-07-16T03:00:00.000Z'), days: AI_QA_LOG_RETENTION_DAYS });
  });
});
