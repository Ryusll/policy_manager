import { describe, it, expect } from 'vitest';
import { BadGatewayException } from '@nestjs/common';
import { LawSyncService } from '../apps/api/src/laws/law-sync.service';
import { mapLawDetail } from '../apps/api/src/lawgokr/lawgokr.mapper';
import { EFFECTIVE_NOTES_VERSION } from '../apps/api/src/common/effective-notes';

/**
 * 주기 동기화의 조별 시행일 표기 맞추기 연결 (T-144, PAT-06) — DB·법제처 없이 가짜로 `LawSyncService.run()` 을 돌린다.
 *
 * 지킬 것:
 * 1. 같은 판이고 법령의 읽기 판이 지금과 다르면 그 판을 한 번 읽어 맞춘다 — 결과는 "개정 없음" 그대로
 * 2. 읽기 판이 같으면 법제처 본문을 부르지 않는다
 * 3. 맞추다 실패해도 "개정 없음"이 맞다 — 실패는 결과 note 로 알리고 확인 오류(lastCheckError)로 만들지 않는다
 * 4. 새 판이면 맞추기를 따로 하지 않는다(새 판 저장이 이미 지금 규칙으로 쓴다)
 *
 * 같은 가짜로 법제처 개정 정보 채우기(T-152)가 어느 분기에서 도는지도 본다 — 채우기 자체는 lawRevisionInfo.test
 */

const MST = '900143';
const detail = () =>
  ({
    기본정보: { 시행일자: '20260101', 법령명_한글: '시험법', 공포일자: '20251201', 법령ID: '990143' },
    조문: {
      조문단위: [{ 조문번호: '5', 조문여부: '조문', 조문내용: '제5조(휴가) 본문', 조문참고자료: '[시행일: 2027.1.1] 제5조제1항' }],
    },
  }) as any;

type BlankVersion = { id: string; mst: string; promulgatedDate: Date | null; lawType: string | null };

type SetupOptions = {
  version: number | null;
  latest?: string;
  getLawFails?: boolean;
  /** 이 MST 본문만 실패 */
  failMst?: string;
  /** 실패할 때 던질 것(기본은 일반 오류) */
  getLawError?: Error;
  /** 개정 정보를 아직 읽지 않은 판(T-152) */
  blank?: BlankVersion[];
  /** 저장 판(MST) 본문의 법령명약칭 */
  baseShortTitle?: string;
};

