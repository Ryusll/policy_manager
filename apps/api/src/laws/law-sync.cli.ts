/**
 * 법령 주기 동기화 — 서버 cron 이 부르는 진입점 (T-104).
 *
 * HTTP(`POST /platform-admin/law-sync/run`) 대신 이 CLI 를 쓰는 이유: 그 API 는 global_admin
 * 토큰이 필요한데 토큰은 15분이면 만료돼 cron 이 쥐고 있을 수 없고, 관리자 비밀번호를 서버
 * 파일에 두는 것은 더 나쁘다. 컨테이너 안에서 서비스를 직접 부르면 자격증명이 필요 없다.
 *
 * 실행: `node dist/laws/law-sync.cli.js [--limit N] [--law <법령 id>] [--plan]` — 서버에서는 `scripts/oracle/law-sync.sh`
 * - `--law`: 그 법령만 확인한다(점검)
 * - `--plan`: DB 에 쓰지 않고(법제처 응답 캐시만 쓴다), 법령마다 반영할 판(공포 순)만 찍는다(T-151) — 운영에서 첫 반영 전에 규모를 본다
 * - `--rebaseline <법령 id>`: 시행 예정 판으로 등록돼 개정이 묻힌 법령의 기준을 등록 때 시행 중이던 앞 판으로 되돌릴 계획을 찍는다(T-150 ④).
 *   `--apply` 를 붙여야 되돌린다(DB 백업 뒤, 동기화 cron 을 멈춘 상태에서 — 런북 7-5). 그다음 동기화가 묻힌 판부터 변경으로 반영한다
 * 종료 코드: 전부 성공 0, 하나라도 실패하면 1(cron 이 실패를 알 수 있게).
 */
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { PrismaService } from '../common/prisma/prisma.service';
import { LawGoKrService } from '../lawgokr/lawgokr.service';
import { LawSyncService } from './law-sync.service';
import { applyRebaseline, planRebaseline, type RebaselineDeps } from './law-rebaseline';

async function rebaseline(deps: RebaselineDeps, lawId: string, apply: boolean): Promise<number> {
  const plan = await planRebaseline(deps, lawId);
  if (plan.kind === 'not_buried') {
    console.log(`[law-sync --rebaseline] ${plan.lawName}: 저장 판 MST ${plan.storedMst} 은 등록 때 이미 시행 중이었습니다 — 보정할 것이 없습니다.`);
    return 0;
  }
  if (plan.kind === 'blocked') {
    console.log(`[law-sync --rebaseline] ${plan.lawName}: 보정하지 않습니다 — ${plan.reason}`);
    return 1;
  }
  const replay = plan.replay.map((v) => `MST ${v.mst}(공포 ${v.promulgationDate} · 시행 ${v.stageEffectiveDates.join(', ')})`).join(' → ');
  console.log(`[law-sync --rebaseline] ${plan.lawName}: 기준 MST ${plan.stored.mst} → ${plan.target.mst}(등록 때 시행 중). 다음 동기화가 다시 반영할 판: ${replay}`);
  if (!apply) {
    console.log('[law-sync --rebaseline] 계획만 찍었습니다(DB 에는 쓰지 않았습니다) — 되돌리려면 --apply');
    return 0;
  }
  const done = await applyRebaseline(deps, plan);
  console.log(`[law-sync --rebaseline] 되돌렸습니다 — 조항 ${done.articles}개를 앞 판 본문으로(이벤트 없음). 다음 동기화가 이 법령을 먼저 확인합니다.`);
  return 0;
}

function parseLimit(argv: string[]): number | undefined {
  const i = argv.indexOf('--limit');
  if (i === -1) return undefined;
  const n = Number(argv[i + 1]);
  if (!Number.isInteger(n) || n < 1) throw new Error('--limit 은 1 이상의 정수여야 합니다.');
  return n;
}

