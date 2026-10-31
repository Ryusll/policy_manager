import { describe, it, expect } from 'vitest';
import { LawsService } from '../apps/api/src/laws/laws.service';
import { collectEffectiveNotes } from '../apps/api/src/laws/law-effective-collect';
import { mapLawDetail } from '../apps/api/src/lawgokr/lawgokr.mapper';
import { lawVersionKey } from '../apps/api/src/laws/law-version-key';
import { EFFECTIVE_NOTES_VERSION } from '../apps/api/src/common/effective-notes';
import { applyLawVersion } from '../apps/api/src/laws/law-version-apply';
import { prepareVersion } from '../apps/api/src/laws/law-articles-save';

/**
 * 법령 저장의 조별 시행일 표기 (T-144, PAT-06) — DB 없이 가짜 저장소로 `LawsService` 를 직접 돌린다.
 * 실제 법제처 응답으로 같은 흐름을 한 번 확인했고(로컬), 여기서는 CI 에서도 저장 규칙이 지켜지는지 본다.
 *
 * 지킬 것:
 * 1. 조항에는 "지금" 표기를 저장한다(표기 없음은 [] — null=수집 안 함 과 구분)
 * 2. **본문이 바뀐** 이벤트에만 그때의 표기 스냅샷(앞뒤·판)을 싣는다 — 표기만 달라진 판은 이벤트를 만들지 않는다
 * 3. 계획용 날짜는 판 시행일 그대로(조항의 effectiveDate·이벤트의 lawEffectiveDate)
 * 4. 이미 등록된 법령의 표기 채우기는 법령의 읽기 판이 지금과 다를 때만, 달라진 조항에만, 이벤트 없이
 */

const LAW_DATE = '20260101';
const MARKER = '[본조신설 2019.12.31][시행일: 2027.1.1] 제5조제1항 중 "15일"의 개정부분';

const detail = () =>
  ({
    // 법령ID 가 있어야 새로 등록한다(없으면 같은 법령을 다른 판으로 추적 중인지 알 수 없어 거절 — T-151)
    기본정보: { 시행일자: LAW_DATE, 법령명_한글: '시험법', 공포일자: '20251201', 법령ID: '990143' },
    조문: {
      조문단위: [
        {
          조문번호: '5',
          조문여부: '조문',
          조문제목: '휴가',
          조문내용: '제5조(휴가)',
          조문시행일자: LAW_DATE,
          조문참고자료: MARKER,
          항: [{ 항번호: '①', 항내용: '① 사용자는 20일의 휴가를 주어야 한다.' }],
        },
        { 조문번호: '6', 조문여부: '조문', 조문제목: '표기 없음', 조문내용: '제6조(표기 없음) 본문.', 조문시행일자: LAW_DATE },
      ],
    },
  }) as any;

const OLD = { date: '2020-01-01', scope: 'unknown', scopeText: '제1조', source: '조문내용', raw: '[시행일: 2020.1.1]' };

type Existing = { id: string; nodeKey: string; content: string; versionKey: string; effectiveNotes: unknown; deletedAt?: Date | null };

