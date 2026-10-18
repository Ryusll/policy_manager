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
 * 종료 코드: 전부 성공 0, 하나라도 실패하면 1(cron 이 실패를 알 수 있게).
 */
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { LawSyncService } from './law-sync.service';

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
