import { describe, it, expect } from 'vitest';
import { Prisma } from '@prisma/client';
import {
  applyLawVersion,
  LawVersionConflictError,
  LawVersionDuplicateError,
  LawVersionRaceError,
} from '../apps/api/src/laws/law-version-apply';
import { prepareVersion } from '../apps/api/src/laws/law-articles-save';
import { mapLawDetail } from '../apps/api/src/lawgokr/lawgokr.mapper';

/**
 * 법령 판 하나 반영 — 판 하나 = 트랜잭션 하나 (T-151, PAT-07 — 특허 도 7 S770 "이벤트 저장이 끝나야 변경 후 버전으로 확정").
 * DB 없이 가짜 트랜잭션으로 순서와 갈림길을 본다(실제 DB 제약은 통합 시험 law-sync-versions).
 */
const detail = (promulgated = '20260201') =>
  ({
    기본정보: { 시행일자: '20260301', 법령명_한글: '시험법', 공포일자: promulgated, 공포번호: '200', 법종구분: { content: '법률' }, 법령ID: '990143' },
    조문: { 조문단위: [{ 조문번호: '5', 조문여부: '조문', 조문내용: '제5조(휴가) 새 본문' }] },
  }) as any;

const entry = { mst: '900200', lawId: '990143', title: '시험법', promulgationDate: '2026-02-01', promulgationNo: '200', revisionType: '일부개정', stageEffectiveDates: ['2026-03-01', '2026-09-01'] };

const p2002 = () => new Prisma.PrismaClientKnownRequestError('Unique constraint failed', { code: 'P2002', clientVersion: 'test' });

function setup(o: { claim?: number; casThrows?: boolean; createThrows?: boolean } = {}) {
  const order: string[] = [];
  const writes: Record<string, any[]> = { cas: [], versionCreate: [], lawUpdate: [], events: [], versionUpdate: [] };
  const ok = <T>(value: T) => Promise.resolve(value);
  const tx: any = {
    law: {
      updateMany: (a: any) => {
        order.push('cas');
        writes.cas.push(a);
        return o.casThrows ? Promise.reject(p2002()) : ok({ count: o.claim ?? 1 });
      },
      findUnique: () => (order.push('prior'), ok({ effectiveNotesVersion: 1 })),
      update: (a: any) => (order.push('lawUpdate'), writes.lawUpdate.push(a), ok({})),
    },
    lawVersion: {
      create: (a: any) => {
        order.push('versionCreate');
        writes.versionCreate.push(a);
        return o.createThrows ? Promise.reject(p2002()) : ok({ id: 'ver-9' });
      },
      update: (a: any) => (order.push('versionUpdate'), writes.versionUpdate.push(a), ok({})),
    },
    lawArticle: {
      findMany: () => (order.push('articlesBefore'), ok([{ id: 'a5', nodeKey: '5//', content: '옛 본문', versionKey: 'v1:old', effectiveNotes: [] }])),
      upsert: (a: any) => ok({ id: `id-${a.where.lawId_nodeKey.nodeKey}` }),
      updateMany: () => ok({ count: 0 }),
    },
    lawChangeEvent: { createMany: (a: any) => (order.push('events'), writes.events.push(...a.data), ok({ count: a.data.length })) },
  };
  const prisma: any = { $transaction: (fn: (t: unknown) => Promise<unknown>) => fn(tx) };
  const { meta, tree } = mapLawDetail(detail(), entry.mst);
  const args = { lawId: 'law-1', prevMst: '900100', entry, meta, version: prepareVersion(entry.mst, meta, tree), receivedVia: 'poll' as const };
  return { prisma, args, order, writes };
}

