import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { LawSyncTrigger } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { LawGoKrService } from '../lawgokr/lawgokr.service';
import { collectEffectiveNotes } from './law-effective-collect';
import { revisionInfoNote } from './law-revision-info';
import { lawSyncStatus } from './law-sync-status';
import { errorText, markLaw, type CheckMark } from './law-sync-mark';
import { AmendmentsService } from '../amendments/amendments.service';
import { summarizeRun, type LawSyncResult } from './law-sync-logic';
import { maxVersionsPerRun, planLawVersions, runBudgetMs, walkLawVersions, walkResult } from './law-version-sync';
import { versionLabel } from './law-version-plan';

export const LAW_SYNC_DEFAULT_BATCH = 20;
/** 동기화 대상 차례 — 확인 시도가 오래된 법령부터(실패한 법령도 시도 시각이 찍혀 뒤로 간다, T-153 ⑤). 실행과 계획이 같은 차례를 쓴다 */
const SYNC_ORDER = [{ lastAttemptedAt: { sort: 'asc', nulls: 'first' } }, { createdAt: 'asc' }] satisfies Prisma.LawOrderByWithRelationInput[];
export const LAW_SYNC_MAX_BATCH = 100;
/** 이보다 오래 "진행 중"인 실행은 중간에 죽은 것으로 본다(컨테이너 재시작 등) */
const STALE_RUN_MS = 30 * 60 * 1000;

interface SyncTarget {
  id: string;
  lawName: string;
  externalId: string;
  externalLawId: string | null;
  effectiveNotesVersion: number | null;
  promulgatedDate: Date | null;
}

/**
 * 법령ID 없이 등록된 옛 행 — 판 목록을 법령ID 로 받으므로 동기화할 수 없다. 저장 판 본문에서 짐작으로 채우지 않는다: 같은 법령의 옛
 * 중복이 있으면 채운 행이 다른 행의 판(법령원·MST 유일)에 걸려 영영 멈추고, 등록이 그 멈춘 행을 돌려준다(T-151 검토 4~6차)
 */
const NO_LAW_ID = '법령ID 가 없는 옛 법령이라 자동으로 확인할 수 없습니다 — 아스트룸에 문의하세요.';
/** 운영자에게만(서버 로그·--plan) — 고객 화면의 확인 오류(lastCheckError)에는 내부 문서·작업 번호를 싣지 않는다 */
const NO_LAW_ID_OPS = '법령ID 가 없는 옛 행 — 런북 7-5 의 점검(t151-law-id-check.sql) 순서로 정리(같은 판 다시 등록, 옛 중복이면 T-154)';