function setup(opts: SetupOptions) {
  const calls = {
    getLaw: 0,
    infoReads: 0,
    infoWrites: 0,
    infoMarks: 0,
    shortTitleWrites: 0,
    collectClaims: 0,
    casClaims: 0,
    notesWrites: 0,
    versionUpserts: 0,
    markChecked: [] as any[],
    runUpdate: null as any,
  };
  /** 가짜 저장소 — 한 번 기록하고 값을 돌려준다 */
  const ok = <T>(value: T) => Promise.resolve(value);
  const prisma: any = {
    $executeRaw: () => ok(0),
    lawSyncRun: {
      updateMany: () => ok({ count: 0 }),
      findFirst: () => ok(null),
      create: () => ok({ id: 'run-1' }),
      update: (a: any) => {
        calls.runUpdate = a.data;
        return ok({ id: 'run-1', ...a.data });
      },
    },
    law: {
      findMany: () =>
        ok([
          {
            id: 'law-1',
            lawName: '시험법',
            externalId: MST,
            externalLawId: '990143',
            effectiveNotesVersion: opts.version,
            promulgatedDate: new Date('2025-12-01T00:00:00Z'),
          },
        ]),
      findUnique: () => ok({ effectiveNotesVersion: opts.version }),
      update: (a: any) => {
        if ('lastCheckedAt' in a.data) calls.markChecked.push(a.data);
        return ok({});
      },
      // 표기 채우기(T-144)는 OR 로 판을 보고, 판 반영(T-151)은 직전 MST 로 비교·교체한다. 개정 정보 채우기(T-152)는 빈 약칭만 채운다
      updateMany: (a: any) => {
        if ('shortTitle' in a.data) calls.shortTitleWrites += 1;
        else if (a.where.OR) calls.collectClaims += 1;
        else calls.casClaims += 1;
        return ok({ count: 1 });
      },
    },
    lawArticle: {
      findMany: () => ok([{ id: 'a5', nodeKey: '5//', content: '본문', versionKey: 'v1:x', effectiveNotes: null }]),
      upsert: () => ok({ id: 'a5' }),
      updateMany: (a: any) => {
        if (a.where?.id?.in) calls.notesWrites += a.where.id.in.length;
        return ok({ count: a.where?.id?.in?.length ?? 0 });
      },
    },
    lawChangeEvent: { createMany: (a: any) => ok({ count: a.data.length }) },
    lawVersion: {
      upsert: () => {
        calls.versionUpserts += 1;
        return ok({ id: 'ver-base', orderKey: 'x', stageEffectiveDates: [new Date()], revisionType: '일부개정' });
      },
      create: () => ok({ id: 'ver-1' }),
      update: () => ok({}),
      // 개정 정보 채우기(T-152) — 아직 읽지 않은 판(기본은 없음)과 그 판 행 쓰기
      findMany: () => {
        calls.infoReads += 1;
        return ok(opts.blank ?? []);
      },
      updateMany: (a: any) => {
        if ('revisionReason' in a.data) calls.infoWrites += 1;
        else calls.infoMarks += 1; // 읽지 못한 판의 실패 시각
        return ok({ count: 1 });
      },
      count: () => ok(opts.blank?.length ?? 0),
    },
  };
  prisma.$transaction = (fn: (tx: unknown) => Promise<unknown>) => fn(prisma);
  // 판 목록(T-151): 저장 판 하나, latest 를 주면 그 뒤에 공포된 판 하나
  const versionItem = (mst: string, day: string) => ({
    mst, lawId: '990143', title: '시험법', shortTitle: null, lawType: '법률', revisionType: '일부개정', ministry: null,
    promulgationDate: day, promulgationNo: mst === MST ? '100' : '200', effectiveDate: day, status: '현행',
  });
  const lawGoKr: any = {
    search: () => ok({ total: 1, page: 1, display: 100, items: [versionItem(MST, '2025-12-01')] }),
    searchVersions: () =>
      ok({ total: 2, page: 1, display: 100, items: [...(opts.latest ? [versionItem(opts.latest, '2026-02-01')] : []), versionItem(MST, '2025-12-01')] }),
    getCurrentTitleById: () => ok(null),
    getLaw: (mst: string) => {
      calls.getLaw += 1;
      if (opts.getLawFails || mst === opts.failMst) return Promise.reject(opts.getLawError ?? new Error('법제처 응답 오류'));
      const raw = mst === MST ? detail() : { ...detail(), 기본정보: { ...detail().기본정보, 공포일자: '20260201' } };
      if (mst === MST && opts.baseShortTitle) raw.기본정보 = { ...raw.기본정보, 법령명약칭: opts.baseShortTitle };
      return ok(mapLawDetail(raw, mst));
    },
  };
  const amendments: any = { processPendingEvents: () => ok({ created: 0 }) };
  return { service: new LawSyncService(prisma, lawGoKr, amendments), calls };
}

describe('LawSyncService — 조별 시행일 표기 맞추기 (T-144)', () => {
  it('같은 판이고 읽기 판이 없으면(T-144 이전 등록) 한 번 읽어 맞춘다 — 결과는 개정 없음, note 없음', async () => {
    const { service, calls } = setup({ version: null });
    const run = await service.run({ trigger: 'manual', limit: 1 });
    expect(run.results).toEqual([expect.objectContaining({ outcome: 'unchanged', lawId: 'law-1' })]);
    expect(run.results[0]).not.toHaveProperty('note');
    expect(calls.getLaw).toBe(1);
    expect(calls.collectClaims).toBe(1);
    expect(calls.notesWrites).toBe(1);
    expect(calls.casClaims).toBe(0); // 판을 반영하지 않았다
    expect(calls.versionUpserts).toBe(1); // 저장 판의 기록은 보장한다(T-151)
    expect(calls.markChecked).toEqual([expect.objectContaining({ lastCheckError: null })]);
  });

  it('읽기 판이 지금과 같으면 법제처 본문을 부르지 않는다', async () => {
    const { service, calls } = setup({ version: EFFECTIVE_NOTES_VERSION });
    const run = await service.run({ trigger: 'manual', limit: 1 });
    expect(run.results[0].outcome).toBe('unchanged');
    expect(calls.getLaw).toBe(0);
    expect(calls.collectClaims).toBe(0);
  });

  it('맞추다 실패해도 개정 없음 그대로 — 실패는 note 로 알리고 확인 오류로 만들지 않는다', async () => {
    const { service, calls } = setup({ version: null, getLawFails: true });
    const run = await service.run({ trigger: 'manual', limit: 1 });
    expect(run.results[0]).toMatchObject({ outcome: 'unchanged' });
    expect(run.results[0].note).toContain('조별 시행일 표기를 채우지 못했습니다');
    expect(run.results[0].note).toContain('법제처 응답 오류');
    expect(run.status).toBe('succeeded');
    expect(calls.markChecked).toEqual([expect.objectContaining({ lastCheckError: null })]);
  });

  it('새 판이면 맞추기를 따로 하지 않는다 — 판 반영(T-151)이 지금 규칙으로 쓴다', async () => {
    const { service, calls } = setup({ version: null, latest: '900200' });
    const run = await service.run({ trigger: 'manual', limit: 1 });
    expect(run.results[0]).toMatchObject({ outcome: 'updated', toMst: '900200' });
    expect(run.results[0].versions?.map((v) => v.mst)).toEqual(['900200']);
    expect(calls.casClaims).toBe(1);
    expect(calls.getLaw).toBe(1); // 새 판 본문 한 번 — 표기 채우기로 저장 판 본문을 따로 받지 않는다
    expect(calls.collectClaims).toBe(0);
    expect(calls.markChecked).toEqual([expect.objectContaining({ lastCheckError: null })]);
  });
});

