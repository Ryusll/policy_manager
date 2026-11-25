import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { mapSearchItem } from '../apps/api/src/lawgokr/lawgokr.mapper';
import {
  compareVersions,
  groupVersions,
  isRepealVersion,
  needsNextPage,
  planVersions,
  versionLabel,
  type LawVersionEntry,
} from '../apps/api/src/laws/law-version-plan';

/**
 * 법령 판 목록과 반영 계획 (T-151, PAT-07 — 특허 도 7 S770).
 *
 * 고정 자료는 2026-10-14 실호출 응답(시행일법령 목록 `target=eflaw`, 근로기준법, 2026년 공포분)에서 필요한 칸만 남긴 것이다
 * (법령상세링크는 인증값이 붙을 수 있어 뺐다). 같은 MST 가 단계 시행일마다 따로 나오고, 공포 순과 시행 순이 다르다.
 *
 * 막고 싶은 사고:
 * 1. 가장 큰 MST 하나로 건너뛰어 중간 판의 변경이 마지막 판의 날짜로 묶인다
 * 2. 시행일 단계 행을 판 여럿으로 세어 같은 판을 두 번 반영한다
 * 3. MST 번호나 시행일 순으로 줄 세워 개정 순서가 뒤바뀐다
 * 4. 저장된 판을 목록에서 못 찾았는데 짐작으로 이어 가 사이 판을 빠뜨린다
 */
const fixture = JSON.parse(readFileSync(join(__dirname, 'fixtures', 'lawgokr-eflaw-2026.json'), 'utf8'));
const items = fixture.LawSearch.law.map(mapSearchItem);
const LID = '001872';

const v = (mst: string, promulgationDate: string, promulgationNo: string | null, revisionType = '일부개정'): LawVersionEntry => ({
  mst,
  lawId: LID,
  title: '시험법',
  promulgationDate,
  promulgationNo,
  revisionType,
  stageEffectiveDates: [],
});

