import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'crypto';
import { api, createTenant, waitForApi } from './helpers';
import { sql } from './race';

/**
 * T-153 ④ (SRS LAW-17) 법령 동기화 멈춤 경고 — `GET /platform-admin/law-sync/status`(통합 관리자), `GET /laws/sync-status`(고객).
 * 마지막 성공 실행(succeeded·partial)이 36시간을 넘었는지 서버가 읽을 때 계산한다. 36시간 경계는 단위 시험(lawSyncStatus)이 보고,
 * 여기서는 경로·권한·응답 모양과 실제 실행 기록을 읽는지를 본다. 실행 기록은 SQL 로 심는다(법제처를 부르지 않게) — 끝나면 지운다.
 *
 * 막고 싶은 사고:
 * 1. 고객이 통합 관리자 경로를 읽는다, 고객 응답에 실행 id·오류문 같은 내부 값이 실린다
 * 2. 실패한 실행을 성공으로 세어 멈춤을 가린다, 일부만 실패한 실행(partial)을 빼서 멈춤이 아닌데 경고한다
 * 3. 'sync-status' 가 법령 상세(':id')에 잡혀 404 가 된다
 */
describe('T-153 ④ 법령 동기화 멈춤 경고 — 상태 경로', () => {
  let pf: Awaited<ReturnType<typeof createTenant>>;
  let customer: Awaited<ReturnType<typeof createTenant>>;
  const [okRun, partialRun, failedRun] = [randomUUID(), randomUUID(), randomUUID()];
  // 심은 실행의 표식 — 끝난 시각이 앞날이라, 지우지 못하고 남으면 그 DB 에서는 경고가 영영 뜨지 않는다. 시작할 때 남은 것부터 지운다
  const MARK = 'it-t153-status';
  // 끝난 시각(ms, UTC) — DB 는 시간대 없는 UTC 값이라 epoch 로 바로 견준다(세션 시간대를 타지 않게)
  const finishedMs = (id: string) => Number(sql(`SELECT (extract(epoch FROM finished_at) * 1000)::bigint FROM law_sync_runs WHERE id = '${id}';`));
  const KEYS = ['everSucceeded', 'lastSuccessAt', 'stale', 'staleAfterHours'];

  beforeAll(async () => {
    await waitForApi();
    pf = await createTenant('syncstatus-pf');
    sql(`UPDATE users SET platform_role='global_admin' WHERE id='${pf.user.id}';`);
    customer = await createTenant('syncstatus-c');
    // 성공 < 일부 실패(partial) < 실패 순으로 끝난 실행 셋. 끝난 시각을 앞날로 둬 다른 실행보다 늘 늦게 끝난 것으로 만든다 — 마지막
    // 성공은 partial 이어야 하고, 가장 늦게 끝난 실패를 고르면 안 된다. 시작 시각은 하루 전(실행 목록 첫머리를 다른 시험에서 뺏지 않게)
    sql(`
      DELETE FROM law_sync_runs WHERE triggered_by = '${MARK}';
      INSERT INTO law_sync_runs (id, trigger, status, started_at, finished_at, triggered_by) VALUES
        ('${okRun}', 'manual', 'succeeded', now() - interval '1 day', now() + interval '1 hour', '${MARK}'),
        ('${partialRun}', 'manual', 'partial', now() - interval '1 day', now() + interval '2 hours', '${MARK}'),
        ('${failedRun}', 'manual', 'failed', now() - interval '1 day', now() + interval '3 hours', '${MARK}');
    `);
  }, 60_000);

  afterAll(() => {
    sql(`DELETE FROM law_sync_runs WHERE triggered_by = '${MARK}';`);
  });

  it('통합 관리자 경로는 통합 관리자만 — 고객 토큰은 403', async () => {
    expect((await api('/platform-admin/law-sync/status', { token: customer.token })).status).toBe(403);
    const res = await api('/platform-admin/law-sync/status', { token: pf.token });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(Object.keys(res.body).sort()).toEqual(KEYS);
    expect(new Date(res.body.lastSuccessAt).getTime()).toBe(finishedMs(partialRun));
  });

  it("고객 경로는 시각과 참·거짓뿐 — 마지막 성공은 일부만 실패한 실행(partial)까지 세고 그 뒤에 끝난 실패 실행은 세지 않는다, ':id' 에 잡히지 않는다", async () => {
    const res = await api('/laws/sync-status', { token: customer.token });
    expect(res.status, JSON.stringify(res.body)).toBe(200); // ':id' 가 먼저 잡으면 404(경로 순서)
    expect(Object.keys(res.body).sort()).toEqual(KEYS);
    expect(res.body).toMatchObject({ stale: false, everSucceeded: true, staleAfterHours: 36 });
    expect(new Date(res.body.lastSuccessAt).getTime()).toBe(finishedMs(partialRun));
    expect(new Date(res.body.lastSuccessAt).getTime()).not.toBe(finishedMs(failedRun));
  });
});