describe('LawSyncService — 법제처 개정 정보 채우기의 자리 (T-152)', () => {
  const base: BlankVersion = { id: 'ver-base', mst: MST, promulgatedDate: new Date('2025-12-01T00:00:00Z'), lawType: '법률' };
  const older: BlankVersion = { id: 'ver-old', mst: '900100', promulgatedDate: new Date('2025-06-01T00:00:00Z'), lawType: '법률' };

  it("'개정 없음'이면 아직 읽지 않은 판을 이벤트 없이 채운다 — 저장 판 본문의 약칭도", async () => {
    const { service, calls } = setup({ version: EFFECTIVE_NOTES_VERSION, blank: [base], baseShortTitle: '시험약칭' });
    const run = await service.run({ trigger: 'manual', limit: 1 });
    expect(run.results[0].outcome).toBe('unchanged');
    expect(run.results[0].note).toBeUndefined();
    expect(calls.infoWrites).toBe(1);
    expect(calls.shortTitleWrites).toBe(1);
  });

  it('판을 반영한 동기화도 남은 옛 판을 채운다 — 약칭은 반영한 뒤의 저장 판 본문으로만(옛 판 본문의 약칭을 법령 행에 쓰지 않는다)', async () => {
    const { service, calls } = setup({ version: EFFECTIVE_NOTES_VERSION, latest: '900200', blank: [base], baseShortTitle: '옛약칭' });
    const run = await service.run({ trigger: 'manual', limit: 1 });
    expect(run.results[0]).toMatchObject({ outcome: 'updated', toMst: '900200' });
    expect(run.results[0].note).toBeUndefined();
    expect(calls.getLaw).toBe(2); // 새 판 본문 + 남은 옛 판 본문
    expect(calls.infoWrites).toBe(1);
    expect(calls.shortTitleWrites).toBe(0);
  });

  it('판 반영이 실패해도(늘 같은 판에서 멈추는 법령) 남은 옛 판을 채운다 — 건너뛰면 그 법령은 영영 빈다', async () => {
    const { service, calls } = setup({ version: EFFECTIVE_NOTES_VERSION, latest: '900200', failMst: '900200', blank: [base] });
    const run = await service.run({ trigger: 'manual', limit: 1 });
    expect(run.results[0].outcome).toBe('failed');
    expect(calls.getLaw).toBe(2); // 새 판 본문(실패) + 남은 옛 판 본문
    expect(calls.infoWrites).toBe(1);
    expect(run.results[0].note ?? '').not.toContain('개정 정보');
  });

  it('법제처가 응답하지 않으면(502) 채우기는 한 번 시도하고 멈춘다 — 판마다 응답 제한을 기다리지 않고, 남은 판은 note 로', async () => {
    const getLawError = new BadGatewayException('법제처 API 호출에 실패했습니다: 응답 시간 초과(15000ms)');
    const { service, calls } = setup({ version: EFFECTIVE_NOTES_VERSION, latest: '900200', getLawFails: true, getLawError, blank: [base, older] });
    const run = await service.run({ trigger: 'manual', limit: 1 });
    expect(run.results[0].outcome).toBe('failed');
    expect(calls.getLaw).toBe(2); // 새 판 본문 + 옛 판 하나 — 그다음 판(900100)은 부르지 않는다
    expect(calls.infoWrites).toBe(0);
    expect(calls.infoMarks).toBe(1); // 시도한 판은 실패 시각을 남겨 다음에 뒤로
    expect(run.results[0].note).toContain(`법제처 개정 정보를 채우지 못했습니다(다음 동기화에서 다시 시도): MST ${MST} — 법제처 API 호출에 실패했습니다`);
    expect(run.results[0].note).toContain('개정 정보를 아직 못 읽은 판이 2개 남았습니다');
  });
});