/**
 * 법령 주기 동기화 (T-104, 청구항 3).
 *
 * 추적 중인 법령을 확인 시도가 오래된 순으로 N건 골라, 법제처에 새 판이 났는지 본다.
 * 저장된 판 뒤에 공포된 판이 있으면 **공포 순으로 한 판씩** 반영해 판마다 달라진 조항을
 * `LawChangeEvent`(수신경로 `poll`)로 남긴다(T-151, PAT-07 — law-version-sync.ts).
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
    private readonly lawGoKr: LawGoKrService,
    private readonly amendments: AmendmentsService,
  ) {}

  /**
   * @param lawIds 이 법령만 돈다(플랫폼 관리자의 점검·통합 시험). 없으면 확인 시도가 오래된 순으로 limit 건
   */
  async run(options: { trigger: LawSyncTrigger; limit?: number; triggeredBy?: string | null; lawIds?: string[] }) {
    const limit = Math.min(
      LAW_SYNC_MAX_BATCH,
      Math.max(1, Math.trunc(options.limit ?? LAW_SYNC_DEFAULT_BATCH)),
    );
    await this.assertLawsExist(options.lawIds);
    const run = await this.start(options.trigger, options.triggeredBy ?? null);
    const results: LawSyncResult[] = [];
    const budget = runBudgetMs();
    const deadline = Date.now() + budget;
    try {
      const targets = await this.prisma.law.findMany({
        where: options.lawIds?.length ? { id: { in: options.lawIds } } : undefined,
        orderBy: SYNC_ORDER,
        take: limit,
        select: { id: true, lawName: true, externalId: true, externalLawId: true, effectiveNotesVersion: true, promulgatedDate: true },
      });
      // 순차 처리 — 법제처 호출량은 인증값 단위로 제한된다
      for (const law of targets) {
        if (Date.now() >= deadline) {
          this.log.warn(`실행 시간 상한 — 남은 법령 ${targets.length - results.length}개는 다음 실행에서 확인합니다.`);
          break;
        }
        // 실행 시간이 절반 넘게 남았을 때 시작한 법령인가 — 앞 법령이 법제처를 부르지 않고 바로 실패했어도(법령ID 없는 옛 행) 시간으로 가른다
        results.push(await this.syncOne(law, deadline, deadline - Date.now() > budget / 2));
      }
      const finished = await this.finish(run.id, results);
      // 새 변경 이벤트로 개정 후보를 만든다(T-106). 동기화 결과와 따로 간다 — 후보 생성이 실패해도
      // 법령은 이미 갱신됐고, 처리하지 못한 이벤트는 표시가 남지 않아 다음 실행에서 다시 처리한다
      const amendments = await this.amendments.processPendingEvents().catch((e) => {
        this.log.error(`개정 후보 자동 생성 실패: ${errorText(e)}`);
        return null;
      });
      return { ...finished, amendments };
    } catch (e) {
      // 법령별 오류는 syncOne 이 결과로 돌려준다. 여기 오는 것은 DB 장애 같은 실행 전체의 실패다
      await this.finish(run.id, results, errorText(e)).catch(() => undefined);
      throw e;
    }
  }

  /**
   * 반영할 판 계획만 본다 — **DB 에 쓰지 않는다**(법제처 응답 캐시만 쓴다, T-151). 운영에서 첫 반영 전에 법령별로 몇 판이
   * 이벤트가 될지 확인하는 데 쓴다(CLI `--plan`). 실행 기록도 남기지 않고 잠금도 잡지 않는다
   */
  async plan(options: { limit?: number; lawIds?: string[] }) {
    await this.assertLawsExist(options.lawIds);
    const targets = await this.prisma.law.findMany({
      where: options.lawIds?.length ? { id: { in: options.lawIds } } : undefined,
      orderBy: SYNC_ORDER,
      take: Math.min(LAW_SYNC_MAX_BATCH, Math.max(1, Math.trunc(options.limit ?? LAW_SYNC_MAX_BATCH))),
      select: { id: true, lawName: true, externalId: true, externalLawId: true, promulgatedDate: true },
    });
    const out = [];
    for (const law of targets) {
      try {
        if (!law.externalLawId) throw new Error(NO_LAW_ID_OPS);
        const p = await planLawVersions({ prisma: this.prisma, lawGoKr: this.lawGoKr }, { ...law, externalLawId: law.externalLawId });
        out.push({
          lawId: law.id,
          lawName: law.lawName,
          storedMst: law.externalId,
          currentMst: p.current?.mst ?? null,
          pending: p.pending.map((v) => ({ mst: v.mst, label: versionLabel(v), revisionType: v.revisionType, stageEffectiveDates: v.stageEffectiveDates })),
        });
      } catch (e) {
        out.push({ lawId: law.id, lawName: law.lawName, storedMst: law.externalId, error: errorText(e) });
      }
    }
    return out;
  }

  /** 추적 중인 법령 수 — `--plan` 이 한 번에 보는 수(최대 100)보다 많으면 나머지가 있다고 알린다 */
  lawCount() {
    return this.prisma.law.count();
  }

  /** 법령을 지정했는데 없는 id 가 있으면 404 — "확인 0건 · 성공"으로 끝나 점검을 마친 줄 알게 하지 않는다 */
  private async assertLawsExist(lawIds?: string[]) {
    if (!lawIds?.length) return;
    const found = await this.prisma.law.findMany({ where: { id: { in: lawIds } }, select: { id: true } });
    const missing = lawIds.filter((id) => !found.some((f) => f.id === id));
    if (missing.length) throw new NotFoundException(`법령을 찾을 수 없습니다: ${missing.join(', ')}`);
  }

  /** 마지막 성공 실행과 36시간 경고(T-153 ④) — 화면이 읽을 때 계산한다 */
  status() {
    return lawSyncStatus(this.prisma);
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

  /** @param ampleTime 실행 시간이 절반 넘게 남았을 때 시작했다(그러고도 판을 하나도 반영하지 못하면 실패로 센다, walkResult) */
  private async syncOne(law: SyncTarget, deadline: number, ampleTime: boolean): Promise<LawSyncResult> {
    const base = { lawId: law.id, lawName: law.lawName, fromMst: law.externalId };
    try {
      if (!law.externalLawId) {
        // 확인 오류(고객 화면에도 보임)는 고객 문구로, 운영자 안내는 실행 결과의 note(통합 관리자 화면만 봄)와 서버 로그에
        this.log.warn(`${NO_LAW_ID_OPS} [${law.lawName}, 저장 MST ${law.externalId}]`);
        const markNote = await this.mark(law, 'error', NO_LAW_ID);
        return { ...base, outcome: 'failed', error: NO_LAW_ID, note: [NO_LAW_ID_OPS, markNote].filter(Boolean).join(' ') };
      }
      const { outcome } = await walkLawVersions(
        { prisma: this.prisma, lawGoKr: this.lawGoKr },
        { ...law, externalLawId: law.externalLawId },
        { cap: maxVersionsPerRun(), deadline },
      );
      if (outcome) {
        const { result, mark } = walkResult(base, outcome, { ampleTime });
        if (result.error) this.log.warn(`법령 동기화 실패 [${law.lawName}]: ${result.error}`);
        // T-152: 반영하고 남은 옛 판(등록 기준판·T-152 이전 판)의 개정 정보도 채운다 — 개정이 잦아 '개정 없음'에 잘 오지 않는 법령도, 반영이
        // 실패·폐지로 늘 같은 판에서 멈추는 법령도(건너뛰면 영영 빈다). 약칭은 반영한 뒤의 저장 판 본문으로만 — 옛 판 본문의 약칭을 쓰지 않게.
        // 법제처가 응답하지 않거나 응답이 깨졌으면 채우기가 그 법령에서 멈춘다(law-revision-info)
        const current = { ...law, externalId: result.toMst ?? law.externalId };
        const infoNote = await revisionInfoNote(this.prisma, this.lawGoKr, current, { max: maxVersionsPerRun(), deadline }, this.log);
        // 판은 이미 반영됐다 — 확인 기록을 남기다 실패해도 결과(반영한 판·이벤트)는 그대로 돌려준다
        const markNote = await this.mark(law, mark, result.error ?? null);
        const note = [result.note, infoNote, markNote].filter(Boolean).join(' ');
        if (note) result.note = note;
        return result;
      }
      // T-144: 저장된 판이 마지막이면 본문을 다시 받지 않으므로, 조별 시행일 표기를 아직 지금 규칙으로 읽지 않은(T-144 이전 등록·규칙 변경)
      // 법령은 여기서 한 번 맞춘다. 이벤트는 만들지 않는다. 실패해도 법령은 "개정 없음"이 맞으니 결과는 그대로 두고, 실패는
      // 결과의 note 로 알린다(법령의 판이 그대로라 다음 주기에 다시 시도한다)
      const notesError = await collectEffectiveNotes(this.prisma, this.lawGoKr, law).then(
        (written) => {
          if (written) this.log.log(`조별 시행일 표기 ${written}건을 다시 읽어 맞췄습니다 [${law.lawName}]`);
          return null;
        },
        (e) => errorText(e),
      );
      if (notesError) this.log.warn(`조별 시행일 표기를 채우지 못했습니다 [${law.lawName}]: ${notesError}`);
      // T-152: 아직 읽지 않은 판의 법제처 개정 정보(제개정이유·개정문·약칭)도 같은 자리에서 이벤트 없이 채운다 — 실패는 note 로
      const infoNote = await revisionInfoNote(this.prisma, this.lawGoKr, law, { max: maxVersionsPerRun(), deadline }, this.log);
      const note = [
        notesError ? `조별 시행일 표기를 채우지 못했습니다(다음 동기화에서 다시 시도): ${notesError}` : null,
        infoNote,
        await this.mark(law, 'checked', null),
      ]
        .filter(Boolean)
        .join(' ');
      return { ...base, outcome: 'unchanged', ...(note ? { note } : {}) };
    } catch (e) {
      const error = errorText(e);
      this.log.warn(`법령 동기화 실패 [${law.lawName}]: ${error}`);
      // 실패는 확인 시각이 아니라 시도 시각만 찍는다 — 고장 난 법령 하나가 매번 맨 앞에 서서 나머지를 막지 않게(T-153 ⑤)
      const markNote = await this.mark(law, 'error', error);
      return { ...base, outcome: 'failed', error, ...(markNote ? { note: markNote } : {}) };
    }
  }

  /** 확인 기록(law-sync-mark.ts) — 실패해도 동기화 결과는 바꾸지 않고, 남기지 못했으면 결과 안내 문구로 돌려준다 */
  private mark(law: SyncTarget, how: CheckMark, error: string | null): Promise<string | null> {
    return markLaw(this.prisma, this.log, law, how, error);
  }
}
