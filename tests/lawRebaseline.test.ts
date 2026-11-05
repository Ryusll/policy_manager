import { describe, it, expect } from 'vitest';
import { applyRebaseline, planRebaseline } from '../apps/api/src/laws/law-rebaseline';
import { mapLawDetail } from '../apps/api/src/lawgokr/lawgokr.mapper';

/**
 * 묻힌 법령 보정의 계획·적용 (T-150 ④·검토) — DB 없이 가짜 저장소로. 실제 DB 의 보정 흐름은 통합 시험(law-in-force.int.test.ts)이 본다.
 *
 * 막고 싶은 사고:
 * 1. 등록 때 이미 시행 중이던 판(단계 시행 판의 첫 단계가 지난 것 포함)을 묻힌 판으로 보고 되돌린다
 * 2. 등록 때 시행 중이던 앞 판이 등록일 세 해 전보다 옛것(개정이 뜸한 법령)이라 계획을 세우지 못한다
 * 3. 계획 뒤에 법령 행이 다른 판으로 옮겨졌거나 판·이벤트가 반영됐는데 되돌린다(같은 판이 두 번 들어간다)
 */
const LID = '001766';
const item = (mst: string, promulgationDate: string, effectiveDate: string, status = '연혁') => ({
  mst,
  lawId: LID,
  title: '시험법',
  shortTitle: null,
  lawType: '법률',
  revisionType: '일부개정',
  ministry: null,
  promulgationDate,
  promulgationNo: mst.slice(-3),
  effectiveDate,
  status,
});
type Item = ReturnType<typeof item>;

/** 법제처 판 목록 — 공포일 내림차순(`sort: 'ddes'`), 한 쪽에 display 건 */
function lawGoKr(rows: Item[], display = 100) {
  const pages: number[] = [];
  return {
    pages,
    searchVersions: (_lawId: string, page = 1) => {
      pages.push(page);
      return Promise.resolve({ page, display, total: rows.length, items: rows.slice((page - 1) * display, page * display) } as never);
    },
    getLaw: (mst: string) =>
      Promise.resolve(
        mapLawDetail(
          {
            기본정보: { 법령ID: LID, 법령명_한글: '시험법', 공포일자: '20210126', 시행일자: '20220127', 공포번호: '100' },
            조문: { 조문단위: [{ 조문번호: '1', 조문여부: '조문', 조문내용: `제1조(목적) ${mst} 본문` }] },
          },
          mst,
        ),
      ),
  };
}

type Holds = { links?: number; candidates?: number; published?: number };
function prisma(
  o: {
    storedMst: string;
    baselineMst?: string;
    createdAt?: string;
    changeVersions?: number;
    events?: number;
    claimed?: number;
    versionsAfterClaim?: number;
    eventsAfterClaim?: number;
    holds?: Holds;
    holdsAfterClaim?: Holds;
  },
) {
  const writes: string[] = [];
  const holdsOf = (h: Holds = {}) => ({
    lawLink: { count: () => Promise.resolve(h.links ?? 0) },
    amendmentCandidate: { count: () => Promise.resolve(h.candidates ?? 0) },
    articleVersion: { count: () => Promise.resolve(h.published ?? 0) },
  });
  const tx: any = {
    ...holdsOf(o.holdsAfterClaim ?? o.holds),
    law: {
      updateMany: () => (writes.push('law.updateMany'), Promise.resolve({ count: o.claimed ?? 1 })),
      update: () => (writes.push('law.update'), Promise.resolve({})),
    },
    lawVersion: {
      count: () => Promise.resolve(o.versionsAfterClaim ?? o.changeVersions ?? 0),
      deleteMany: () => (writes.push('lawVersion.deleteMany'), Promise.resolve({ count: 1 })),
      create: () => (writes.push('lawVersion.create'), Promise.resolve({})),
    },
    lawChangeEvent: {
      count: () => Promise.resolve(o.eventsAfterClaim ?? o.events ?? 0),
      deleteMany: () => (writes.push('lawChangeEvent.deleteMany'), Promise.resolve({ count: o.events ?? 0 })),
    },
    lawArticle: {
      findMany: () => Promise.resolve([]),
      upsert: () => (writes.push('lawArticle.upsert'), Promise.resolve({})),
      updateMany: () => Promise.resolve({ count: 0 }),
    },
    $queryRaw: () => Promise.resolve([]),
    $executeRaw: () => Promise.resolve(0),
  };
  const p: any = {
    ...holdsOf(o.holds),
    law: {
      findUnique: () =>
        Promise.resolve({
          id: 'law-1',
          lawName: '시험법',
          externalId: o.storedMst,
          externalLawId: LID,
          createdAt: new Date(o.createdAt ?? '2026-10-28T01:00:00Z'),
        }),
    },
    lawVersion: {
      count: () => Promise.resolve(o.changeVersions ?? 0),
      findFirst: () => Promise.resolve({ mst: o.baselineMst ?? o.storedMst }),
    },
    lawChangeEvent: { count: () => Promise.resolve(o.events ?? 0) },
    $transaction: (fn: (t: unknown) => unknown) => fn(tx),
  };
  return { p, writes };
}

