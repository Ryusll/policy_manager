import { describe, it, expect } from 'vitest';
import {
  MAX_VERSION_LIST_PAGES,
  ensureStoredVersionRow,
  planLawVersions,
  walkLawVersions,
  walkResult,
} from '../apps/api/src/laws/law-version-sync';
import { mapLawDetail } from '../apps/api/src/lawgokr/lawgokr.mapper';
import type { LawVersionEntry } from '../apps/api/src/laws/law-version-plan';

/**
 * 법령 하나의 판 걷기 (T-151, PAT-07 — 특허 도 7 S770): 판 목록 받기·점검, 저장 판 기록, 결과 정리.
 *
 * 막고 싶은 사고:
 * 1. 판 목록을 법령명으로 찾아 제명이 바뀐 판을 놓치거나, 이름이 겹치는 다른 법령(시행령 등)의 판을 섞는다 — 법령ID(LID)로 받는다
 * 2. 목록을 일부만 받고(쪽 상한·덜 찬 쪽) 판단해 사이 판을 빠뜨린다
 * 3. 저장 판을 목록에서 못 찾았는데 짐작으로 이어 간다
 * 4. 일부만 반영하고 멈춘 법령이 "확인 성공"으로 보이거나, 경합이 실패로 보인다
 */
const LID = '990143';
const item = (mst: string, day: string, extra: Record<string, unknown> = {}) => ({
  mst, lawId: LID, title: '시험법', shortTitle: null, lawType: '법률', revisionType: '일부개정', ministry: null,
  promulgationDate: day, promulgationNo: mst.slice(-3), effectiveDate: day, status: '연혁', ...extra,
});
const page = (items: ReturnType<typeof item>[], o: { display?: number; total?: number; page?: number } = {}) => ({
  total: o.total ?? items.length, page: o.page ?? 1, display: o.display ?? 100, items,
});
const law = (over: Partial<{ externalId: string; lawName: string; promulgatedDate: Date | null }> = {}) => ({
  id: 'law-1', lawName: '시험법', externalId: '900100', externalLawId: LID, promulgatedDate: new Date('2026-01-01T00:00:00Z'), ...over,
});

/** 판 목록만 있는 가짜 — 법령명 검색(search)이 없으므로 부르면 터진다 */
function fakeLawGoKr(pages: Record<string, ReturnType<typeof page>[]>) {
  const calls: [string, number][] = [];
  const lawGoKr: any = {
    searchVersions: (lawId: string, p: number) => {
      calls.push([lawId, p]);
      return Promise.resolve(pages[lawId]?.[p - 1] ?? page([]));
    },
    getLaw: () => Promise.reject(new Error('부르면 안 된다')),
  };
  return { lawGoKr, calls };
}

