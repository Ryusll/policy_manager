import { expect } from 'vitest';
import { execSync } from 'child_process';

/**
 * 동시성 시험 도구 (T-131 에서 시작, T-135 가 함께 쓴다).
 *
 * HTTP 두 개를 그냥 보내면 거의 늘 차례로 처리돼 겹치지 않는다. 그래서 한쪽 트랜잭션 안에서 잠시 멈추는 시험용 트리거(pg_sleep)를
 * 걸고, 그 트리거가 실제로 멈춘 것을 확인한 뒤 다른 쪽을 보낸다. 기다려야 하는 쪽은 실제로 막혔는지(pg_blocking_pids)도 확인한다.
 * 트리거는 시험의 행에만 걸리게 조건을 주고 끝나면 지운다(통합 시험 파일은 차례로 돈다).
 */

export function sql(statement: string): string {
  return execSync(`docker compose exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -t -A -v ON_ERROR_STOP=1 -f -'`, {
    encoding: 'utf8',
    input: statement,
  }).trim();
}

/** 조건에 맞는 행에서 잠시 멈추는 시험용 트리거. 멈춘 동안은 application_name 으로 알아볼 수 있다. 지우는 함수를 돌려준다 */
export function sleepTrigger(name: string, table: string, when: 'BEFORE' | 'AFTER', event: 'INSERT' | 'UPDATE' | 'DELETE', condition: string, seconds: number) {
  const fn = `t131_${name}`;
  sql(`
    CREATE OR REPLACE FUNCTION ${fn}() RETURNS trigger LANGUAGE plpgsql AS $f$
    BEGIN
      IF ${condition} THEN
        PERFORM set_config('application_name', '${fn}', true);
        PERFORM pg_sleep(${seconds});
      END IF;
      RETURN COALESCE(NEW, OLD);
    END $f$;
    DROP TRIGGER IF EXISTS ${fn} ON ${table};
    CREATE TRIGGER ${fn} ${when} ${event} ON ${table} FOR EACH ROW EXECUTE FUNCTION ${fn}();
  `);
  return () => sql(`DROP TRIGGER IF EXISTS ${fn} ON ${table}; DROP FUNCTION IF EXISTS ${fn}();`);
}

/**
 * 조건이 맞을 때까지 기다린다. 확인(psql)이 동기라 확인하는 동안에는 방금 만든 요청이 나가지 못한다 — 먼저 한 번 양보하고, 전체를
 * 시간으로 묶는다(시험 제한 30초 안)
 */
const poll = async (what: string, check: () => boolean) => {
  const until = Date.now() + 15_000;
  while (Date.now() < until) {
    await new Promise((r) => setTimeout(r, 100));
    if (check()) return;
  }
  throw new Error(what);
};
/** 트리거가 실제로 멈춰 있을 때까지 — 다른 요청을 그 사이에 넣으려고 */
export const waitForSleep = (name: string) =>
  poll(`트리거 t131_${name} 가 멈추지 않았다 — 앞 요청이 그 자리에 오지 않았다`, () =>
    Number(sql(`SELECT count(*) FROM pg_stat_activity WHERE application_name = 't131_${name}' AND wait_event = 'PgSleep';`)) > 0);
export const stillSleeping = (name: string) =>
  Number(sql(`SELECT count(*) FROM pg_stat_activity WHERE application_name = 't131_${name}' AND wait_event = 'PgSleep';`)) > 0;
/** 뒤에 보낸 요청이 멈춘 트랜잭션에 실제로 막혔을 때까지 — 겹침이 일어났다는 증거 */
export const waitForBlockedBy = (name: string) =>
  poll(`t131_${name} 가 다른 요청을 막지 않았다 — 겹침이 일어나지 않았다`, () =>
    Number(
      sql(
        `SELECT count(*) FROM pg_stat_activity w WHERE (SELECT h.pid FROM pg_stat_activity h WHERE h.application_name = 't131_${name}' LIMIT 1) = ANY (pg_blocking_pids(w.pid));`,
      ),
    ) > 0);
export const brief = (res: { status: number; body: any }) => JSON.stringify({ status: res.status, message: res.body?.message, state: res.body?.status });
/** 409 가 상태 충돌인지(기대한 문구), 기다림 한도인지(BUSY) 가른다 — 둘 다 409 라 숫자만 보면 잠금 순서 버그를 놓친다 */
export const expect409 = (res: { status: number; body: any }, text: string) => {
  expect(res.status, brief(res)).toBe(409);
  expect(String(res.body?.message), brief(res)).toContain(text);
};