describe('보정 계획 (T-150 ④)', () => {
  it('등록 때 첫 단계가 이미 시행 중이던 단계 시행 판은 묻힌 판이 아니다 — 본문 시행일이 뒤여도', async () => {
    const lg = lawGoKr([
      item('291447', '2026-04-28', '2027-10-28', '시행예정'),
      item('291447', '2026-04-28', '2027-04-28', '시행예정'),
      item('291447', '2026-04-28', '2026-10-27', '현행'),
      item('280000', '2025-01-01', '2025-03-01'),
    ]);
    const { p } = prisma({ storedMst: '291447' });
    await expect(planRebaseline({ prisma: p, lawGoKr: lg }, 'law-1')).resolves.toMatchObject({ kind: 'not_buried' });
  });

  it('시행 예정 판으로 등록됐으면 등록 때 시행 중이던 앞 판으로 되돌릴 계획 — 앞 판이 세 해보다 옛것이어도 찾는다(공포일 내림차순이라 기준일을 넘는 쪽까지 받으면 그 앞 판이 들어온다)', async () => {
    const rows = [
      item('300200', '2026-09-01', '2026-12-01', '시행예정'),
      item('300150', '2025-06-01', '2027-01-01', '시행예정'),
      item('228817', '2021-01-26', '2022-01-27', '현행'),
      item('200000', '2019-01-01', '2019-06-01'),
    ];
    const lg = lawGoKr(rows, 1);
    const { p } = prisma({ storedMst: '300200' });
    const plan = await planRebaseline({ prisma: p, lawGoKr: lg }, 'law-1');
    expect(plan).toMatchObject({ kind: 'plan', target: { mst: '228817' } });
    expect((plan as { replay: { mst: string }[] }).replay.map((v) => v.mst)).toEqual(['300150', '300200']);
    expect(lg.pages).toEqual([1, 2, 3]); // 등록일 세 해 전(2023-10-28)을 넘는 쪽(3쪽)까지만
  });

  it('저장 판이 목록에 없거나 동기화가 이미 판·이벤트를 반영했으면 손대지 않는다(blocked)', async () => {
    const lg = lawGoKr([item('300200', '2026-09-01', '2026-12-01', '시행예정'), item('228817', '2021-01-26', '2022-01-27', '현행')]);
    await expect(planRebaseline({ prisma: prisma({ storedMst: '999999' }).p, lawGoKr: lg }, 'law-1')).resolves.toMatchObject({ kind: 'blocked' });
    await expect(planRebaseline({ prisma: prisma({ storedMst: '300200', events: 3 }).p, lawGoKr: lg }, 'law-1')).resolves.toMatchObject({
      kind: 'blocked',
      reason: expect.stringContaining('이벤트 3건'),
    });
  });
});

describe('보정 적용 — 계획 뒤 바뀐 것이 있으면 되돌리지 않는다 (T-150 검토)', () => {
  const plan = async (lg: ReturnType<typeof lawGoKr>, p: unknown) => {
    const out = await planRebaseline({ prisma: p as never, lawGoKr: lg }, 'law-1');
    if (out.kind !== 'plan') throw new Error(`계획이 아니다: ${out.kind}`);
    return out;
  };
  const rows = [item('300200', '2026-09-01', '2026-12-01', '시행예정'), item('228817', '2021-01-26', '2022-01-27', '현행')];

  it('법령 행이 더는 계획한 판을 가리키지 않으면(동기화·다른 보정이 먼저 옮김) 아무것도 쓰지 않고 실패한다', async () => {
    const lg = lawGoKr(rows);
    const { p, writes } = prisma({ storedMst: '300200', claimed: 0 });
    await expect(applyRebaseline({ prisma: p, lawGoKr: lg }, await plan(lg, p))).rejects.toThrow('법령이 더는 계획한 판을 가리키지 않습니다');
    expect(writes).toEqual(['law.updateMany']);
  });

  it('계획 뒤에 이벤트가 반영됐으면 판 기록·본문을 건드리지 않고 실패한다(트랜잭션이 법령 행 옮기기도 되돌린다)', async () => {
    const lg = lawGoKr(rows);
    const { p, writes } = prisma({ storedMst: '300200', eventsAfterClaim: 2 });
    await expect(applyRebaseline({ prisma: p, lawGoKr: lg }, await plan(lg, p))).rejects.toThrow('계획 뒤에 판·이벤트가 반영됐습니다');
    expect(writes).toEqual(['law.updateMany']);
  });
});

