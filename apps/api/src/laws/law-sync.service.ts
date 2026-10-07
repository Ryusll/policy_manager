import { ConflictException, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { LawSyncTrigger } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { LawGoKrService } from '../lawgokr/lawgokr.service';
import { LawsService } from './laws.service';
import {
  decideVersion,
  pickLatestVersion,
  summarizeRun,
  type LawSyncResult,
} from './law-sync-logic';

export const LAW_SYNC_DEFAULT_BATCH = 20;
export const LAW_SYNC_MAX_BATCH = 100;
/** 이보다 오래 "진행 중"인 실행은 중간에 죽은 것으로 본다(컨테이너 재시작 등) */
const STALE_RUN_MS = 30 * 60 * 1000;

interface SyncTarget {
  id: string;
  lawName: string;
  externalId: string;
  externalLawId: string | null;
}

function errorText(e: unknown): string {
  const message = (e as { message?: unknown } | null)?.message;
  return typeof message === 'string' && message ? message : String(e);
}

/**
 * 법령 주기 동기화 (T-104, 청구항 3).
 *
 * 추적 중인 법령을 확인이 오래된 순으로 N건 골라, 법제처에 새 판이 났는지 본다.
 * 새 판이면 `LawsService.applyNewVersion()` 이 조항을 갱신하고 달라진 조항을
 * `LawChangeEvent`(수신경로 `poll`)로 남긴다.
 *
 * **실패를 "개정 없음"과 섞지 않는다.** 법제처는 인증·IP 오류도 HTTP 200 으로 준다.
 * 법령마다 `lastCheckError` 를 남기고, 실행마다 `LawSyncRun` 을 남겨 화면·종료 코드로 보인다.
 *
 * 예약 실행은 컨테이너 안 스케줄러가 아니라 **서버 cron 이 CLI(`law-sync.cli.ts`)를 부른다** —
 * API 를 2대로 늘리면 내장 스케줄러는 두 번 돈다(설계안 5.2).
 */
@Injectable()
export class LawSyncService {
  private readonly log = new Logger(LawSyncService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly laws: LawsService,
    private readonly lawGoKr: LawGoKrService,
  ) {}

  async run(options: { trigger: LawSyncTrigger; limit?: number; triggeredBy?: string | null }) {
    const limit = Math.min(
      LAW_SYNC_MAX_BATCH,
      Math.max(1, Math.trunc(options.limit ?? LAW_SYNC_DEFAULT_BATCH)),
    );
    const run = await this.start(options.trigger, options.triggeredBy ?? null);
    const results: LawSyncResult[] = [];
    try {
      const targets = await this.prisma.law.findMany({
        orderBy: [{ lastCheckedAt: { sort: 'asc', nulls: 'first' } }, { createdAt: 'asc' }],
        take: limit,
        select: { id: true, lawName: true, externalId: true, externalLawId: true },
      });
      // 순차 처리 — 법제처 호출량은 인증값 단위로 제한된다
      for (const law of targets) results.push(await this.syncOne(law));
      return await this.finish(run.id, results);
    } catch (e) {
      // 법령별 오류는 syncOne 이 결과로 돌려준다. 여기 오는 것은 DB 장애 같은 실행 전체의 실패다
      await this.finish(run.id, results, errorText(e)).catch(() => undefined);
      throw e;
    }
  }

  listRuns(limit?: number) {
    return this.prisma.lawSyncRun.findMany({
      orderBy: { startedAt: 'desc' },
      take: Math.min(100, Math.max(1, Math.trunc(limit ?? 20))),
    });
  }

  private start(trigger: LawSyncTrigger, triggeredBy: string | null) {
    return this.prisma.$transaction(async (tx) => {
      // 예약 실행과 화면의 수동 실행이 겹치면 같은 법령을 두 번 받는다. "진행 중 확인 → 생성"을
      // 한 줄로 세운다. 잠금은 이 트랜잭션이 끝나면 풀린다
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('law-sync'))`;

      // 끝나지 못한 옛 실행은 "중단됨"으로 닫는다 — 영원히 "진행 중"으로 남아 다음 실행을 막지 않게
      await tx.lawSyncRun.updateMany({
        where: { status: 'running', startedAt: { lt: new Date(Date.now() - STALE_RUN_MS) } },
        data: {
          status: 'failed',
          finishedAt: new Date(),
          error: '중단됨 — 끝나지 않은 실행입니다(실행 중 프로세스가 종료된 것으로 보입니다).',
        },
      });
      const running = await tx.lawSyncRun.findFirst({ where: { status: 'running' } });
      if (running) {
        throw new ConflictException('법령 동기화가 이미 진행 중입니다. 끝난 뒤 다시 실행하세요.');
      }
      return tx.lawSyncRun.create({ data: { trigger, triggeredBy } });
    });
  }

  private finish(runId: string, results: LawSyncResult[], fatal?: string) {
    const summary = summarizeRun(results);
    return this.prisma.lawSyncRun.update({
      where: { id: runId },
      data: {
        ...summary,
        status: fatal ? 'failed' : summary.status,
        finishedAt: new Date(),
        results: results as unknown as Prisma.InputJsonValue,
        error: fatal ?? null,
      },
    });
  }

  private async syncOne(law: SyncTarget): Promise<LawSyncResult> {
    const base = { lawId: law.id, lawName: law.lawName, fromMst: law.externalId };
    try {
      if (!law.externalLawId) {
        throw new Error('법령ID가 없어 지금 판을 찾을 수 없습니다. 법령을 다시 등록하세요.');
      }
      const decision = decideVersion(
        law.externalId,
        await this.findLatest(law.lawName, law.externalLawId),
      );
      if (decision.kind === 'missing') {
        throw new Error(
          `법제처 현행 법령 목록에서 이 법령(법령ID ${law.externalLawId})을 찾지 못했습니다. ` +
            '폐지됐거나 법령명이 바뀌었을 수 있습니다.',
        );
      }
      if (decision.kind === 'newer') {
        const { events } = await this.laws.applyNewVersion(law.id, decision.mst, 'poll');
        return { ...base, outcome: 'updated', toMst: decision.mst, events };
      }
      await this.markChecked(law.id, null);
      return {
        ...base,
        outcome: 'unchanged',
        ...(decision.kind === 'older'
          ? { note: `법제처 검색 결과(MST ${decision.candidate})가 저장된 판보다 오래돼 그대로 뒀습니다.` }
          : {}),
      };
    } catch (e) {
      const error = errorText(e);
      this.log.warn(`법령 동기화 실패 [${law.lawName}]: ${error}`);
      // 실패해도 확인 시각은 갱신한다 — 고장 난 법령 하나가 매번 맨 앞에 서서 나머지를 막지 않게.
      // 그새 법령이 삭제됐으면 남길 곳이 없으니 무시한다
      await this.markChecked(law.id, error).catch(() => undefined);
      return { ...base, outcome: 'failed', error };
    }
  }

  private markChecked(lawId: string, error: string | null) {
    return this.prisma.law.update({
      where: { id: lawId },
      data: { lastCheckedAt: new Date(), lastCheckError: error },
    });
  }

  /** 법령명으로 검색해 법령ID 가 같은 것 중 최신 판. 제명이 바뀌었으면 지금 이름으로 한 번 더 */
  private async findLatest(lawName: string, lawId: string) {
    const byName = await this.lawGoKr.search({ query: lawName, display: 100 });
    const found = pickLatestVersion(byName.items, lawId);
    if (found) return found;

    const currentTitle = await this.lawGoKr.getCurrentTitleById(lawId);
    if (!currentTitle || currentTitle === lawName) return null;
    const byNewName = await this.lawGoKr.search({ query: currentTitle, display: 100 });
    return pickLatestVersion(byNewName.items, lawId);
  }
}