describe('planLawVersions — 판 목록 받기·점검 (T-151)', () => {
  it('저장 판 뒤에 공포된 판을 공포 순으로 — 법령ID 로 한 번 받고, 아무것도 쓰지 않는다', async () => {
    const { lawGoKr, calls } = fakeLawGoKr({
      [LID]: [page([item('900300', '2026-03-01'), item('900200', '2026-02-01', { status: '현행' }), item('900100', '2026-01-01')])],
    });
    const p = await planLawVersions({ prisma: {} as any, lawGoKr }, law());
    expect(calls).toEqual([[LID, 1]]);
    expect(p.stored.mst).toBe('900100');
    expect(p.current?.mst).toBe('900200');
    expect(p.pending.map((v) => v.mst)).toEqual(['900200', '900300']);
  });

  it('제명이 바뀐 판도 같은 법령ID 라 빠지지 않는다 — 이름이 겹치는 다른 법령의 판은 버린다', async () => {
    const { lawGoKr } = fakeLawGoKr({
      [LID]: [
        page([
          item('900300', '2026-03-01', { title: '새시험법' }),
          item('800000', '2026-02-15', { lawId: '000001', title: '시험법 시행령' }),
          item('900200', '2026-02-01'),
          item('900100', '2026-01-01'),
        ]),
      ],
    });
    const p = await planLawVersions({ prisma: {} as any, lawGoKr }, law());
    expect(p.pending.map((v) => [v.mst, v.title])).toEqual([
      ['900200', '시험법'],
      ['900300', '새시험법'],
    ]);
    expect(p.current).toBeNull(); // 목록에 현행 표시가 없으면 없다고 둔다
  });

  it('뒤에 쪽이 더 있고 그 쪽의 가장 오래된 행이 기준 공포일보다 늦으면 다음 쪽을 받는다', async () => {
    const { lawGoKr, calls } = fakeLawGoKr({
      [LID]: [
        page([item('900300', '2026-03-01'), item('900200', '2026-02-01')], { display: 2, total: 3 }),
        page([item('900100', '2026-01-01')], { display: 2, total: 3, page: 2 }),
      ],
    });
    const p = await planLawVersions({ prisma: {} as any, lawGoKr }, law());
    expect(calls).toEqual([
      [LID, 1],
      [LID, 2],
    ]);
    expect(p.pending.map((v) => v.mst)).toEqual(['900200', '900300']);
  });

  it('쪽이 덜 차 와도 전체 건수가 남았으면 다음 쪽을 받는다 — 행 수로 마지막 쪽을 짐작하지 않는다', async () => {
    const { lawGoKr, calls } = fakeLawGoKr({
      [LID]: [
        page([item('900300', '2026-03-01')], { display: 2, total: 3 }),
        page([item('900200', '2026-02-01'), item('900100', '2026-01-01')], { display: 2, total: 3, page: 2 }),
      ],
    });
    const p = await planLawVersions({ prisma: {} as any, lawGoKr }, law());
    expect(calls).toHaveLength(2);
    expect(p.pending.map((v) => v.mst)).toEqual(['900200', '900300']);
  });

  it('쪽 넘김 기준은 목록 안 저장 판의 공포일 — 법령 행의 공포일(DB)이 더 늦어도 저장 판 행이 있는 쪽까지 받는다', async () => {
    const { lawGoKr, calls } = fakeLawGoKr({
      [LID]: [
        page([item('900300', '2026-03-01'), item('900200', '2026-02-01')], { display: 2, total: 3 }),
        page([item('900100', '2026-01-01')], { display: 2, total: 3, page: 2 }),
      ],
    });
    const p = await planLawVersions({ prisma: {} as any, lawGoKr }, law({ promulgatedDate: new Date('2026-03-01T00:00:00Z') }));
    expect(calls).toHaveLength(2);
    expect(p.pending.map((v) => v.mst)).toEqual(['900200', '900300']);
  });

  it(`${MAX_VERSION_LIST_PAGES}쪽을 넘으면 일부 목록으로 판단하지 않고 실패한다 — 저장 판을 못 봤으면 그렇다고 알린다`, async () => {
    const notSeen = fakeLawGoKr({ [LID]: Array.from({ length: 12 }, () => page([item('900300', '2026-03-01')], { display: 1, total: 1000 })) });
    await expect(planLawVersions({ prisma: {} as any, lawGoKr: notSeen.lawGoKr }, law())).rejects.toThrow(/저장된 판\(MST 900100\)을 법제처 판 목록 10쪽 안에서 찾지 못했습니다/);
    // 저장 판과 같은 날 판이 쪽마다 이어지면(저장 판은 봤다) 목록이 길어서다
    const sameDay = fakeLawGoKr({ [LID]: Array.from({ length: 12 }, () => page([item('900100', '2026-01-01')], { display: 1, total: 1000 })) });
    await expect(planLawVersions({ prisma: {} as any, lawGoKr: sameDay.lawGoKr }, law())).rejects.toThrow(/10쪽을 넘습니다\(법령ID 990143\)/);
  });

  it('쪽마다 전체 건수가 다르면(받는 사이 목록이 바뀜) 실패한다 — 쪽 경계의 행이 밀려 빠질 수 있다', async () => {
    const { lawGoKr } = fakeLawGoKr({
      [LID]: [
        page([item('900300', '2026-03-01'), item('900200', '2026-02-01')], { display: 2, total: 3 }),
        page([item('900100', '2026-01-01')], { display: 2, total: 4, page: 2 }),
      ],
    });
    await expect(planLawVersions({ prisma: {} as any, lawGoKr }, law())).rejects.toThrow(/받는 사이 바뀌었습니다\(법령ID 990143, 3 → 4건\)/);
  });

  it('저장 판을 목록에서 못 찾으면 실패 — 사이 판이 빠지지 않았다고 확인할 수 없다', async () => {
    const { lawGoKr } = fakeLawGoKr({ [LID]: [page([item('900200', '2026-02-01')])] });
    await expect(planLawVersions({ prisma: {} as any, lawGoKr }, law())).rejects.toThrow(/저장된 판\(MST 900100\)을 법제처 판 목록에서 찾지 못했습니다/);
  });

  it('MST 가 빈 행 — 저장 판의 공포일보다 앞이면 넘어가고, 뒤면 사이 판이 빠졌을 수 있어 실패한다', async () => {
    const old = fakeLawGoKr({ [LID]: [page([item('900200', '2026-02-01'), item('900100', '2026-01-01'), item('', '2025-06-01')])] });
    const p = await planLawVersions({ prisma: {} as any, lawGoKr: old.lawGoKr }, law()); // 저장 판 공포일 2026-01-01
    expect(p.pending.map((v) => v.mst)).toEqual(['900200']);
    const between = fakeLawGoKr({ [LID]: [page([item('900200', '2026-02-01'), item('', '2026-01-15'), item('900100', '2026-01-01')])] });
    await expect(planLawVersions({ prisma: {} as any, lawGoKr: between.lawGoKr }, law())).rejects.toThrow(/법령ID·MST 가 빈 행이 있습니다\(공포일 2026-01-15\)/);
  });

  it('빈 행을 가르는 기준일은 목록 안 저장 판의 공포일 — 법령 행의 공포일(DB)이 비어 있어도 옛 빈 행에 막히지 않는다', async () => {
    const { lawGoKr } = fakeLawGoKr({ [LID]: [page([item('900200', '2026-02-01'), item('900100', '2026-01-01'), item('', '2025-06-01')])] });
    const p = await planLawVersions({ prisma: {} as any, lawGoKr }, law({ promulgatedDate: null }));
    expect(p.pending.map((v) => v.mst)).toEqual(['900200']);
  });

  it('같은 판의 공포일이 서로 다르면 목록을 믿지 않는다', async () => {
    const { lawGoKr } = fakeLawGoKr({ [LID]: [page([item('900100', '2026-01-01'), item('900100', '2026-01-02')])] });
    await expect(planLawVersions({ prisma: {} as any, lawGoKr }, law())).rejects.toThrow(/공포일·공포번호가 서로 다릅니다/);
  });
});