function setup(existing: Existing[], opts: { claim?: number; priorRules?: number | null } = {}) {
  const calls = {
    articleUpserts: [] as any[],
    events: [] as any[],
    updateManys: [] as any[],
    lawWrites: [] as any[],
    lawClaims: [] as any[],
    articleReads: [] as any[],
    versionWrites: [] as any[],
    getLaw: 0,
  };
  /** 가짜 저장소 — 부른 값을 기록하고 값을 돌려준다 */
  const ok = <T>(value: T) => Promise.resolve(value);
  // 법령 행 — 쓰면 판이 바뀐다(저장 전 판을 읽는 순서를 시험이 볼 수 있게). 기존 조항이 있으면 있는 법령이다
  const lawRow = {
    exists: existing.length > 0,
    effectiveNotesVersion: opts.priorRules === undefined ? EFFECTIVE_NOTES_VERSION : opts.priorRules,
  };
  const tx = {
    // 등록의 법령 행 잠금(T-151) — 기다림 설정 읽기, 그다음 잠금 SELECT. 있는 법령이면 같은 판의 행을 돌려준다
    $queryRaw: (strings: TemplateStringsArray) =>
      ok(
        strings.join('?').includes('set_config')
          ? [{ prev: '0' }]
          : lawRow.exists
            ? [{ id: 'law-1', external_id: '900143', effective_notes_version: lawRow.effectiveNotesVersion, created_at: new Date() }]
            : [],
      ),
    $executeRaw: () => ok(0),
    law: {
      create: (a: any) => {
        calls.lawWrites.push({ op: 'create', ...a });
        lawRow.effectiveNotesVersion = a.data.effectiveNotesVersion;
        lawRow.exists = true;
        return ok({ id: 'law-1', ...a.data });
      },
      update: (a: any) => {
        calls.lawWrites.push({ op: 'update', ...a });
        if ('effectiveNotesVersion' in a.data) lawRow.effectiveNotesVersion = a.data.effectiveNotesVersion;
        return ok({ id: 'law-1', ...a.data });
      },
      findUnique: () => ok(lawRow.exists ? { effectiveNotesVersion: lawRow.effectiveNotesVersion } : null),
      updateMany: (a: any) => {
        calls.lawClaims.push(a);
        return ok({ count: opts.claim ?? 1 });
      },
    },
    lawArticle: {
      // where 의 deletedAt: null 을 따른다 — 사라진 조항은 읽지 않아야 한다
      findMany: (a: any) => {
        calls.articleReads.push(a);
        return ok(existing.filter((e) => !(a?.where?.deletedAt === null && e.deletedAt)));
      },
      upsert: (a: any) => {
        calls.articleUpserts.push(a);
        return ok({ id: `id-${a.where.lawId_nodeKey.nodeKey}` });
      },
      updateMany: (a: any) => {
        calls.updateManys.push(a);
        return ok({ count: Array.isArray(a.where?.id?.in) ? a.where.id.in.length : 0 });
      },
    },
    lawChangeEvent: {
      createMany: (a: any) => {
        calls.events.push(...a.data);
        return ok({ count: a.data.length });
      },
    },
    // 판 기록(T-151) — 쓴 것만 기록한다
    lawVersion: {
      upsert: (a: any) => (calls.versionWrites.push({ op: 'upsert', ...a }), ok({ id: 'ver-base' })),
      create: (a: any) => (calls.versionWrites.push({ op: 'create', ...a }), ok({ id: 'ver-1' })),
      update: (a: any) => (calls.versionWrites.push({ op: 'update', ...a }), ok({ id: a.where.id })),
    },
  };
  const prisma = {
    ...tx,
    lawSource: { upsert: () => ok({ id: 'src-1', isActive: true }) },
    $transaction: (fn: (t: typeof tx) => Promise<unknown>) => fn(tx),
  };
  let lastMst = '';
  const lawGoKr = {
    getLaw: (mst: string) => {
      calls.getLaw += 1;
      lastMst = mst;
      return ok(mapLawDetail(detail(), mst));
    },
    // 판 목록 — 요청한 판이 현행이다(현행이 아닌 판의 등록은 tests/lawRegisterVersion.test.ts, T-150)
    searchVersions: (lawId: string) =>
      ok({ page: 1, display: 100, total: 1, items: [{ mst: lastMst, lawId, status: '현행', promulgationDate: '2026-01-01' }] }),
  };
  const collect = (effectiveNotesVersion: number | null) =>
    collectEffectiveNotes(prisma as any, lawGoKr, { id: 'law-1', externalId: '900143', effectiveNotesVersion });
  return { service: new LawsService(prisma as any, lawGoKr as any), collect, calls, prisma };
}

/** 이번 응답과 같은 본문 지문 — "본문은 그대로"인 기존 조항을 만들 때 */
const sameKey = (content: string) => lawVersionKey(content);