describe('먼저 공포된 판이 등록 때 시행 전이었던 법령 — 묻힌 판으로 잡고, 동기화가 걸었으면 다시 걸기 (T-150 검토)', () => {
  // 근로기준법(운영): 등록한 판 285279(04-07 공포)보다 먼저 공포된 제21472호(03-17 공포, 2027-01-01 시행)가 등록 때 시행 전 — 본문에 묻혔다
  const rows = [
    item('300900', '2026-08-04', '2026-10-02', '현행'),
    item('300800', '2026-06-09', '2026-12-10', '시행예정'),
    item('285279', '2026-04-07', '2026-04-07'),
    item('284443', '2026-03-17', '2027-01-01', '시행예정'),
    item('283457', '2026-02-10', '2026-02-10'),
    item('270000', '2025-01-01', '2025-01-01'),
  ];

  it('등록한 판이 그때 시행 중이었어도 먼저 공포된 판이 시행 전이었으면 묻혔다 — 그 판의 바로 앞 판으로 되돌릴 계획', async () => {
    const { p } = prisma({ storedMst: '285279' });
    const plan = await planRebaseline({ prisma: p, lawGoKr: lawGoKr(rows) }, 'law-1');
    expect(plan).toMatchObject({ kind: 'plan', baselineMst: '285279', target: { mst: '283457' }, reset: null });
    const ok = plan as Extract<typeof plan, { kind: 'plan' }>;
    expect(ok.buried.map((v) => v.mst)).toEqual(['284443']);
    expect(ok.replay.map((v) => v.mst)).toEqual(['284443', '285279']);
  });

  it('동기화가 이미 뒤 판을 반영했으면 기본으로는 막고(--reset 안내), 다시 걸기는 연결·후보·발행 판이 없을 때만 계획한다', async () => {
    const walked = { storedMst: '300900', baselineMst: '285279', changeVersions: 2, events: 38 };
    const lg = lawGoKr(rows);
    const blocked = await planRebaseline({ prisma: prisma(walked).p, lawGoKr: lg }, 'law-1');
    expect(blocked).toMatchObject({ kind: 'blocked', reason: expect.stringContaining('--reset') });

    const plan = await planRebaseline({ prisma: prisma(walked).p, lawGoKr: lg }, 'law-1', { reset: true });
    expect(plan).toMatchObject({ kind: 'plan', stored: { mst: '300900' }, target: { mst: '283457' }, reset: { versions: 2, events: 38 } });
    expect((plan as Extract<typeof plan, { kind: 'plan' }>).replay.map((v) => v.mst)).toEqual(['284443', '285279', '300800', '300900']);

    for (const holds of [{ links: 1 }, { candidates: 2 }, { published: 1 }]) {
      const held = await planRebaseline({ prisma: prisma({ ...walked, holds }).p, lawGoKr: lg }, 'law-1', { reset: true });
      expect(held, JSON.stringify(holds)).toMatchObject({ kind: 'blocked', reason: expect.stringMatching(/연결 1건|개정 후보 2건|발행한 조문 판 1개/) });
    }
  });

  it('다시 걸기 적용은 그 법령의 이벤트와 판 기록을 지우고 앞 판을 기준판으로 쓴다 — 계획 뒤에 이벤트가 늘었거나 연결이 생겼으면 아무것도 지우지 않는다', async () => {
    const walked = { storedMst: '300900', baselineMst: '285279', changeVersions: 2, events: 38 };
    const lg = lawGoKr(rows);
    const plan = async (o: Record<string, unknown> = {}) => {
      const { p, writes } = prisma({ ...walked, ...o });
      const out = await planRebaseline({ prisma: p, lawGoKr: lg }, 'law-1', { reset: true });
      if (out.kind !== 'plan') throw new Error(`계획이 아니다: ${out.kind}`);
      return { p, writes, out };
    };
    const ok = await plan();
    await expect(applyRebaseline({ prisma: ok.p, lawGoKr: lg }, ok.out)).resolves.toMatchObject({ deletedEvents: 38, lateHolds: null });
    expect(ok.writes.slice(0, 4)).toEqual(['law.updateMany', 'lawChangeEvent.deleteMany', 'lawVersion.deleteMany', 'lawVersion.create']);

    const more = await plan({ eventsAfterClaim: 40 });
    await expect(applyRebaseline({ prisma: more.p, lawGoKr: lg }, more.out)).rejects.toThrow('계획 뒤에 판·이벤트가 바뀌었습니다');
    expect(more.writes).toEqual(['law.updateMany']);

    // 다시 걸기는 연결 만들기를 잠그지 않는다(행 잠금 규칙) — 커밋 뒤에 다시 세어 그 틈에 생긴 연결을 알린다 (T-150 마지막 검토)
    const late = await plan();
    late.p.lawLink.count = () => Promise.resolve(1);
    await expect(applyRebaseline({ prisma: late.p, lawGoKr: lg }, late.out)).resolves.toMatchObject({ deletedEvents: 38, lateHolds: '연결 1건' });

    // 다시 세기가 실패해도 적용은 커밋됐다 — 실패로 읽히지 않게 경고로 (T-150 마지막 검토)
    const broken = await plan();
    broken.p.lawLink.count = () => Promise.reject(new Error('연결 끊김'));
    await expect(applyRebaseline({ prisma: broken.p, lawGoKr: lg }, broken.out)).resolves.toMatchObject({ deletedEvents: 38, lateHolds: expect.stringContaining('직접 확인') });

    const linked = await plan({ holdsAfterClaim: { links: 1 } });
    await expect(applyRebaseline({ prisma: linked.p, lawGoKr: lg }, linked.out)).rejects.toThrow('연결 1건');
    expect(linked.writes).toEqual(['law.updateMany']);
  });
});