describe('walkLawVersions — 본문이 판 목록과 맞는지 (T-151)', () => {
  const body = (o: { 공포일자?: string; 법령ID?: string }) =>
    mapLawDetail(
      {
        기본정보: { 법령ID: o.법령ID ?? LID, 법령명_한글: '시험법', 공포일자: o.공포일자 ?? '20260201', 시행일자: '20260301' },
        조문: { 조문단위: [{ 조문번호: '1', 조문여부: '조문', 조문내용: '제1조(목적) 본문' }] },
      },
      '900200',
    );
  const deps = (b: ReturnType<typeof body>) => {
    const applied: string[] = [];
    const { lawGoKr } = fakeLawGoKr({ [LID]: [page([item('900200', '2026-02-01'), item('900100', '2026-01-01', { status: '현행' })])] });
    lawGoKr.getLaw = () => Promise.resolve(b);
    const prisma: any = {
      lawVersion: { upsert: () => Promise.resolve({ id: 'v', orderKey: 'k', stageEffectiveDates: [new Date()], revisionType: 'x' }), update: () => Promise.resolve({}) },
      // 판 반영 트랜잭션까지 오면 안 된다 — 오면 기록한다
      $transaction: () => (applied.push('tx'), Promise.resolve({ events: 0, versionId: 'x' })),
    };
    return { deps: { prisma, lawGoKr }, applied };
  };

  it('본문의 공포일이 판 목록과 다르면 반영하지 않고 멈춘다(다른 판을 받은 것)', async () => {
    const { deps: d, applied } = deps(body({ 공포일자: '20260202' }));
    const { outcome } = await walkLawVersions(d, law(), { cap: 5 });
    expect(outcome?.stop).toMatchObject({ kind: 'failed', mst: '900200' });
    expect((outcome?.stop as any).message).toContain('공포일(2026-02-02)이 판 목록(2026-02-01)과 다릅니다');
    expect(applied).toEqual([]);
  });

  it('본문의 법령ID 가 다르면 멈춘다 — 법령ID 가 비어 있으면 견주지 않는다', async () => {
    const other = deps(body({ 법령ID: '000001' }));
    const r = await walkLawVersions(other.deps, law(), { cap: 5 });
    expect((r.outcome?.stop as any).message).toContain('법령ID(000001)가 이 법령');
    expect(other.applied).toEqual([]);
    const empty = deps(body({ 법령ID: '' }));
    await walkLawVersions(empty.deps, law(), { cap: 5 });
    expect(empty.applied).toEqual(['tx']); // 비교 없이 반영으로 간다
  });
});