describe('LawsService — 조별 시행일 표기 저장 (T-144)', () => {
  it('최초 등록: 조·항 행에 표기를 저장하고(표기 없는 조는 []), 이벤트는 만들지 않는다', async () => {
    const { service, calls } = setup([]);
    await service.register('900143');
    const byKey = new Map(calls.articleUpserts.map((u) => [u.where.lawId_nodeKey.nodeKey, u]));
    expect([...byKey.keys()]).toEqual(['5//', '5/1/', '6//']);
    // 조와 그 항이 같은 표기(상위 조의 안내)
    for (const key of ['5//', '5/1/']) {
      expect(byKey.get(key).create.effectiveNotes).toHaveLength(1);
      expect(byKey.get(key).update.effectiveNotes[0]).toMatchObject({ date: '2027-01-01', scope: 'partial', source: '조문참고자료' });
    }
    expect(byKey.get('6//').create.effectiveNotes).toEqual([]); // 읽었지만 표기 없음
    expect(calls.events).toEqual([]);
    // 계획용 날짜는 판 시행일 그대로 — 표기의 2027-01-01 로 옮기지 않는다
    for (const u of calls.articleUpserts) {
      expect(u.create.effectiveDate).toEqual(new Date('2026-01-01T00:00:00.000Z'));
      expect(u.update.effectiveDate).toEqual(new Date('2026-01-01T00:00:00.000Z'));
    }
  });

  it('재등록: 본문이 바뀐 조·항·사라진 조항에만 이벤트와 그때의 표기 스냅샷 — 표기만 달라진 조는 이벤트 없음', async () => {
    const six = '본문.'; // 매퍼가 "제6조(표기 없음)" 머리말을 떼므로 행의 본문은 이것이다
    const { service, calls } = setup([
      { id: 'e5', nodeKey: '5//', content: '옛 본문', versionKey: 'v1:old', effectiveNotes: [OLD] }, // 본문 변경, 앞 표기 있음
      { id: 'e51', nodeKey: '5/1/', content: '옛 항', versionKey: 'v1:old', effectiveNotes: null }, // 본문 변경, 그때는 수집 안 함
      { id: 'e6', nodeKey: '6//', content: six, versionKey: sameKey(six), effectiveNotes: [OLD] }, // 본문 그대로, 표기만 다름(사라짐)
      { id: 'e9', nodeKey: '9//', content: '사라질 조', versionKey: 'v1:gone', effectiveNotes: [OLD] }, // 이번 판에 없다
    ]);
    await service.register('900143');
    const ev = new Map(calls.events.map((e) => [e.nodeKey, e]));
    expect([...ev.keys()].sort()).toEqual(['5//', '5/1/', '9//'].sort()); // 6// 는 없다 — 표기만 바뀐 판은 이벤트를 만들지 않는다

    expect(ev.get('5//').changeType).toBe('modified');
    expect(ev.get('5//').effectiveInfo).toMatchObject({ mst: '900143', inherited: false, before: [OLD] });
    expect(ev.get('5//').effectiveInfo.after[0]).toMatchObject({ date: '2027-01-01', scope: 'partial' });

    expect(ev.get('5/1/').effectiveInfo).toMatchObject({ inherited: true, before: null }); // 항 이벤트 = 상위 조의 안내
    expect(ev.get('5/1/').effectiveInfo.after).toHaveLength(1);

    expect(ev.get('9//')).toMatchObject({ changeType: 'deleted' });
    expect(ev.get('9//').effectiveInfo).toEqual({
      mst: '900143',
      inherited: false,
      before: [OLD],
      after: null,
      rules: EFFECTIVE_NOTES_VERSION,
      beforeRules: EFFECTIVE_NOTES_VERSION,
    });

    // 계획용 날짜는 모든 이벤트에서 판 시행일 그대로
    for (const e of calls.events) expect(e.lawEffectiveDate).toEqual(new Date('2026-01-01T00:00:00.000Z'));
    // 표기만 바뀐 6// 도 조항의 "지금" 표기는 갱신된다
    expect(calls.articleUpserts.find((u) => u.where.lawId_nodeKey.nodeKey === '6//').update.effectiveNotes).toEqual([]);
  });

  it('이벤트에 앞 표기를 읽은 규칙의 판(저장 전 법령 행의 판)을 남긴다 — T-144 이전 법령은 null', async () => {
    for (const priorRules of [null, EFFECTIVE_NOTES_VERSION]) {
      const { service, calls } = setup([{ id: 'e5', nodeKey: '5//', content: '옛 본문', versionKey: 'v1:old', effectiveNotes: [OLD] }], { priorRules });
      await service.register('900143');
      const ev = calls.events.find((e) => e.nodeKey === '5//');
      expect(ev.effectiveInfo).toMatchObject({ rules: EFFECTIVE_NOTES_VERSION, beforeRules: priorRules });
    }
  });

  it('판 반영(applyLawVersion — 주기 동기화의 주 경로, T-151)도 저장 **전** 법령 행의 판을 이벤트에 남긴다 (T-144 검토 H1)', async () => {
    for (const priorRules of [null, 0, EFFECTIVE_NOTES_VERSION]) {
      const { prisma, calls } = setup([{ id: 'e5', nodeKey: '5//', content: '옛 본문', versionKey: 'v1:old', effectiveNotes: [OLD] }], { priorRules });
      const { meta, tree } = mapLawDetail(detail(), '900144');
      const entry = { mst: '900144', lawId: '990143', title: '시험법', promulgationDate: '2025-12-01', promulgationNo: null, revisionType: '일부개정', stageEffectiveDates: ['2026-01-01'] };
      await applyLawVersion(prisma as any, { lawId: 'law-1', prevMst: '900143', entry, meta, version: prepareVersion('900144', meta, tree), receivedVia: 'poll' });
      const ev = calls.events.find((e) => e.nodeKey === '5//');
      expect(ev.effectiveInfo, String(priorRules)).toMatchObject({ rules: EFFECTIVE_NOTES_VERSION, beforeRules: priorRules });
      expect(ev.lawVersionId).toBe('ver-1'); // 이벤트가 판을 가리킨다
    }
  });

  it('보여 줄 표기가 앞뒤 모두 없으면 이벤트의 표기 칸을 채우지 않는다(undefined)', async () => {
    const { service, calls } = setup([
      { id: 'e6', nodeKey: '6//', content: '옛 본문', versionKey: 'v1:old', effectiveNotes: [] },
      { id: 'e5', nodeKey: '5//', content: 'x', versionKey: sameKey('x'), effectiveNotes: null },
    ]);
    await service.register('900143');
    const ev6 = calls.events.find((e) => e.nodeKey === '6//');
    expect(ev6.changeType).toBe('modified');
    expect(ev6.effectiveInfo).toBeUndefined();
  });
});

