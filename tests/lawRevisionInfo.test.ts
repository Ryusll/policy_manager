import { describe, it, expect, vi } from 'vitest';
import { BadGatewayException, ServiceUnavailableException } from '@nestjs/common';
import { bodyMatchesVersion, fillRevisionInfo, revisionInfoFields, revisionInfoNote } from '../apps/api/src/laws/law-revision-info';

/**
 * 법제처 개정 정보 (T-152) — 제개정이유·개정문은 판 행, 약칭은 법령 행. 판 행을 만드는 곳은 revisionInfoFields 로 칸을 채우고,
 * 이미 등록된 법령은 주기 동기화가 법령마다 끝에서 fillRevisionInfo 로 이벤트 없이 채운다(동기화 분기별 연결은 lawSyncEffectiveNotes.test).
 *
 * 막고 싶은 사고:
 * 1. 법제처가 준 이유를 버리거나, 주지 않은 값을 빈 문자열로 남긴다
 * 2. 다른 판 본문의 이유를 이 판의 근거로 남긴다
 * 3. 한 번 읽은 판을 동기화마다 다시 부르거나, 다른 경로가 쓴 값을 덮어쓴다
 * 4. 조회 실패가 동기화를 깨뜨린다(법령은 '개정 없음'이 맞다 — note 로만 알린다)
 * 5. 계속 실패하는 판이 뒤 판을 막거나, 법제처 장애 때 판마다 응답 제한을 기다린다
 */
const meta = (o: Partial<Record<'lawId' | 'promulgationDate' | 'revisionReason' | 'amendmentText' | 'shortTitle' | 'lawType', string | null>> = {}) => ({
  lawId: '990143',
  promulgationDate: '2026-02-01',
  revisionReason: '[일부개정]\n◇ 개정이유',
  amendmentText: '국회에서 의결된 시험법 일부개정법률을 공포한다.',
  shortTitle: '시험약칭법',
  lawType: '법률',
  ...o,
});
const day = (s: string) => new Date(`${s}T00:00:00Z`);

describe('판 행 칸 (T-152)', () => {
  it('제개정이유·개정문을 그대로, 법제처가 주지 않은 값은 null 로 두고 읽은 시각은 늘 찍는다', () => {
    const now = new Date('2026-11-08T03:00:00Z');
    expect(revisionInfoFields(meta(), now)).toEqual({ revisionReason: '[일부개정]\n◇ 개정이유', amendmentText: '국회에서 의결된 시험법 일부개정법률을 공포한다.', revisionInfoAt: now });
    expect(revisionInfoFields(meta({ revisionReason: null, amendmentText: null }), now)).toEqual({ revisionReason: null, amendmentText: null, revisionInfoAt: now });
  });

  it('본문의 법령ID·공포일이 판과 다르면 그 판의 것이 아니다 — 값이 빠진 쪽은 견주지 않는다', () => {
    const v = { promulgatedDate: day('2026-02-01') };
    const law = { externalLawId: '990143' };
    expect(bodyMatchesVersion(meta(), v, law)).toBe(true);
    expect(bodyMatchesVersion(meta({ lawId: '990999' }), v, law)).toBe(false);
    expect(bodyMatchesVersion(meta({ promulgationDate: '2026-03-01' }), v, law)).toBe(false);
    expect(bodyMatchesVersion(meta({ lawId: null, promulgationDate: null }), v, law)).toBe(true);
    expect(bodyMatchesVersion(meta(), { promulgatedDate: null }, { externalLawId: null })).toBe(true);
  });
});

