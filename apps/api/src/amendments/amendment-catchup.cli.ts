/**
 * 놓친 개정 후보 보충 — T-149 를 운영에 낸 뒤 한 번, 운영 서버에서 사람이 돌린다(런북 7-10).
 *
 * 동기화 끝 자동 생성(T-106)은 이벤트를 처리할 때 확정돼 있던 연결만 봤다. 그래서 ㉠ 위 조항(조·항) 연결로만 닿는 조문은 T-148 반영
 * 전에 처리된 변경에서 빠졌고, ㉡ 처리 뒤에 확정한 연결의 조문도 빠졌다. 이 명령이 그 둘을 만든다 — 법령 시행일이 실행일 − 30일
 * 이후인 변경만(확정 시점 경로와 같은 창). 이제부터 확정하는 연결은 확정할 때 바로 만든다(AmendmentCatchupService.forConfirmedLinks).
 *
 * 실행: `node dist/amendments/amendment-catchup.cli.js [--plan] [--tenant <회사 id>] [--max-total N] [--max-per-tenant N]`
 *       — 서버에서는 `scripts/oracle/amendment-catchup.sh`
 * - `--plan`: DB 에 쓰지 않는다. 만들 후보 수(회사별·합계), 확정 시각이 빈 확정 연결 수, 잘못된 행(연결의 회사 ≠ 조문의 회사)의 id 와
 *   사용자가 돌릴 DELETE SQL 을 찍는다
 * - 플래그 없이: 같은 계획을 찍고, 합계 100건·한 회사 20건을 넘지 않으면 만든다. 다시 돌리면 0건이다(이미 후보가 있는 조문은 건너뛴다)
 * - `--max-total`·`--max-per-tenant`: 상한을 넘었을 때 PM 이 승인한 값으로만 올린다. `--tenant`: 그 회사만(시험·점검용)
 * 그 밖의 인자는 받지 않는다 — 쓰기가 기본이라 `--paln` 같은 오타가 계획을 건너뛰고 바로 만들지 않게 한다.
 * 종료 코드: 0 성공(계획만 찍은 것 포함), 1 실패(인자·세기·만들기·알림 실패, 만든 수가 계획과 다름), 2 상한을 넘어 만들지 않음
 */
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { todayDateOnly, toDateOnlyString } from '../common/date-only';
import { AmendmentCatchupService, type CatchupTarget } from './amendment-catchup.service';
import {
  CATCHUP_MAX_PER_TENANT,
  CATCHUP_MAX_TOTAL,
  T148_DEPLOYED_AT,
  deleteInvalidLinksSql,
  overCap,
  windowStart,
} from './amendment-catchup-rules';

const TAG = '[amendment-catchup]';

/** 아는 인자만 받는다 — `--plan` 과 값을 받는 셋. 모르는 토큰·빠진 값·`--tenant=…` 꼴은 거부한다 */
function parseArgs(argv: string[]) {
  const VALUED = ['--tenant', '--max-total', '--max-per-tenant'];
  const values = new Map<string, string>();
  let plan = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--plan') plan = true;
    else if (VALUED.includes(a)) {
      const v = argv[i + 1];
      if (!v || v.startsWith('--')) throw new Error(`${a} 뒤에 값을 적으세요.`);
      values.set(a, v);
      i++;
    } else throw new Error(`알 수 없는 인자: ${a} — 받는 것은 --plan, --tenant <회사 id>, --max-total N, --max-per-tenant N 뿐입니다.`);
  }
  // 상한을 올리는 값이라 '1e3'·'0x10'·' 5' 같은 꼴은 받지 않는다(오타가 큰 수가 되지 않게)
  const int = (name: string, fallback: number) => {
    const raw = values.get(name);
    if (raw === undefined) return fallback;
    if (!/^\d+$/.test(raw)) throw new Error(`${name} 뒤에는 0 이상의 정수(숫자만)를 적으세요.`);
    return Number(raw);
  };
  // 회사 id 오타가 '0건 / 0건 — 일치합니다'로 지나가지 않게
  const tenant = values.get('--tenant');
  if (tenant !== undefined && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(tenant)) {
    throw new Error(`--tenant 뒤에는 회사 id(uuid)를 적으세요: ${tenant}`);
  }
  return {
    plan,
    tenant,
    caps: { total: int('--max-total', CATCHUP_MAX_TOTAL), perTenant: int('--max-per-tenant', CATCHUP_MAX_PER_TENANT) },
  };
}

/** 회사마다 묶는다 — 계획과 실행이 같은 묶음을 쓴다 */
function byTenant(targets: CatchupTarget[]): Map<string, CatchupTarget[]> {
  const groups = new Map<string, CatchupTarget[]>();
  for (const t of targets) groups.set(t.tenantId, [...(groups.get(t.tenantId) ?? []), t]);
  return groups;
}