describe('ensureStoredVersionRow — 저장 판의 기록 (T-151)', () => {
  const stored: LawVersionEntry = { mst: '900100', lawId: LID, title: '시험법', promulgationDate: '2026-01-01', promulgationNo: '100', revisionType: '일부개정', stageEffectiveDates: ['2026-01-01', '2026-07-01'] };

  function prisma(row: { orderKey: string | null; stageEffectiveDates: Date[]; revisionType: string | null }) {
    const calls: any[] = [];
    return {
      calls,
      p: {
        lawVersion: {
          upsert: (a: any) => (calls.push(['upsert', a]), Promise.resolve({ id: 'v', ...row })),
          update: (a: any) => (calls.push(['update', a]), Promise.resolve({})),
        },
      } as any,
    };
  }

  it('없으면 기준판으로 만든다(이벤트 없음) — 순서 키·단계 시행일 포함', async () => {
    const { p, calls } = prisma({ orderKey: 'k', stageEffectiveDates: [new Date()], revisionType: 'x' });
    await ensureStoredVersionRow(p, 'law-1', stored, 'poll');
    expect(calls[0][1].create).toMatchObject({ mst: '900100', kind: 'baseline', orderKey: '20260101' + '0000000100' + '000000900100', receivedVia: 'poll' });
    expect(calls[0][1].create.stageEffectiveDates).toEqual([new Date('2026-01-01T00:00:00Z'), new Date('2026-07-01T00:00:00Z')]);
    expect(calls[0][1].update).toEqual({});
    expect(calls).toHaveLength(1); // 이미 다 찬 행이면 고치지 않는다
  });

  it('마이그레이션이 옮겨 적은 기준판(순서 키·단계·제개정구분이 빔)은 목록 값으로 채운다', async () => {
    const { p, calls } = prisma({ orderKey: null, stageEffectiveDates: [], revisionType: null });
    await ensureStoredVersionRow(p, 'law-1', stored, 'poll');
    expect(calls[1]).toEqual([
      'update',
      {
        where: { id: 'v' },
        data: { orderKey: '20260101' + '0000000100' + '000000900100', stageEffectiveDates: [new Date('2026-01-01T00:00:00Z'), new Date('2026-07-01T00:00:00Z')], revisionType: '일부개정' },
      },
    ]);
  });
});