describe('동기화가 이벤트 없이 채운다 (T-152)', () => {
  const LAW = { id: 'law-1', externalId: '900200', externalLawId: '990143' };
  const rows = [
    { id: 'v2', mst: '900200', promulgatedDate: day('2026-02-01'), lawType: null },
    { id: 'v1', mst: '900100', promulgatedDate: day('2026-01-01'), lawType: '법률' },
  ];
  const setup = (o: { rows?: typeof rows; bodies?: Record<string, ReturnType<typeof meta>>; failOn?: string; failWith?: Error; left?: number } = {}) => {
    const prisma = {
      lawVersion: {
        findMany: vi.fn((a: { take: number }) => Promise.resolve((o.rows ?? rows).slice(0, a.take))),
        updateMany: vi.fn((_a: { where: unknown; data: Record<string, unknown> }) => Promise.resolve({ count: 1 })),
        count: vi.fn(() => Promise.resolve(o.left ?? 0)),
      },
      law: { updateMany: vi.fn(() => Promise.resolve({ count: 1 })) },
    };
    const bodies = o.bodies ?? { '900200': meta(), '900100': meta({ promulgationDate: '2026-01-01', revisionReason: null, shortTitle: '옛약칭' }) };
    const lawGoKr = {
      getLaw: vi.fn((mst: string) => (mst === o.failOn ? Promise.reject(o.failWith ?? new Error('법제처 응답 오류')) : Promise.resolve({ meta: bodies[mst], tree: { roots: [] } }))),
    };
    return { prisma, lawGoKr };
  };
  const writes = (prisma: ReturnType<typeof setup>['prisma']) => prisma.lawVersion.updateMany.mock.calls.map((c) => c[0]);

  it('아직 읽지 않은 판만, 실패한 적 없는 판부터 공포 순 최근부터 고르고(시도는 상한의 두 배까지), 판 행은 아직 읽지 않았을 때만 쓴다', async () => {
    const { prisma, lawGoKr } = setup();
    const r = await fillRevisionInfo(prisma as never, lawGoKr as never, LAW, { max: 5 });
    expect(r).toEqual({ filled: 2, mismatched: [], failed: [], remaining: null });
    expect(prisma.lawVersion.findMany).toHaveBeenCalledWith({
      where: { lawId: 'law-1', revisionInfoAt: null },
      select: { id: true, mst: true, promulgatedDate: true, lawType: true },
      // 실패한 판은 뒤로(오래전에 실패한 것부터) — 계속 실패하는 판이 맨 앞에서 뒤 판을 막지 않게
      orderBy: [{ revisionInfoTriedAt: { sort: 'asc', nulls: 'first' } }, { orderKey: { sort: 'desc', nulls: 'last' } }],
      take: 10,
    });
    expect(prisma.lawVersion.count).not.toHaveBeenCalled(); // 다 봤으면 남은 판을 세지 않는다
    const [first, second] = writes(prisma);
    expect(first.where).toEqual({ id: 'v2', revisionInfoAt: null });
    expect(first.data).toMatchObject({ revisionReason: '[일부개정]\n◇ 개정이유', lawType: '법률' }); // 빈 법종도 채운다(판 표기)
    expect(first.data.revisionInfoAt).toBeInstanceOf(Date);
    expect(second.data).toMatchObject({ revisionReason: null }); // 법제처가 주지 않은 판 — null 로 두고 읽은 시각은 찍는다
    expect(second.data).not.toHaveProperty('lawType'); // 이미 있는 법종은 건드리지 않는다
  });

  it('약칭은 저장 판의 본문으로만, 법령 행이 비어 있을 때만 채운다', async () => {
    const { prisma, lawGoKr } = setup();
    await fillRevisionInfo(prisma as never, lawGoKr as never, LAW, { max: 5 });
    expect(prisma.law.updateMany).toHaveBeenCalledTimes(1);
    expect(prisma.law.updateMany).toHaveBeenCalledWith({ where: { id: 'law-1', shortTitle: null }, data: { shortTitle: '시험약칭법' } });
  });

  it('본문이 다른 판의 것이면 채우지 않고 돌려준다(거부) — 그 판에는 실패 시각만 남긴다', async () => {
    const { prisma, lawGoKr } = setup({ bodies: { '900200': meta({ promulgationDate: '2026-05-05' }), '900100': meta({ lawId: '990999', promulgationDate: '2026-01-01' }) } });
    expect(await fillRevisionInfo(prisma as never, lawGoKr as never, LAW, { max: 5 })).toEqual({ filled: 0, mismatched: ['900200', '900100'], failed: [], remaining: null });
    const w = writes(prisma);
    expect(w.map((x) => x.where)).toEqual([
      { id: 'v2', revisionInfoAt: null },
      { id: 'v1', revisionInfoAt: null },
    ]);
    expect(w.map((x) => Object.keys(x.data))).toEqual([['revisionInfoTriedAt'], ['revisionInfoTriedAt']]); // 이유·읽은 시각은 쓰지 않는다
    expect(prisma.law.updateMany).not.toHaveBeenCalled();
  });

  it('읽을 판이 없으면 법제처를 부르지 않는다 — 한 번 읽은 판은 다시 부르지 않는다', async () => {
    const { prisma, lawGoKr } = setup({ rows: [] });
    expect(await fillRevisionInfo(prisma as never, lawGoKr as never, LAW, { max: 5 })).toEqual({ filled: 0, mismatched: [], failed: [], remaining: null });
    expect(lawGoKr.getLaw).not.toHaveBeenCalled();
  });

  it('본문을 못 받은 판(법제처 무응답이 아닌 실패)은 실패 시각을 남기고 건너뛰어 다음 판을 채운다 — 실패한 판을 돌려준다', async () => {
    const { prisma, lawGoKr } = setup({ failOn: '900200' });
    expect(await fillRevisionInfo(prisma as never, lawGoKr as never, LAW, { max: 5 })).toEqual({
      filled: 1,
      mismatched: [],
      failed: [{ mst: '900200', error: '법제처 응답 오류' }],
      remaining: null,
    });
    const [mark, fill] = writes(prisma);
    expect(mark).toEqual({ where: { id: 'v2', revisionInfoAt: null }, data: { revisionInfoTriedAt: expect.any(Date) } });
    expect(fill.where).toEqual({ id: 'v1', revisionInfoAt: null });
    expect(fill.data).toHaveProperty('revisionReason');
  });

  it('법제처가 응답하지 않으면(502·503) 이 법령은 거기서 멈춘다 — 장애 때 판마다 응답 제한을 기다리지 않게, 남은 판 수를 돌려준다', async () => {
    for (const failWith of [new BadGatewayException('법제처 API 호출에 실패했습니다: 응답 시간 초과(15000ms)'), new ServiceUnavailableException('법제처 API 인증에 실패했습니다')]) {
      const { prisma, lawGoKr } = setup({ failOn: '900200', failWith, left: 2 });
      expect(await fillRevisionInfo(prisma as never, lawGoKr as never, LAW, { max: 5 })).toEqual({
        filled: 0,
        mismatched: [],
        failed: [{ mst: '900200', error: failWith.message }],
        remaining: 2,
      });
      expect(lawGoKr.getLaw).toHaveBeenCalledTimes(1); // 900100 은 부르지 않는다
      expect(writes(prisma)).toEqual([{ where: { id: 'v2', revisionInfoAt: null }, data: { revisionInfoTriedAt: expect.any(Date) } }]);
    }
  });

  it('약칭을 먼저 쓰고 판 행(읽음 표지)은 마지막에 — 약칭 쓰기가 실패하면 그 판은 읽지 않은 채 남아 다음에 다시 본다(반쪽 저장 없이)', async () => {
    const { prisma, lawGoKr } = setup();
    prisma.law.updateMany.mockImplementationOnce(() => Promise.reject(new Error('DB 연결 끊김')));
    const r = await fillRevisionInfo(prisma as never, lawGoKr as never, LAW, { max: 5 });
    expect(r.failed).toEqual([{ mst: '900200', error: 'DB 연결 끊김' }]);
    expect(r.filled).toBe(1); // 900100 은 채운다
    const [mark, fill] = writes(prisma);
    expect(mark).toEqual({ where: { id: 'v2', revisionInfoAt: null }, data: { revisionInfoTriedAt: expect.any(Date) } }); // v2 는 읽음 표지 없이 실패 시각만
    expect(fill.where).toEqual({ id: 'v1', revisionInfoAt: null });
  });

  it('다른 판 본문인 판의 실패 시각을 못 남기면 실패에 따로 싣는다 — 다른 판 본문 목록에는 한 번만', async () => {
    const { prisma, lawGoKr } = setup({ bodies: { '900200': meta({ promulgationDate: '2026-05-05' }), '900100': meta({ promulgationDate: '2026-01-01' }) } });
    prisma.lawVersion.updateMany.mockImplementationOnce(() => Promise.reject(new Error('DB 연결 끊김')));
    const r = await fillRevisionInfo(prisma as never, lawGoKr as never, LAW, { max: 5 });
    expect(r.mismatched).toEqual(['900200']);
    expect(r.failed).toEqual([{ mst: '900200', error: '실패 시각을 남기지 못함: DB 연결 끊김' }]);
    expect(r.filled).toBe(1);
  });

  it('남은 판 수를 못 세도 판별 결과는 그대로 돌려주고 note 에 둘 다 싣는다(실패를 다른 실패로 바꾸지 않는다)', async () => {
    const failWith = new BadGatewayException('법제처 API 호출에 실패했습니다: 응답 시간 초과(15000ms)');
    const one = setup({ failOn: '900200', failWith });
    one.prisma.lawVersion.count.mockImplementationOnce(() => Promise.reject(new Error('DB 연결 끊김')));
    expect(await fillRevisionInfo(one.prisma as never, one.lawGoKr as never, LAW, { max: 5 })).toEqual({
      filled: 0,
      mismatched: [],
      failed: [{ mst: '900200', error: failWith.message }],
      remaining: null,
      remainingError: 'DB 연결 끊김',
    });
    const two = setup({ failOn: '900200', failWith });
    two.prisma.lawVersion.count.mockImplementationOnce(() => Promise.reject(new Error('DB 연결 끊김')));
    const note = await revisionInfoNote(two.prisma as never, two.lawGoKr as never, { ...LAW, lawName: '시험법' }, { max: 5 }, { log: vi.fn(), warn: vi.fn() });
    expect(note).toBe(
      `법제처 개정 정보를 채우지 못했습니다(다음 동기화에서 다시 시도): MST 900200 — ${failWith.message} 개정 정보를 아직 못 읽은 판 수를 세지 못했습니다(다음 동기화가 이어서 채웁니다): DB 연결 끊김`,
    );
  });

  it('실패 시각을 남기지 못하면 그 사실도 실패에 싣는다(삼키지 않는다)', async () => {
    const { prisma, lawGoKr } = setup({ failOn: '900200' });
    prisma.lawVersion.updateMany.mockImplementationOnce(() => Promise.reject(new Error('DB 연결 끊김')));
    const r = await fillRevisionInfo(prisma as never, lawGoKr as never, LAW, { max: 5 });
    expect(r.failed).toEqual([{ mst: '900200', error: '법제처 응답 오류 (실패 시각도 남기지 못함: DB 연결 끊김)' }]);
    expect(r.filled).toBe(1);
  });

  it('채우는 것은 max 판까지 — 계속 실패하는 판이 앞에 있어도 시도는 두 배까지 해서 그 뒤 판이 막히지 않는다', async () => {
    const four = [
      { id: 'f1', mst: '900400', promulgatedDate: day('2026-04-01'), lawType: '법률' },
      { id: 'f2', mst: '900300', promulgatedDate: day('2026-03-01'), lawType: '법률' },
      ...rows,
    ];
    const bodies = { '900200': meta(), '900100': meta({ promulgationDate: '2026-01-01' }) };
    const { prisma, lawGoKr } = setup({ rows: four, bodies, left: 3 });
    const r = await fillRevisionInfo(prisma as never, lawGoKr as never, LAW, { max: 2 });
    expect(r.filled).toBe(2);
    expect(r.failed.map((f) => f.mst)).toEqual(['900400', '900300']);
    expect(r.remaining).toBe(3); // 시도 창(상한의 두 배)이 찼다 — 그 뒤에도 판이 있을 수 있어 센다
    const once = setup({ rows: four, bodies });
    expect((await fillRevisionInfo(once.prisma as never, once.lawGoKr as never, LAW, { max: 1 })).filled).toBe(0); // 시도 2번이 둘 다 실패 — 다음에 다시
    // 다 성공하면 max 판에서 멈추고(시도 상한까지 가지 않는다) 남은 판 수를 돌려준다
    const capped = setup({ left: 1 });
    const c = await fillRevisionInfo(capped.prisma as never, capped.lawGoKr as never, LAW, { max: 1 });
    expect(c).toMatchObject({ filled: 1, remaining: 1 });
    expect(capped.lawGoKr.getLaw).toHaveBeenCalledTimes(1);
    expect(capped.prisma.lawVersion.count).toHaveBeenCalledWith({ where: { lawId: 'law-1', revisionInfoAt: null } });
  });

  it('실행 시간 상한을 넘겼으면 법제처를 더 부르지 않는다 — 남은 판은 다음 동기화가 잇는다', async () => {
    const { prisma, lawGoKr } = setup({ left: 2 });
    expect(await fillRevisionInfo(prisma as never, lawGoKr as never, LAW, { max: 5, deadline: Date.now() - 1 })).toEqual({ filled: 0, mismatched: [], failed: [], remaining: 2 });
    expect(lawGoKr.getLaw).not.toHaveBeenCalled();
  });

  it('동기화 결과 문구 — 채운 것은 로그만, 조회 실패·다른 판 본문·남은 판은 note 로(다음 동기화에서 다시 시도)', async () => {
    const log = { log: vi.fn(), warn: vi.fn() };
    const target = { ...LAW, lawName: '시험법' };
    const ok = setup();
    expect(await revisionInfoNote(ok.prisma as never, ok.lawGoKr as never, target, { max: 5 }, log)).toBeNull();
    expect(log.log).toHaveBeenCalledWith('법제처 개정 정보 2판을 채웠습니다 [시험법]');
    const failing = setup({ failOn: '900200' });
    expect(await revisionInfoNote(failing.prisma as never, failing.lawGoKr as never, target, { max: 5 }, log)).toBe(
      '법제처 개정 정보를 채우지 못했습니다(다음 동기화에서 다시 시도): MST 900200 — 법제처 응답 오류',
    );
    const other = setup({ rows: [rows[0]], bodies: { '900200': meta({ lawId: '990999' }) } });
    expect(await revisionInfoNote(other.prisma as never, other.lawGoKr as never, target, { max: 5 }, log)).toContain('판과 달라 개정 정보를 채우지 않았습니다(MST 900200)');
    // 판 목록 조회 같은 DB 오류도 동기화를 깨지 않고 note 로
    const db = setup();
    db.prisma.lawVersion.findMany.mockImplementation(() => Promise.reject(new Error('DB 연결 끊김')));
    expect(await revisionInfoNote(db.prisma as never, db.lawGoKr as never, target, { max: 5 }, log)).toBe('법제처 개정 정보를 채우지 못했습니다(다음 동기화에서 다시 시도): DB 연결 끊김');
    // 상한에서 멈춰 판이 남았으면 그 수를 알린다(판 걷기의 '판 N개가 남았습니다'처럼)
    const left = setup({ left: 3 });
    expect(await revisionInfoNote(left.prisma as never, left.lawGoKr as never, target, { max: 1 }, log)).toBe('개정 정보를 아직 못 읽은 판이 3개 남았습니다 — 다음 동기화가 이어서 채웁니다.');
  });
});
