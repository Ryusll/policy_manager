import { describe, it, expect, vi } from 'vitest';
import { fetchRegisterVersion, resolveRegisterVersion } from '../apps/api/src/laws/law-register-version';

/**
 * 법령은 현행 판으로 등록한다 (T-150 ③). 시행 예정 판으로 등록하면 그 판이 바꾸는 조가 변경 이벤트 없이 묻힌다.
 * 현행 판은 시행일법령 목록의 현행연혁코드('현행')로 안다.
 */
const TODAY = '2026-10-27';
type Row = { mst: string; lawId: string; status: string | null; promulgationDate: string };
const row = (mst: string, status: string, lawId = '001234', promulgationDate = '2026-01-01'): Row => ({ mst, lawId, status, promulgationDate });

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
    await expect(resolveRegisterVersion(lg, { mst: '200', lawId: '001234', effectiveDate: '2026-03-01', today: TODAY })).resolves.toEqual({ kind: 'requested' });
  });

  it('요청한 판이 시행 예정이면 같은 법령의 현행 판', async () => {
    const lg = fakeList([[row('300', '시행예정'), row('200', '현행')]]);
    await expect(resolveRegisterVersion(lg, { mst: '300', lawId: '001234', effectiveDate: '2026-11-27', today: TODAY })).resolves.toEqual({ kind: 'current', mst: '200' });
  });

  it('현행 판이 다음 쪽에 있으면 쪽을 넘겨 찾는다 — 다른 법령ID 의 현행 행은 쓰지 않는다', async () => {
    const lg = fakeList([[row('300', '시행예정'), row('999', '현행', '009999')], [row('200', '현행'), row('100', '연혁')]]);
    await expect(resolveRegisterVersion(lg, { mst: '300', lawId: '001234', effectiveDate: '2026-11-27', today: TODAY })).resolves.toEqual({ kind: 'current', mst: '200' });
    expect(lg.searchVersions).toHaveBeenCalledTimes(2);
  });

  it('현행 판이 없고 요청한 판이 시행 전이면 등록하지 않는다(거부)', async () => {
    const lg = fakeList([[row('300', '시행예정')]]);
    await expect(resolveRegisterVersion(lg, { mst: '300', lawId: '001234', effectiveDate: '2026-11-27', today: TODAY })).resolves.toEqual({ kind: 'not_in_force' });
  });

  it('현행 판이 없어도 요청한 판이 이미 시행됐으면 그 판(짐작해 거부하지 않는다), 법령ID 가 없으면 목록을 보지 않는다', async () => {
    const lg = fakeList([[row('300', '연혁')]]);
    await expect(resolveRegisterVersion(lg, { mst: '300', lawId: '001234', effectiveDate: '2026-01-01', today: TODAY })).resolves.toEqual({ kind: 'requested' });
    const none = fakeList([]);
    await expect(resolveRegisterVersion(none, { mst: '300', lawId: null, effectiveDate: '2026-11-27', today: TODAY })).resolves.toEqual({ kind: 'requested' });
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