describe('collectEffectiveNotes — 이미 등록된 법령의 표기 맞추기 (T-144)', () => {
  it('법령의 읽기 판이 지금과 같으면 법제처를 부르지 않는다(null)', async () => {
    const { collect, calls } = setup([]);
    expect(await collect(EFFECTIVE_NOTES_VERSION)).toBeNull();
    expect(calls.getLaw).toBe(0);
    expect(calls.lawClaims).toEqual([]);
  });

  it('판이 없거나(T-144 이전) 옛 판이면 한 번 읽어, 달라진 조항만 같은 값끼리 묶어 쓴다 — 이벤트·본문·사라진 조항은 그대로', async () => {
    for (const version of [null, EFFECTIVE_NOTES_VERSION - 1]) {
      const { collect, calls } = setup([
        { id: 'e5', nodeKey: '5//', content: 'x', versionKey: 'k', effectiveNotes: null }, // 수집 안 함
        { id: 'e51', nodeKey: '5/1/', content: 'x', versionKey: 'k', effectiveNotes: [OLD] }, // 옛 규칙으로 읽은 값
        { id: 'e6', nodeKey: '6//', content: 'x', versionKey: 'k', effectiveNotes: [] }, // 이미 같다
        { id: 'e7', nodeKey: '7//', content: 'x', versionKey: 'k', effectiveNotes: null, deletedAt: new Date() }, // 사라진 조항
        { id: 'e9', nodeKey: '9//', content: 'x', versionKey: 'k', effectiveNotes: null }, // 이번 판에 없는 행
      ]);
      expect(await collect(version)).toBe(2);
      expect(calls.getLaw).toBe(1);
      // 법령 행을 먼저 잡는다 — 같은 MST 이고 아직 옛 판일 때만(겹친 저장이 먼저 끝났으면 손을 뗀다)
      expect(calls.lawClaims).toEqual([
        {
          where: { id: 'law-1', externalId: '900143', OR: [{ effectiveNotesVersion: null }, { effectiveNotesVersion: { not: EFFECTIVE_NOTES_VERSION } }] },
          data: { effectiveNotesVersion: EFFECTIVE_NOTES_VERSION },
        },
      ]);
      expect(calls.articleReads[0].where).toEqual({ lawId: 'law-1', deletedAt: null });
      // 5// 와 5/1/ 은 같은 표기(항은 상위 조의 것) — 한 번에. 6//(같음)·7//(사라짐)·9//(이번 판에 없음)은 쓰지 않는다
      expect(calls.updateManys).toHaveLength(1);
      expect(calls.updateManys[0].where).toEqual({ id: { in: ['e5', 'e51'] } });
      expect(Object.keys(calls.updateManys[0].data)).toEqual(['effectiveNotes']);
      expect(calls.updateManys[0].data.effectiveNotes[0]).toMatchObject({ date: '2027-01-01', scope: 'partial' });
      expect(calls.events).toEqual([]);
      expect(calls.articleUpserts).toEqual([]);
    }
  });

  it('법령 행을 잡지 못하면(그새 저장이 끝났거나 MST 가 바뀜) 조항을 쓰지 않는다', async () => {
    const { collect, calls } = setup([{ id: 'e5', nodeKey: '5//', content: 'x', versionKey: 'k', effectiveNotes: null }], { claim: 0 });
    expect(await collect(null)).toBe(0);
    expect(calls.articleReads).toEqual([]);
    expect(calls.updateManys).toEqual([]);
  });

  it('등록·새 판 저장은 법령 행에 지금 읽기 판을 남긴다 — 다음 동기화가 다시 읽지 않게', async () => {
    const { service, calls } = setup([]);
    await service.register('900143');
    const created = calls.lawWrites.find((w) => w.op === 'create');
    expect(created.data.effectiveNotesVersion).toBe(EFFECTIVE_NOTES_VERSION);
    // 새 등록은 확인 시각을 비워 다음 동기화의 맨 앞에 선다(T-150 ③ — T-151 때는 찍어서 맨 뒤로 갔다). 판 반영은 찍지 않는다(T-151)
    expect(created.data.lastCheckedAt).toBeNull();
    // 같은 판을 다시 등록하면 그 행을 고친다 — 옛 읽기 판이었어도 지금 판으로, 확인 시각은 찍는다(지금 확인했다)
    const again = setup([{ id: 'e5', nodeKey: '5//', content: 'x', versionKey: 'k', effectiveNotes: null }], { priorRules: null });
    await again.service.register('900143');
    expect(again.calls.lawWrites.map((w) => w.op)).toEqual(['update']);
    expect(again.calls.lawWrites[0].data.effectiveNotesVersion).toBe(EFFECTIVE_NOTES_VERSION);
    expect(again.calls.lawWrites[0].data.lastCheckedAt).toBeInstanceOf(Date);
  });

  it('등록은 그 판을 기준판으로 판 기록에 남기고, 등록에서 생긴 이벤트는 판을 가리키지 않는다 (T-151)', async () => {
    const { service, calls } = setup([{ id: 'e5', nodeKey: '5//', content: '옛 본문', versionKey: 'v1:old', effectiveNotes: [OLD] }]);
    await service.register('900143');
    const base = calls.versionWrites.find((w) => w.op === 'upsert');
    expect(base.where).toEqual({ lawId_mst: { lawId: 'law-1', mst: '900143' } });
    expect(base.create).toMatchObject({ mst: '900143', kind: 'baseline', receivedVia: 'manual', promulgatedDate: new Date('2025-12-01T00:00:00.000Z') });
    expect(base.update).toEqual({}); // 이미 있으면 그대로(같은 판 재등록)
    expect(calls.events.find((e) => e.nodeKey === '5//').lawVersionId).toBeNull();
  });
});