describe('groupVersions — 판 목록 (T-151)', () => {
  it('실응답: 단계 시행일 행을 MST 하나로 합치고, 공포 순으로 줄 세운다 — 시행 순이 아니다', () => {
    const r = groupVersions(items, LID);
    expect(r.kind).toBe('ok');
    if (r.kind !== 'ok') return;
    expect(r.versions.map((x) => x.mst)).toEqual(['283457', '284443', '285279', '286771', '290781']);
    const by = new Map(r.versions.map((x) => [x.mst, x]));
    expect(by.get('285279')?.stageEffectiveDates).toEqual(['2026-10-08', '2026-12-08', '2027-01-01']);
    expect(by.get('286771')?.stageEffectiveDates).toEqual(['2026-12-10', '2027-06-10']);
    // 290781 은 시행(10-02)이 285279(10-08)보다 이르지만 공포(08-04)는 가장 늦다 — 공포 순으로 맨 뒤
    expect(by.get('290781')).toMatchObject({ promulgationDate: '2026-08-04', promulgationNo: '21857', revisionType: '타법개정' });
  });

  it('다른 법령ID 의 행(이름이 겹치는 시행령 등)은 버린다', () => {
    const mixed = [...items, { ...items[0], mst: '999001', lawId: '003058', title: '근로기준법 시행령' }];
    const r = groupVersions(mixed, LID);
    expect(r.kind === 'ok' && r.versions.map((x) => x.mst)).toEqual(['283457', '284443', '285279', '286771', '290781']);
  });

  it('법령ID·MST 가 빈 행이 저장 판의 공포일 뒤(같은 날 포함)에 있으면 목록을 믿지 않는다 — 앞이면 쓰지 않는 행이라 넘어간다', () => {
    const since = '2026-02-19'; // 저장 판 283457 의 공포일
    const withRow = (row: Record<string, unknown>) => groupVersions([...items, { ...items[0], ...row }], LID, since);
    const bad = withRow({ mst: 'abc', promulgationDate: '2026-05-01' });
    expect(bad).toEqual({ kind: 'invalid', reason: expect.stringContaining('법령ID·MST 가 빈 행이 있습니다(공포일 2026-05-01)') });
    expect(withRow({ mst: '', promulgationDate: since }).kind).toBe('invalid'); // 같은 날 — 저장 판과 같은 날 공포된 판일 수 있다
    expect(withRow({ mst: '777777', lawId: '', promulgationDate: '2026-05-01' }).kind).toBe('invalid'); // 법령ID 가 빈 행도 어느 법령인지 모른다
    expect(withRow({ mst: '', promulgationDate: null }).kind).toBe('invalid'); // 공포일도 없으면 앞인지 알 수 없다
    const old = withRow({ mst: '', promulgationDate: '2020-01-01' });
    expect(old.kind === 'ok' && old.versions.map((x) => x.mst)).toEqual(['283457', '284443', '285279', '286771', '290781']);
    expect(groupVersions([...items, { ...items[0], mst: '', promulgationDate: '2020-01-01' }], LID).kind).toBe('invalid'); // 기준을 모르면 멈춘다
  });

  it('공포일이 없는 판은 순서에 놓을 수 없어 목록을 믿지 않는다 — 저장 판이 맨 앞에 서서 옛 판을 다시 반영하지 않게', () => {
    const undated = (mst: string) => items.map((i: any) => (i.mst === mst ? { ...i, promulgationDate: null } : i));
    const stored = groupVersions(undated('283457'), LID, '2026-02-19');
    expect(stored).toEqual({ kind: 'invalid', reason: expect.stringContaining('공포일이 없는 판(MST 283457)') });
    expect(groupVersions(undated('285279'), LID, '2026-02-19').kind).toBe('invalid'); // 사이 판도 — 저장 판 앞으로 빠지지 않게
    // 시행일이 저장 판 공포일보다 한 해 넘게 앞이면 옛 판이 분명해 쓰지 않는다(보통 공포 ≤ 시행, 소급 시행 여유). 시행일도 없으면 알 수 없다
    const old = (row: Record<string, unknown>) => groupVersions([...items, { ...items[0], mst: '100001', promulgationDate: null, ...row }], LID, '2026-02-19');
    const skipped = old({ effectiveDate: '2001-01-01' });
    expect(skipped.kind === 'ok' && skipped.versions.map((x) => x.mst)).toEqual(['283457', '284443', '285279', '286771', '290781']);
    expect(old({ effectiveDate: '2026-02-19' }).kind).toBe('invalid');
    expect(old({ effectiveDate: '2025-06-01' }).kind).toBe('invalid'); // 한 해 안쪽 — 소급 시행이면 저장 판 뒤에 공포된 판일 수 있다
    expect(old({ effectiveDate: '2025-02-19' }).kind).toBe('invalid'); // 꼭 한 해 전(경계)은 아직 애매하다 — 멈춘다(안전 쪽)
    expect(old({ effectiveDate: '2025-02-18' }).kind).toBe('ok'); // 한 해 넘게 앞 — 옛 판이 분명하다
    expect(old({ effectiveDate: null }).kind).toBe('invalid');
  });

  it('옛 판이 분명한 행의 이상(MST·공포일 빈 행, 같은 판의 공포일 다름)은 연혁 한 줄일 뿐 — 멈추지 않는다', () => {
    const since = '2026-02-19';
    const base = { ...items[0], status: '연혁' };
    const ok = (rows: Record<string, unknown>[]) => groupVersions([...items, ...rows.map((r) => ({ ...base, ...r }))], LID, since);
    // MST 도 공포일도 없지만 시행일이 저장 판 공포일보다 앞
    expect(ok([{ mst: '', promulgationDate: null, effectiveDate: '2001-01-01' }]).kind).toBe('ok');
    // 같은 옛 판(100001)의 두 행이 공포일이 다르다 — 둘 다 저장 판보다 앞
    const twin = ok([
      { mst: '100001', promulgationDate: '2001-01-01', promulgationNo: '1' },
      { mst: '100001', promulgationDate: '2001-01-02', promulgationNo: '1' },
    ]);
    expect(twin.kind === 'ok' && twin.versions[0].mst).toBe('100001');
    // 한쪽이라도 저장 판 뒤면 믿지 않는다
    expect(ok([{ mst: '100001', promulgationDate: '2001-01-01' }, { mst: '100001', promulgationDate: '2026-03-01' }]).kind).toBe('invalid');
  });

  it('MST 순서가 공포 순과 어긋나도 공포일이 이긴다(2001년 이전 실자료) — 같은 날이면 공포번호를 숫자로, 그다음 MST', () => {
    const rows = [
      { mst: '53682', promulgationDate: '2001-08-14', promulgationNo: '06507' },
      { mst: '53779', promulgationDate: '1998-02-20', promulgationNo: '05510' },
      { mst: '206711', promulgationDate: '2019-01-15', promulgationNo: '16272' },
      { mst: '206706', promulgationDate: '2019-01-15', promulgationNo: '16270' },
      { mst: '300002', promulgationDate: '2026-11-01', promulgationNo: '9' },
      { mst: '300001', promulgationDate: '2026-11-01', promulgationNo: '21700' },
    ].map((r) => ({ ...items[0], ...r, lawId: LID, effectiveDate: r.promulgationDate }));
    const r = groupVersions(rows, LID);
    expect(r.kind === 'ok' && r.versions.map((x) => x.mst)).toEqual(['53779', '53682', '206706', '206711', '300002', '300001']);
  });

  it('같은 MST 인데 공포일·공포번호가 다르면 목록을 믿지 않는다(invalid) — 짐작으로 반영하지 않는다', () => {
    const bad = [...items, { ...items[0], promulgationDate: '2026-02-20' }];
    const r = groupVersions(bad, LID);
    expect(r.kind).toBe('invalid');
    if (r.kind === 'invalid') expect(r.reason).toContain('MST 283457');
  });

  it('compareVersions — 공포일이 같고 공포번호가 없으면 MST 로 가른다', () => {
    expect(compareVersions(v('2', '2026-01-01', null), v('10', '2026-01-01', null))).toBeLessThan(0);
    expect(compareVersions(v('10', '2026-01-01', '5'), v('2', '2026-01-01', '5'))).toBeGreaterThan(0);
  });
});