function parseLaw(argv: string[]): string[] | undefined {
  const i = argv.indexOf('--law');
  if (i === -1) return undefined;
  const id = argv[i + 1];
  if (!id || id.startsWith('--')) throw new Error('--law 뒤에 법령 id 를 적으세요.');
  return [id];
}

async function printPlan(sync: LawSyncService, limit: number | undefined, lawIds: string[] | undefined): Promise<number> {
  const plans = await sync.plan({ limit, lawIds });
  let failed = 0;
  for (const p of plans) {
    if ('error' in p && p.error) {
      failed += 1;
      console.log(`  확인 실패: ${p.lawName} [${p.lawId}] (저장 MST ${p.storedMst}) — ${p.error}`);
      continue;
    }
    const pending = 'pending' in p ? (p.pending ?? []) : [];
    const chain = pending.map((v) => `${v.label}[${v.revisionType ?? '?'} · 시행 ${v.stageEffectiveDates.join(', ') || '?'}]`).join(' → ');
    console.log(`  ${p.lawName} [${p.lawId}]: 저장 MST ${p.storedMst} · 현행 ${'currentMst' in p ? p.currentMst : '?'} · 반영할 판 ${pending.length}개${chain ? ` — ${chain}` : ''}`);
  }
  const total = lawIds ? plans.length : await sync.lawCount();
  const rest = total > plans.length ? ` — 전체 ${total}개 중 확인이 오래된 ${plans.length}개만 봤습니다(나머지는 법령 화면 주소의 id 로 --law <id>)` : '';
  console.log(`[law-sync --plan] 법령 ${plans.length}개 · 확인 실패 ${failed}개${rest} (DB 에는 쓰지 않았습니다)`);
  return failed ? 1 : 0;
}

async function main(): Promise<number> {
  const argv = process.argv.slice(2);
  const limit = parseLimit(argv);
  const lawIds = parseLaw(argv);
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  try {
    const rb = argv.indexOf('--rebaseline');
    if (rb !== -1) {
      const id = argv[rb + 1];
      if (!id || id.startsWith('--')) throw new Error('--rebaseline 뒤에 법령 id 를 적으세요.');
      return await rebaseline({ prisma: app.get(PrismaService), lawGoKr: app.get(LawGoKrService) }, id, argv.includes('--apply'));
    }
    if (argv.includes('--plan')) return await printPlan(app.get(LawSyncService), limit, lawIds);
    const run = await app.get(LawSyncService).run({ trigger: 'schedule', limit, lawIds });
    console.log(
      `[law-sync] ${run.status} — 확인 ${run.checkedCount} · 새 판 ${run.changedCount} · ` +
        `변경 이벤트 ${run.eventCount} · 실패 ${run.failedCount} (run ${run.id})`,
    );
    if (run.amendments) {
      const a = run.amendments;
      console.log(
        `[law-sync] 개정 후보 — 이벤트 ${a.events}건 처리 · 새 후보 ${a.created}건(회사 ${a.tenants}곳)` +
          (a.failed ? ` · 실패 ${a.failed}건(다음 실행에서 다시 처리)` : ''),
      );
    }
    const results = (run.results ?? []) as { outcome: string; lawName: string; error?: string; note?: string; versions?: { label: string; events: number }[] }[];
    for (const r of results) {
      if (r.versions?.length) console.log(`  ${r.lawName}: 판 ${r.versions.map((v) => `${v.label} ${v.events}건`).join(' → ')}`);
      if (r.outcome === 'failed') console.log(`  실패: ${r.lawName} — ${r.error}`);
      else if (r.note) console.log(`  참고: ${r.lawName} — ${r.note}`);
    }
    return run.status === 'succeeded' ? 0 : 1;
  } finally {
    await app.close();
  }
}

main()
  .then((code) => process.exit(code))
  .catch((e) => {
    console.error(`[law-sync] 실행 실패: ${e?.message ?? e}`);
    process.exit(1);
  });