async function main(): Promise<number> {
  const { plan: planOnly, tenant, caps } = parseArgs(process.argv.slice(2));
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  try {
    const catchup = app.get(AmendmentCatchupService);
    const runDay = todayDateOnly();
    const customCaps = caps.total !== CATCHUP_MAX_TOTAL || caps.perTenant !== CATCHUP_MAX_PER_TENANT;
    console.log(
      `${TAG} 실행일 ${toDateOnlyString(runDay)} — 법령 시행일 ${toDateOnlyString(windowStart(runDay))} 이후 변경, ` +
        `T-148 반영 ${T148_DEPLOYED_AT.toISOString()}, 상한 합계 ${caps.total}건·한 회사 ${caps.perTenant}건${customCaps ? '(기본값 아님 — PM 승인 없이 쓰지 않는다)' : ''}` +
        (tenant ? `, 회사 ${tenant} 만` : ''),
    );

    // 계획 — 실행과 같은 길(generateForEvent 를 plan 으로)로 센다
    const groups = byTenant(await catchup.catchupTargets(runDay, tenant));
    const planned = new Map<string, number>();
    let planFailed = 0;
    for (const [tenantId, targets] of groups) {
      const p = await catchup.generate(tenantId, targets, { origin: 'catchup', plan: true });
      planned.set(tenantId, p.created);
      planFailed += p.failed.length;
      const reasons = targets.flatMap((t) => Object.values(t.reasons));
      const parent = reasons.filter((r) => r === 'parent_before_t148').length;
      // 대상(변경, 조문) 가운데 만들지 않을 것 — 기준 본문 없음·폐지, 연혁 표기만 바뀐 변경 등. 대상 수와 만들 수가 왜 다른지 보이게(세지 못한 변경의 조문은 뺀다)
      const unknown = targets.filter((t) => p.failed.includes(t.eventId)).reduce((n, t) => n + t.articleIds.length, 0);
      const skipped = reasons.length - p.created - unknown;
      console.log(
        `  회사 ${tenantId}: 만들 후보 ${p.created}건(변경 ${p.events}건 · 조문 ${p.articles}곳) — 대상 조문 ㉠ 위 조항 연결 ${parent} · ㉡ 처리 뒤 확정 ${reasons.length - parent}` +
          (skipped > 0 ? ` · 만들지 않을 것(기준 본문 없음·폐지·본문 변화 없음) ${skipped}` : '') +
          (p.failed.length ? ` · 세지 못한 변경 ${p.failed.join(', ')}` : ''),
      );
    }
    const cap = overCap(planned, caps);
    const invalid = await catchup.invalidLinkIds(tenant);
    const noTime = await catchup.confirmedWithoutTime(tenant);
    console.log(
      `${TAG}${planOnly ? ' --plan' : ''} 합계 만들 후보 ${cap.total}건 · 회사 ${planned.size}곳 · ` +
        `확정 시각이 빈 확정 연결 ${noTime}개(생성 시각을 확정 시각으로 봤다) · 잘못된 행 ${invalid.length}개`,
    );
    if (invalid.length) {
      console.log(`  잘못된 행(연결의 회사 ≠ 조문의 회사 — 어느 회사 화면에도 안 보이고 API 로 지울 수 없다): ${invalid.join(', ')}`);
      console.log('  지울 SQL — 코드는 지우지 않는다. 확인 뒤 사용자가 운영 DB 에서 돌린다(그 연결을 가리키던 후보의 law_link_id 는 비워지고 근거 스냅샷은 남는다):');
      console.log(deleteInvalidLinksSql(invalid));
    }
    if (planFailed) {
      console.log(`${TAG} 세지 못한 변경이 ${planFailed}건 있어 ${planOnly ? '계획이 온전하지 않습니다' : '만들지 않았습니다'} — 위의 '개정 후보 생성 실패' 줄(변경 id·사유)을 보세요.`);
      return 1;
    }
    if (cap.over) {
      console.log(
        `${TAG} 상한을 넘었습니다(합계 ${cap.total}건 / 상한 ${caps.total}건` +
          (cap.overTenants.length ? `, 한 회사 ${caps.perTenant}건을 넘은 회사 ${cap.overTenants.join(', ')}` : '') +
          `) — ${planOnly ? '' : '만들지 않았습니다. '}PM 에게 묻고, 승인하면 --max-total·--max-per-tenant 에 그 값을 적어 다시 돌리세요.`,
      );
      return 2;
    }
    if (planOnly) {
      console.log(`${TAG} --plan 계획만 찍었습니다(DB 에는 쓰지 않았습니다) — 만들려면 --plan 없이 다시 돌리세요.`);
      return 0;
    }

    let made = 0;
    let failed = 0;
    let unnotified = 0;
    for (const [tenantId, targets] of groups) {
      const r = await catchup.generate(tenantId, targets, { origin: 'catchup' });
      made += r.created;
      failed += r.failed.length;
      if (r.notifyFailed) unnotified++;
      console.log(
        `  회사 ${tenantId}: 만든 후보 ${r.created}건 / 계획 ${planned.get(tenantId) ?? 0}건` +
          (r.failed.length ? ` · 실패한 변경 ${r.failed.join(', ')}` : '') +
          (r.notifyFailed ? ' · 알림을 보내지 못했다(후보는 만들어졌다 — 그 회사 관리자에게 따로 알린다)' : ''),
      );
    }
    const same = made === cap.total && !failed;
    console.log(
      `${TAG} 만든 후보 ${made}건 / 계획 ${cap.total}건 — ` +
        (same ? '일치합니다. 다시 돌리면 0건이어야 합니다.' : "어긋납니다 — 위의 '개정 후보 생성 실패' 줄을 보고 --plan 으로 다시 보세요.") +
        (unnotified ? ` 알림을 보내지 못한 회사 ${unnotified}곳.` : ''),
    );
    return same && !unnotified ? 0 : 1;
  } finally {
    await app.close();
  }
}

main()
  .then((code) => process.exit(code))
  .catch((e) => {
    console.error(`${TAG} 실행 실패: ${e?.message ?? e}`);
    process.exit(1);
  });