describe('planVersions — 저장된 판 뒤에 공포된 판 (T-151)', () => {
  const versions = (() => {
    const r = groupVersions(items, LID);
    if (r.kind !== 'ok') throw new Error('fixture');
    return r.versions;
  })();

  it('저장 판 뒤의 판 전부를 공포 순으로 — 가장 큰 MST 로 건너뛰지 않는다', () => {
    const p = planVersions(versions, '283457');
    expect(p.kind === 'pending' && p.pending.map((x) => x.mst)).toEqual(['284443', '285279', '286771', '290781']);
    // 현행(285279)으로 등록한 법령도 그 뒤에 공포된 시행 예정 판(286771)·연혁 판(290781)을 반영한다(SRS LAW-15)
    const q = planVersions(versions, '285279');
    expect(q.kind === 'pending' && q.pending.map((x) => x.mst)).toEqual(['286771', '290781']);
    expect(q.kind === 'pending' && q.stored.mst).toBe('285279');
  });

  it('저장 판이 마지막이면 할 일이 없다', () => {
    const p = planVersions(versions, '290781');
    expect(p).toMatchObject({ kind: 'pending', pending: [] });
  });

  it('저장 판을 목록에서 못 찾으면 멈춘다 — 공포일로 자리를 짐작하지 않는다', () => {
    expect(planVersions(versions, '1')).toEqual({ kind: 'stored_missing' });
    expect(planVersions([], '283457')).toEqual({ kind: 'stored_missing' });
  });
});

describe('그 밖의 판 규칙 (T-151)', () => {
  it('폐지 판 — 폐지·타법폐지·일괄폐지(법령 자체가 없어지는 판). 폐지제정·일부개정은 아니다', () => {
    expect(isRepealVersion({ revisionType: '폐지' })).toBe(true);
    expect(isRepealVersion({ revisionType: ' 폐지 ' })).toBe(true);
    expect(isRepealVersion({ revisionType: '타법폐지' })).toBe(true);
    expect(isRepealVersion({ revisionType: '일괄폐지' })).toBe(true);
    expect(isRepealVersion({ revisionType: '폐지제정' })).toBe(false); // 옛 법을 없애고 새로 만든 판 — 본문이 있다
    expect(isRepealVersion({ revisionType: '일부개정' })).toBe(false);
    expect(isRepealVersion({ revisionType: null })).toBe(false);
  });

  it('다음 쪽 — 전체 건수가 남았고, 그 쪽의 가장 오래된 행이 기준 공포일 이후(같은 날 포함)면 더 받는다', () => {
    const res = (dates: string[], o: { page?: number; total: number }) => ({
      page: o.page ?? 1, display: 2, total: o.total, items: dates.map((promulgationDate) => ({ promulgationDate })),
    });
    expect(needsNextPage(res(['2026-08-04', '2026-02-19'], { total: 5 }), '2026-02-19')).toBe(true); // 같은 날 판이 다음 쪽에 더 있을 수 있다
    expect(needsNextPage(res(['2026-08-04', '2026-02-18'], { total: 5 }), '2026-02-19')).toBe(false); // 기준보다 앞 — 더 볼 판이 없다
    expect(needsNextPage(res(['2026-08-04'], { total: 5 }), '2020-01-01')).toBe(true); // 덜 차 왔어도 전체 건수가 남았다
    expect(needsNextPage(res(['2026-08-04', '2026-02-18'], { total: 4, page: 2 }), null)).toBe(false); // 2쪽 × 2건 = 전체 — 마지막 쪽
    expect(needsNextPage(res(['2026-08-04', '2026-02-18'], { total: 5 }), null)).toBe(true); // 기준을 모르면 끝까지
    expect(needsNextPage(res([], { total: 5 }), '2026-02-19')).toBe(true); // 빈 쪽은 판단 근거가 없다 — 더 받는다(쪽 상한이 끝을 막는다)
  });

  it('판 표기 — 공포번호(앞 0 없이)와 공포일, 없으면 MST', () => {
    expect(versionLabel({ mst: '285279', promulgationNo: '21533', promulgationDate: '2026-04-07' })).toBe('제21533호(2026-04-07 공포)');
    expect(versionLabel({ mst: '269393', promulgationNo: '00436', promulgationDate: null })).toBe('제436호');
    expect(versionLabel({ mst: '1', promulgationNo: null, promulgationDate: null })).toBe('MST 1');
  });
});