describe('walkResult — 판 걷기 결과와 확인 시각 (T-151)', () => {
  const base = { lawId: 'law-1', lawName: '시험법', fromMst: '900100' };
  const e = (mst: string): LawVersionEntry => ({ mst, lawId: LID, title: '시험법', promulgationDate: '2026-02-01', promulgationNo: '200', revisionType: '일부개정', stageEffectiveDates: ['2026-03-01'] });

  it('모두 반영 → updated, 확인 시각을 찍는다. 판별 요약과 이벤트 합계', () => {
    const r = walkResult(base, { applied: [{ entry: e('900200'), events: 3 }, { entry: e('900300'), events: 0 }], lastMst: '900300', remaining: 0 });
    expect(r.mark).toBe('checked');
    expect(r.result).toMatchObject({ outcome: 'updated', toMst: '900300', events: 3 });
    expect(r.result.versions).toEqual([
      { mst: '900200', label: '제200호(2026-02-01 공포)', promulgationDate: '2026-02-01', revisionType: '일부개정', stageEffectiveDates: ['2026-03-01'], events: 3 },
      { mst: '900300', label: '제200호(2026-02-01 공포)', promulgationDate: '2026-02-01', revisionType: '일부개정', stageEffectiveDates: ['2026-03-01'], events: 0 },
    ]);
  });

  it('상한·시간으로 판이 남음 → 오류만 지우고 확인 시각은 그대로(다음 실행 앞에 선다), 남은 수와 안내', () => {
    const r = walkResult(base, { applied: [{ entry: e('900200'), events: 1 }], lastMst: '900200', stop: { kind: 'cap' }, remaining: 2 });
    expect(r.mark).toBe('clearError');
    expect(r.result).toMatchObject({ outcome: 'updated', toMst: '900200', remaining: 2 });
    expect(r.result.note).toContain('판 2개가 남았습니다');
    const none = walkResult(base, { applied: [], lastMst: '900100', stop: { kind: 'deadline' }, remaining: 3 });
    expect(none.result).toMatchObject({ outcome: 'unchanged', events: 0 });
    expect(none.result).not.toHaveProperty('toMst');
  });

  it('경합 → 실패로 세지 않고 아무것도 쓰지 않는다', () => {
    const r = walkResult(base, { applied: [], lastMst: '900100', stop: { kind: 'race', mst: '900200', message: '다른 경로' }, remaining: 1 });
    expect(r.mark).toBe('none');
    expect(r.result.outcome).toBe('unchanged');
    expect(r.result.note).toContain('다른 경로가 먼저');
  });

  it('앞 판을 반영한 뒤 경합 → 반영한 판은 결과에 남기고 오류만 지운다(법령은 이미 앞으로 갔다 — 어제의 오류로 실패처럼 보이지 않게)', () => {
    const r = walkResult(base, { applied: [{ entry: e('900200'), events: 1 }], lastMst: '900200', stop: { kind: 'race', mst: '900300', message: '다른 경로' }, remaining: 1 });
    expect(r.mark).toBe('clearError');
    expect(r.result).toMatchObject({ outcome: 'updated', toMst: '900200', events: 1, remaining: 1 });
    expect(r.result.note).toContain('다른 경로가 먼저');
  });

  it('실패 → failed, 반영한 판까지 함께 남기고 오류에 멈춘 판과 반영 범위를 적는다', () => {
    const r = walkResult(base, { applied: [{ entry: e('900200'), events: 2 }], lastMst: '900200', stop: { kind: 'failed', mst: '900300', message: '조문이 없어' }, remaining: 1 });
    expect(r.mark).toBe('error');
    expect(r.result).toMatchObject({ outcome: 'failed', toMst: '900200', events: 2, remaining: 1 });
    expect(r.result.error).toBe('MST 900300 반영 실패(900200까지 반영했습니다): 조문이 없어');
  });

  it('폐지 판 → failed, 사람이 할 일(추적 해제 검토)을 적는다', () => {
    const r = walkResult(base, { applied: [], lastMst: '900100', stop: { kind: 'repeal', mst: '900200' }, remaining: 1 });
    expect(r.mark).toBe('error');
    expect(r.result.error).toContain('폐지 판(MST 900200)');
    expect(r.result.error).toContain('추적 해제를 검토하세요');
  });
});
