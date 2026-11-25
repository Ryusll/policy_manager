import { describe, it, expect, vi } from 'vitest';
import { fetchRegisterVersion, resolveRegisterVersion } from '../apps/api/src/laws/law-register-version';

/**
 * 법령은 현행 판으로 등록한다 (T-150 ③). 시행 예정 판으로 등록하면 그 판이 바꾸는 조가 변경 이벤트 없이 묻힌다.
 * 현행 판은 시행일법령 목록의 현행연혁코드('현행')로 안다.
 */
const TODAY = '2026-10-27';
type Row = { mst: string; lawId: string; status: string | null; promulgationDate: string; effectiveDate?: string };
const row = (mst: string, status: string, lawId = '001234', promulgationDate = '2026-01-01', effectiveDate?: string): Row => ({ mst, lawId, status, promulgationDate, ...(effectiveDate ? { effectiveDate } : {}) });

function fakeList(pages: Row[][]) {
  const searchVersions = vi.fn((_lawId: string, page = 1) =>
    Promise.resolve({
      page,
      display: 2,
      total: pages.flat().length,
      items: (pages[page - 1] ?? []) as never[],
    }),
  );
  return { searchVersions };
}

describe('등록할 판 고르기 (T-150)', () => {
  it('요청한 판이 현행이면 그 판', async () => {
    const lg = fakeList([[row('300', '시행예정'), row('200', '현행')]]);
    await expect(resolveRegisterVersion(lg, { mst: '200', lawId: '001234', effectiveDate: '2026-03-01', today: TODAY })).resolves.toEqual({ kind: 'requested', stageEffectiveDates: [] });
  });

  it('요청한 판이 시행 예정이면 같은 법령의 현행 판', async () => {
    const lg = fakeList([[row('300', '시행예정'), row('200', '현행')]]);
    await expect(resolveRegisterVersion(lg, { mst: '300', lawId: '001234', effectiveDate: '2026-11-27', today: TODAY })).resolves.toEqual({ kind: 'current', mst: '200', stageEffectiveDates: [] });
  });

  it('현행 판이 다음 쪽에 있으면 쪽을 넘겨 찾는다 — 다른 법령ID 의 현행 행은 쓰지 않는다', async () => {
    const lg = fakeList([[row('300', '시행예정'), row('999', '현행', '009999')], [row('200', '현행'), row('100', '연혁')]]);
    await expect(resolveRegisterVersion(lg, { mst: '300', lawId: '001234', effectiveDate: '2026-11-27', today: TODAY })).resolves.toEqual({ kind: 'current', mst: '200', stageEffectiveDates: [] });
    expect(lg.searchVersions).toHaveBeenCalledTimes(2);
  });

  it('현행 판이 없고 요청한 판이 시행 전이면 등록하지 않는다(거부)', async () => {
    const lg = fakeList([[row('300', '시행예정')]]);
    await expect(resolveRegisterVersion(lg, { mst: '300', lawId: '001234', effectiveDate: '2026-11-27', today: TODAY })).resolves.toEqual({ kind: 'not_in_force' });
  });

  it('현행 판이 없어도 요청한 판이 이미 시행됐으면 그 판(짐작해 거부하지 않는다), 법령ID 가 없으면 목록을 보지 않는다', async () => {
    const lg = fakeList([[row('300', '연혁')]]);
    await expect(resolveRegisterVersion(lg, { mst: '300', lawId: '001234', effectiveDate: '2026-01-01', today: TODAY })).resolves.toEqual({ kind: 'requested', stageEffectiveDates: [] });
    const none = fakeList([]);
    await expect(resolveRegisterVersion(none, { mst: '300', lawId: null, effectiveDate: '2026-11-27', today: TODAY })).resolves.toEqual({ kind: 'requested', stageEffectiveDates: [] });
    expect(none.searchVersions).not.toHaveBeenCalled();
  });

  it('현행 판의 본문을 받아 돌려주고, 시행 전 법령은 422 LAW_NOT_IN_FORCE', async () => {
    const detail = (mst: string, effectiveDate: string) => ({ meta: { mst, lawId: '001234', effectiveDate }, tree: { mst } });
    const getLaw = vi.fn((mst: string) => Promise.resolve((mst === '300' ? detail('300', '2026-11-27') : detail('200', '2026-03-01')) as never));
    const lg = { ...fakeList([[row('300', '시행예정'), row('200', '현행')]]), getLaw };
    const out = await fetchRegisterVersion(lg, '300', new Date('2026-10-27T03:00:00Z'));
    expect(out.mst).toBe('200');
    expect(getLaw).toHaveBeenLastCalledWith('200');

    const future = { ...fakeList([[row('300', '시행예정')]]), getLaw };
    const err = await fetchRegisterVersion(future, '300', new Date('2026-10-27T03:00:00Z')).catch((e: { getStatus: () => number; getResponse: () => unknown }) => e);
    expect((err as { getStatus: () => number }).getStatus()).toBe(422);
    expect((err as { getResponse: () => unknown }).getResponse()).toMatchObject({ code: 'LAW_NOT_IN_FORCE' });
  });
});

