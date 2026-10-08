/**
 * 법령 주기 동기화 — 서버 cron 이 부르는 진입점 (T-104).
 *
 * HTTP(`POST /platform-admin/law-sync/run`) 대신 이 CLI 를 쓰는 이유: 그 API 는 global_admin
 * 토큰이 필요한데 토큰은 15분이면 만료돼 cron 이 쥐고 있을 수 없고, 관리자 비밀번호를 서버
 * 파일에 두는 것은 더 나쁘다. 컨테이너 안에서 서비스를 직접 부르면 자격증명이 필요 없다.
 *
 * 실행: `node dist/laws/law-sync.cli.js [--limit N]` — 서버에서는 `scripts/oracle/law-sync.sh`
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

async function main(): Promise<number> {
  const limit = parseLimit(process.argv.slice(2));
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  try {
    const run = await app.get(LawSyncService).run({ trigger: 'schedule', limit });
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
    const results = (run.results ?? []) as { outcome: string; lawName: string; error?: string }[];
    for (const r of results) {
      if (r.outcome === 'failed') console.log(`  실패: ${r.lawName} — ${r.error}`);
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
