import { describe, it, expect } from 'vitest';
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
 */

const MST = '900143';
const detail = () =>
  ({
    기본정보: { 시행일자: '20260101', 법령명_한글: '시험법', 공포일자: '20251201', 법령ID: '990143' },
    조문: {
      조문단위: [{ 조문번호: '5', 조문여부: '조문', 조문내용: '제5조(휴가) 본문', 조문참고자료: '[시행일: 2027.1.1] 제5조제1항' }],
    },
  }) as any;

function setup(opts: { version: number | null; latest?: string; getLawFails?: boolean }) {
  const calls = { getLaw: 0, applyNewVersion: 0, claims: 0, notesWrites: 0, markChecked: [] as any[], runUpdate: null as any };
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
      findMany: () => ok([{ id: 'law-1', lawName: '시험법', externalId: MST, externalLawId: '990143', effectiveNotesVersion: opts.version }]),
      update: (a: any) => {
        calls.markChecked.push(a.data);
        return ok({});
      },
      updateMany: () => {
        calls.claims += 1;
        return ok({ count: 1 });
      },
    },
    lawArticle: {
      findMany: () => ok([{ id: 'a5', nodeKey: '5//', effectiveNotes: null }]),
      updateMany: (a: any) => {
        calls.notesWrites += a.where.id.in.length;
        return ok({ count: a.where.id.in.length });
      },
    },
  };
  prisma.$transaction = (fn: (tx: unknown) => Promise<unknown>) => fn(prisma);
  const lawGoKr: any = {
    search: () => ok({ items: [{ mst: opts.latest ?? MST, lawId: '990143', title: '시험법' }] }),
    getCurrentTitleById: () => ok(null),
    getLaw: (mst: string) => {
      calls.getLaw += 1;
      if (opts.getLawFails) return Promise.reject(new Error('법제처 응답 오류'));
      return ok(mapLawDetail(detail(), mst));
    },
  };
  const laws: any = {
    applyNewVersion: () => {
      calls.applyNewVersion += 1;
      return ok({ events: 0 });
    },
  };
  const amendments: any = { processPendingEvents: () => ok({ created: 0 }) };
  return { service: new LawSyncService(prisma, laws, lawGoKr, amendments), calls };
}

describe('LawSyncService — 조별 시행일 표기 맞추기 (T-144)', () => {
  it('같은 판이고 읽기 판이 없으면(T-144 이전 등록) 한 번 읽어 맞춘다 — 결과는 개정 없음, note 없음', async () => {
    const { service, calls } = setup({ version: null });
    const run = await service.run({ trigger: 'manual', limit: 1 });
    expect(run.results).toEqual([expect.objectContaining({ outcome: 'unchanged', lawId: 'law-1' })]);
    expect(run.results[0]).not.toHaveProperty('note');
    expect(calls.getLaw).toBe(1);
    expect(calls.claims).toBe(1);
    expect(calls.notesWrites).toBe(1);
    expect(calls.applyNewVersion).toBe(0);
    expect(calls.markChecked).toEqual([expect.objectContaining({ lastCheckError: null })]);
  });

  it('읽기 판이 지금과 같으면 법제처 본문을 부르지 않는다', async () => {
    const { service, calls } = setup({ version: EFFECTIVE_NOTES_VERSION });
    const run = await service.run({ trigger: 'manual', limit: 1 });
    expect(run.results[0].outcome).toBe('unchanged');
    expect(calls.getLaw).toBe(0);
    expect(calls.claims).toBe(0);
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

  it('새 판이면 맞추기를 따로 하지 않는다 — 새 판 저장이 지금 규칙으로 쓴다', async () => {
    const { service, calls } = setup({ version: null, latest: '900200' });
    const run = await service.run({ trigger: 'manual', limit: 1 });
    expect(run.results[0]).toMatchObject({ outcome: 'updated', toMst: '900200' });
    expect(calls.applyNewVersion).toBe(1);
    expect(calls.getLaw).toBe(0);
    expect(calls.claims).toBe(0);
  });
});