describe('등록할 판의 단계 시행일과 판 목록 이상 (T-150 검토)', () => {
  it('현행 판의 단계 시행일(같은 MST 의 시행일 행들)을 함께 돌려준다 — 기준판이 첫 단계부터 현행으로 보이게', async () => {
    const lg = fakeList([[row('300', '시행예정', '001234', '2026-01-01', '2027-04-28'), row('300', '현행', '001234', '2026-01-01', '2026-10-27'), row('200', '연혁', '001234', '2025-01-01', '2025-03-01')]]);
    await expect(resolveRegisterVersion(lg, { mst: '300', lawId: '001234', effectiveDate: '2027-04-28', today: TODAY })).resolves.toEqual({
      kind: 'requested',
      stageEffectiveDates: ['2026-10-27', '2027-04-28'],
    });
  });

  it('판 목록이 비면 등록하지 않는다 — 시행 전이라고 짐작하지 않는다(502 LAW_VERSION_LIST_UNAVAILABLE)', async () => {
    const empty = fakeList([]);
    await expect(resolveRegisterVersion(empty, { mst: '300', lawId: '001234', effectiveDate: '2026-11-27', today: TODAY })).resolves.toEqual({ kind: 'list_unavailable', reason: 'empty' });
    const getLaw = vi.fn(() => Promise.resolve({ meta: { mst: '300', lawId: '001234', effectiveDate: '2026-11-27' }, tree: {} } as never));
    const err = await fetchRegisterVersion({ ...fakeList([]), getLaw }, '300', new Date('2026-10-27T03:00:00Z')).catch((e: { getStatus: () => number; getResponse: () => unknown }) => e);
    expect((err as { getStatus: () => number }).getStatus()).toBe(502);
    expect((err as { getResponse: () => unknown }).getResponse()).toMatchObject({ code: 'LAW_VERSION_LIST_UNAVAILABLE' });
  });

  it('쪽 상한까지 현행을 못 찾으면 등록하지 않는다 — 옛 판으로 등록해 뒤 개정을 한꺼번에 이벤트로 만들지 않는다', async () => {
    const pages = Array.from({ length: 11 }, (_, i) => [row(`${500 - 2 * i}`, '연혁'), row(`${499 - 2 * i}`, '연혁')]);
    const lg = fakeList(pages);
    await expect(resolveRegisterVersion(lg, { mst: '480', lawId: '001234', effectiveDate: '2020-01-01', today: TODAY })).resolves.toEqual({ kind: 'list_unavailable', reason: 'too_long' });
    expect(lg.searchVersions).toHaveBeenCalledTimes(10);
  });
});

describe('앞서 공포된 판이 아직 시행 전이면 그 앞 판으로 등록 (T-150 검토)', () => {
  it('현행 판보다 먼저 공포된 판이 시행 전이면, 그 판의 바로 앞 판으로 등록한다 — 현행 판 본문에는 그 판의 개정이 이미 들어 있어 묻힌다', async () => {
    // 근로기준법(2026-11): 제21472호(03-17 공포, 2027-01-01 시행) 뒤에 공포된 판이 현행
    const lg = fakeList([
      [
        row('285279', '현행', '001234', '2026-04-07', '2026-04-07'),
        row('284443', '시행예정', '001234', '2026-03-17', '2027-01-01'),
        row('283457', '연혁', '001234', '2026-02-10', '2026-02-10'),
        row('280000', '연혁', '001234', '2025-06-01', '2025-06-01'),
      ],
    ]);
    await expect(resolveRegisterVersion(lg, { mst: '285279', lawId: '001234', effectiveDate: '2026-04-07', today: TODAY })).resolves.toEqual({
      kind: 'current',
      mst: '283457',
      stageEffectiveDates: ['2026-02-10'],
      // 등록 알림이 '현행 판으로 등록'이라고 하지 않게 — 어느 시행 전 판 때문에 앞 판으로 등록했는지 (T-150 마지막 검토)
      beforePending: 'MST 284443(2026-03-17 공포)',
    });
  });

  it('현행 판 뒤에 공포된 시행 예정 판은 기준을 바꾸지 않는다 — 다음 동기화가 이벤트로 반영한다(시연 법령 제21700호)', async () => {
    const lg = fakeList([
      [
        row('286255', '시행예정', '001234', '2026-05-26', '2026-11-27'),
        row('284457', '현행', '001234', '2026-03-17', '2026-09-18'),
        row('283455', '연혁', '001234', '2026-02-19', '2026-08-20'),
      ],
    ]);
    await expect(resolveRegisterVersion(lg, { mst: '286255', lawId: '001234', effectiveDate: '2026-11-27', today: TODAY })).resolves.toEqual({
      kind: 'current',
      mst: '284457',
      stageEffectiveDates: ['2026-09-18'],
    });
  });

  it('앞 판이 목록에 없으면(첫 판부터 시행 전인데 뒤 판이 현행 — 목록 이상) 등록하지 않는다', async () => {
    const lg = fakeList([[row('300', '현행', '001234', '2026-04-01', '2026-04-01'), row('200', '시행예정', '001234', '2026-03-01', '2027-01-01')]]);
    await expect(resolveRegisterVersion(lg, { mst: '300', lawId: '001234', effectiveDate: '2026-04-01', today: TODAY })).resolves.toEqual({ kind: 'list_unavailable', reason: 'no_base' });
  });
});