describe('applyLawVersion — 판 하나의 트랜잭션 (T-151)', () => {
  it('직전 판일 때만 바꾸며 잠그고(CAS) → 잠근 뒤 이전 규칙을 읽고 → 판 기록 → 서지 → 조항·이벤트 → 이벤트 수', async () => {
    const { prisma, args, order, writes } = setup();
    const r = await applyLawVersion(prisma, args);
    expect(r).toEqual({ events: 1, versionId: 'ver-9' });
    expect(order).toEqual(['cas', 'prior', 'versionCreate', 'lawUpdate', 'articlesBefore', 'events', 'versionUpdate']);
    expect(writes.cas[0]).toEqual({ where: { id: 'law-1', externalId: '900100' }, data: { externalId: '900200' } });
    expect(writes.versionUpdate[0]).toEqual({ where: { id: 'ver-9' }, data: { eventCount: 1 } });
  });

  it('판 기록에 직전 판·공포 순서 키·단계 시행일·본문 지문을 남긴다', async () => {
    const { prisma, args, writes } = setup();
    await applyLawVersion(prisma, args);
    expect(writes.versionCreate[0].data).toMatchObject({
      lawId: 'law-1',
      mst: '900200',
      previousMst: '900100',
      kind: 'change',
      orderKey: '20260201' + '0000000200' + '000000900200',
      promulgatedDate: new Date('2026-02-01T00:00:00Z'),
      promulgationNo: '200',
      revisionType: '일부개정',
      effectiveDate: new Date('2026-03-01T00:00:00Z'),
      stageEffectiveDates: [new Date('2026-03-01T00:00:00Z'), new Date('2026-09-01T00:00:00Z')],
      versionKey: args.version.versionKey,
      receivedVia: 'poll',
    });
  });

  it('이벤트는 이 판을 가리키고 이 판의 공포일·시행일을 갖는다', async () => {
    const { prisma, args, writes } = setup();
    await applyLawVersion(prisma, args);
    expect(writes.events[0]).toMatchObject({
      nodeKey: '5//',
      changeType: 'modified',
      lawVersionId: 'ver-9',
      promulgatedDate: new Date('2026-02-01T00:00:00Z'),
      lawEffectiveDate: new Date('2026-03-01T00:00:00Z'),
      receivedVia: 'poll',
    });
  });

  it('확인 시각은 쓰지 않는다 — 법령의 판을 다 걷은 끝에서 한 번(일부만 반영한 법령이 확인 성공처럼 보이지 않게)', async () => {
    const { prisma, args, writes } = setup();
    await applyLawVersion(prisma, args);
    expect(writes.lawUpdate[0].data).not.toHaveProperty('lastCheckedAt');
    expect(writes.lawUpdate[0].data).not.toHaveProperty('lastCheckError');
  });

  it('법령 행이 직전 판을 가리키지 않으면(0건) 경합 — 판 기록·이벤트를 쓰지 않는다', async () => {
    const { prisma, args, order } = setup({ claim: 0 });
    await expect(applyLawVersion(prisma, args)).rejects.toBeInstanceOf(LawVersionRaceError);
    expect(order).toEqual(['cas']);
  });

  it('이 판이 이미 별도 법령 행이면(법령 유일 위반) 그 사실을 알리는 오류', async () => {
    const { prisma, args, order } = setup({ casThrows: true });
    const e = await applyLawVersion(prisma, args).catch((x) => x);
    expect(e).toBeInstanceOf(LawVersionConflictError);
    expect(e.message).toContain('같은 법령이 따로 등록돼 있어'); // 확인 오류는 고객 화면에도 보인다 — 할 수 없는 일을 시키지 않는다
    expect(order).toEqual(['cas']);
  });

  it('판 기록에 이미 있으면(판 유일 위반) 어긋남을 알리는 실패 — 이벤트를 쓰지 않는다', async () => {
    const { prisma, args, order } = setup({ createThrows: true });
    const e = await applyLawVersion(prisma, args).catch((x) => x);
    expect(e).toBeInstanceOf(LawVersionDuplicateError);
    expect(e.message).toContain('법령 행과 판 기록이 어긋났습니다');
    expect(order).toEqual(['cas', 'prior', 'versionCreate']);
  });
});

describe('prepareVersion — 한 판에 같은 조항 자리가 겹칠 때 (T-151)', () => {
  it('같은 nodeKey 는 마지막 것만 남긴다 — 저장(upsert)도 마지막이 이기고, (판, 조항) 유일에 걸려 판을 영영 못 반영하지 않게', () => {
    const doubled = {
      기본정보: { 시행일자: '20260301', 법령명_한글: '시험법', 공포일자: '20260201', 법령ID: '990143' },
      조문: {
        조문단위: [
          { 조문번호: '5', 조문여부: '조문', 조문내용: '제5조(휴가) 앞의 본문' },
          { 조문번호: '6', 조문여부: '조문', 조문내용: '제6조(임금) 본문' },
          { 조문번호: '5', 조문여부: '조문', 조문내용: '제5조(휴가) 뒤의 본문' },
        ],
      },
    } as any;
    const { meta, tree } = mapLawDetail(doubled, '900200');
    const v = prepareVersion('900200', meta, tree);
    expect(v.rows.map((r) => r.nodeKey)).toEqual(['6//', '5//']);
    expect(v.rows.find((r) => r.nodeKey === '5//')?.content).toContain('뒤의 본문');
  });
});
