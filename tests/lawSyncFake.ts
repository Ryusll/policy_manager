import { Prisma } from '@prisma/client';
import { LawSyncService } from '../apps/api/src/laws/law-sync.service';
import { mapLawDetail } from '../apps/api/src/lawgokr/lawgokr.mapper';
import { EFFECTIVE_NOTES_VERSION } from '../apps/api/src/common/effective-notes';

/**
 * 동기화 서비스를 DB·법제처 없이 돌리는 가짜(tests/lawSyncService.test.ts 에서 떼어 냄 — T-222 의 확인 실패 사유 시험도 쓴다).
 * 시험법(법령ID 990143)의 판 셋(900100 → 900200 → 900300)을 판 목록으로 주고, 저장 판은 900100 이다.
 */
export const LID = '990143';
const item = (mst: string, day: string) => ({
  mst, lawId: LID, title: '시험법', shortTitle: null, lawType: '법률', revisionType: '일부개정', ministry: null,
  promulgationDate: day, promulgationNo: mst.slice(-3), effectiveDate: day, status: '연혁',
});
const body = (mst: string, day: string, lawId: string | null = LID) =>
  mapLawDetail(
    {
      기본정보: { ...(lawId ? { 법령ID: lawId } : {}), 법령명_한글: '시험법', 공포일자: day.replace(/-/g, ''), 시행일자: day.replace(/-/g, '') },
      조문: { 조문단위: [{ 조문번호: '1', 조문여부: '조문', 조문내용: `제1조(목적) ${mst} 본문` }] },
    },
    mst,
  );

export function setup(
  o: {
    cas?: number; failBody?: string; markFails?: boolean | 'notfound'; stored?: string; noLawId?: boolean; listFails?: boolean;
    twoLaws?: boolean; firstNoLawId?: boolean; onList?: (n: number) => void;
    /** 판 목록·본문 받기가 던질 오류(없으면 일반 Error — 'listFails'·'failBody' 와 함께 쓴다, T-222) */
    listError?: Error; bodyError?: Error;
  } = {},
) {
  const calls = { lawUpdates: [] as any[], lawWrites: [] as { id: string; data: any }[], findMany: [] as any[], lawGoKr: 0, lists: 0, runsStarted: 0 };
  const ok = <T>(v: T) => Promise.resolve(v);
  const prisma: any = {
    $executeRaw: () => ok(0),
    lawSyncRun: {
      updateMany: () => ok({ count: 0 }),
      findFirst: () => ok(null),
      create: () => ((calls.runsStarted += 1), ok({ id: 'run-1' })),
      update: (a: any) => ok({ id: 'run-1', ...a.data }),
    },
    law: {
      findMany: (a: any) => {
        calls.findMany.push(a);
        const row = { id: 'law-1', lawName: '시험법', externalId: o.stored ?? '900100', externalLawId: o.noLawId ? null : LID, effectiveNotesVersion: EFFECTIVE_NOTES_VERSION, promulgatedDate: new Date('2026-01-01T00:00:00Z') };
        const rows = o.twoLaws ? [{ ...row, externalLawId: o.firstNoLawId ? null : row.externalLawId }, { ...row, id: 'law-2', lawName: '둘째시험법' }] : [row];
        const only: string[] | undefined = a?.where?.id?.in;
        return ok(only ? rows.filter((r) => only.includes(r.id)) : rows);
      },
      findUnique: () => ok({ effectiveNotesVersion: EFFECTIVE_NOTES_VERSION }),
      update: (a: any) => {
        if (o.markFails && ('lastCheckedAt' in a.data || 'lastCheckError' in a.data)) {
          return Promise.reject(
            o.markFails === 'notfound' ? new Prisma.PrismaClientKnownRequestError('gone', { code: 'P2025', clientVersion: 'test' }) : new Error('DB 연결 끊김'),
          );
        }
        calls.lawUpdates.push(a.data);
        calls.lawWrites.push({ id: a.where.id, data: a.data });
        return ok({});
      },
      updateMany: () => ok({ count: o.cas ?? 1 }),
    },
    lawVersion: {
      upsert: () => ok({ id: 'v', orderKey: 'k', stageEffectiveDates: [new Date()], revisionType: 'x' }),
      create: () => ok({ id: 'ver' }),
      update: () => ok({}),
      // 개정 정보 채우기(T-152) — 아직 읽지 않은 판 없음(판 걷기를 본다. 채우기는 tests/lawRevisionInfo.test.ts)
      findMany: () => ok([]),
    },
    lawArticle: { findMany: () => ok([]), upsert: () => ok({ id: 'a1' }), updateMany: () => ok({ count: 0 }) },
    lawChangeEvent: { createMany: (a: any) => ok({ count: a.data.length }) },
  };
  prisma.$transaction = (fn: (tx: unknown) => Promise<unknown>) => fn(prisma);
  // 판 목록은 법령ID 로만 받는다 — 법령명 검색(search)은 없다
  const lawGoKr: any = {
    searchVersions: () => {
      calls.lawGoKr += 1;
      o.onList?.((calls.lists += 1));
      if (o.listFails) return Promise.reject(o.listError ?? new Error('법제처 연결 실패'));
      return ok({ total: 3, page: 1, display: 100, items: [item('900300', '2026-03-01'), item('900200', '2026-02-01'), item('900100', '2026-01-01')] });
    },
    getLaw: (mst: string) =>
      ((calls.lawGoKr += 1), mst === o.failBody ? Promise.reject(o.bodyError ?? new Error('법제처 응답 오류')) : ok(body(mst, mst === '900200' ? '2026-02-01' : '2026-03-01'))),
  };
  const amendments: any = { processPendingEvents: () => ok({ created: 0 }) };
  return { service: new LawSyncService(prisma, lawGoKr, amendments), calls };
}
