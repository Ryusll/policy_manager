import { describe, it, expect } from 'vitest';
import { splitLawInForce, type InForceArticleRow, type LawVersionRow, type ScheduledEventRow } from '../apps/api/src/laws/law-in-force';

/**
 * 법령의 현행 본문과 시행 예정 개정 가르기 (T-150 ②, SRS LAW-15).
 * 조항 본문은 마지막 반영 판(시행 전일 수 있다)의 문구라, 시행일이 오늘 뒤인 변경 이벤트로 지금 시행 중인 문구를 되살린다.
 */
const TODAY = '2026-10-27';
const d = (s: string) => new Date(`${s}T00:00:00Z`);

const row = (nodeKey: string, content: string, o: Partial<InForceArticleRow> = {}): InForceArticleRow => ({
  id: `art-${nodeKey}`,
  nodeKey,
  articleNo: Number(nodeKey.split('/')[0]),
  clauseNo: null,
  itemNo: null,
  label: `제${nodeKey.split('/')[0]}조`,
  title: null,
  content,
  sortOrder: Number(nodeKey.split('/')[0]),
  effectiveNotes: null,
  deletedAt: null,
  ...o,
});

let seq = 0;
const ev = (nodeKey: string, changeType: ScheduledEventRow['changeType'], before: string | null, after: string | null, effective: string | null, versionId: string | null = 'vB'): ScheduledEventRow => ({
  id: `ev-${++seq}`,
  nodeKey,
  changeType,
  beforeContent: before,
  afterContent: after,
  lawEffectiveDate: effective ? d(effective) : null,
  lawVersionId: versionId,
  detectedAt: new Date(Date.UTC(2026, 9, 1, 0, 0, seq)),
});

const version = (id: string, orderKey: string, effective: string | null, no: string, stages: string[] = effective ? [effective] : []): LawVersionRow => ({
  id,
  mst: `mst-${id}`,
  orderKey,
  lawType: '법률',
  promulgatedDate: d('2026-01-01'),
  promulgationNo: no,
  revisionType: '일부개정',
  effectiveDate: effective ? d(effective) : null,
  stageEffectiveDates: stages.map(d),
});

describe('현행 본문 되살리기 (T-150)', () => {
  it('예정 변경이 없으면 조항 본문이 현행이다 — 이미 사라진 조항은 빠진다', () => {
    const out = splitLawInForce({
      today: TODAY,
      articles: [row('1//', '제1조 목적'), row('2//', '제2조 옛', { deletedAt: new Date() })],
      events: [],
      versions: [],
    });
    expect(out.articles.map((a) => [a.nodeKey, a.content, a.scheduled])).toEqual([['1//', '제1조 목적', null]]);
  });

  it('시행 예정 변경은 바뀌기 전 문구가 현행이고, 바뀐 문구는 그 시행일의 예정으로 따로 보인다', () => {
    const out = splitLawInForce({
      today: TODAY,
      articles: [row('18//', '난임치료휴가 4일')],
      events: [ev('18//', 'modified', '난임치료휴가 2일', '난임치료휴가 4일', '2026-11-27')],
      versions: [],
    });
    const a = out.articles[0];
    expect(a.content).toBe('난임치료휴가 2일');
    expect(a.scheduled).toMatchObject({ changeType: 'modified', content: '난임치료휴가 4일', effectiveDate: '2026-11-27', laterCount: 0 });
  });

  it('이미 시행된 변경(오늘 포함)과 시행일을 모르는 변경은 예정이 아니다 — 하루 뒤부터 예정', () => {
    const out = splitLawInForce({
      today: TODAY,
      articles: [row('1//', 'A2'), row('2//', 'B2'), row('3//', 'C2')],
      events: [
        ev('1//', 'modified', 'A1', 'A2', TODAY),
        ev('2//', 'modified', 'B1', 'B2', null),
        ev('3//', 'modified', 'C1', 'C2', '2026-10-28'),
      ],
      versions: [],
    });
    expect(out.articles.map((a) => a.content)).toEqual(['A2', 'B2', 'C1']);
    expect(out.articles.map((a) => a.scheduled?.effectiveDate ?? null)).toEqual([null, null, '2026-10-28']);
  });

  it('예정 판이 여럿이면 가장 먼저 시행될 변경의 "전" 문구가 현행이고, 뒤 변경은 건수로 알린다', () => {
    const out = splitLawInForce({
      today: TODAY,
      articles: [row('5//', 'v3')],
      events: [
        ev('5//', 'modified', 'v2', 'v3', '2027-06-01', 'vC'),
        ev('5//', 'modified', 'v1', 'v2', '2026-12-01', 'vB'),
      ],
      versions: [version('vB', '2', '2026-12-01', '102'), version('vC', '3', '2027-06-01', '103')],
    });
    expect(out.articles[0].content).toBe('v1');
    expect(out.articles[0].scheduled).toMatchObject({ content: 'v2', effectiveDate: '2026-12-01', versionId: 'vB', laterCount: 1 });
  });

  it('시행일에 신설될 조항은 현행 문구가 없고, 시행일에 삭제될 조항은 사라짐 표시가 있어도 현행으로 남는다', () => {
    const out = splitLawInForce({
      today: TODAY,
      articles: [row('7//', '새 조문'), row('8//', '없어질 조문', { deletedAt: new Date() })],
      events: [ev('7//', 'created', null, '새 조문', '2026-11-27'), ev('8//', 'deleted', '없어질 조문', null, '2026-11-27')],
      versions: [],
    });
    const [created, deleted] = out.articles;
    expect(created).toMatchObject({ nodeKey: '7//', content: null, scheduled: { changeType: 'created', content: '새 조문' } });
    expect(deleted).toMatchObject({ nodeKey: '8//', content: '없어질 조문', scheduled: { changeType: 'deleted', content: null } });
  });
});

describe('현행 판과 시행 예정 판 (T-150)', () => {
  it('현행 판은 시행 중인 판 가운데 공포 순으로 가장 늦은 것, 예정 판은 바뀌는 조항 수와 함께', () => {
    const out = splitLawInForce({
      today: TODAY,
      articles: [row('18//', 'x2'), row('19//', 'y2')],
      events: [ev('18//', 'modified', 'x1', 'x2', '2026-11-27', 'v21700'), ev('19//', 'modified', 'y1', 'y2', '2026-11-27', 'v21700')],
      versions: [
        version('vOld', '20250101', '2025-02-01', '20500'),
        version('vNow', '20260101', '2026-03-01', '21000'),
        version('v21700', '20261001', '2026-11-27', '21700'),
      ],
    });
    expect(out.current).toMatchObject({ id: 'vNow', promulgationNo: '21000', effectiveDate: '2026-03-01' });
    expect(out.scheduled).toHaveLength(1);
    expect(out.scheduled[0]).toMatchObject({ id: 'v21700', promulgationNo: '21700', effectiveDate: '2026-11-27', changeCount: 2 });
  });

  it('판 기록이 없는 옛 예정 변경은 시행일마다 판 없는 항목으로 묶고, 판 기록이 없으면 현행 판은 null', () => {
    const out = splitLawInForce({
      today: TODAY,
      articles: [row('1//', 'b'), row('2//', 'd')],
      events: [ev('1//', 'modified', 'a', 'b', '2026-12-01', null), ev('2//', 'modified', 'c', 'd', '2026-12-01', null)],
      versions: [],
    });
    expect(out.current).toBeNull();
    expect(out.scheduled).toEqual([expect.objectContaining({ id: null, effectiveDate: '2026-12-01', changeCount: 2 })]);
  });

  it('바뀌는 조항이 없는 시행 예정 판도 예정으로 보인다(판의 시행일이 오늘 뒤)', () => {
    const out = splitLawInForce({
      today: TODAY,
      articles: [row('1//', 'a')],
      events: [],
      versions: [version('vNow', '1', '2026-01-01', '1'), version('vNext', '2', '2027-01-01', '2')],
    });
    expect(out.current?.id).toBe('vNow');
    expect(out.scheduled.map((v) => [v.id, v.changeCount])).toEqual([['vNext', 0]]);
  });
});

describe('공포 순과 시행 순이 어긋날 때, 단계 시행 판 (T-150 검토)', () => {
  it('먼저 공포된 판 B 가 뒤에 공포된 판 C 보다 늦게 시행되면, 현행 문구는 공포 순으로 첫 예정 변경의 "전" 문구다 — C 의 "전"(= B 의 "후")은 아직 시행 전', () => {
    const out = splitLawInForce({
      today: TODAY,
      articles: [row('5//', 'X2')],
      events: [ev('5//', 'modified', 'X1', 'X2', '2026-12-01', 'vC'), ev('5//', 'modified', 'X0', 'X1', '2027-06-01', 'vB')],
      versions: [version('vB', '2', '2027-06-01', '102'), version('vC', '3', '2026-12-01', '103')],
    });
    expect(out.articles[0].content).toBe('X0');
    // 화면의 예정 표시는 가장 먼저 시행될 변경 — 공포 순서와 어긋난다는 표시와 함께(그 날의 문구에 앞 판의 시행 전 개정이 섞여 있다)
    expect(out.articles[0].scheduled).toMatchObject({ effectiveDate: '2026-12-01', versionId: 'vC', laterCount: 1, orderMismatch: true });
  });

  it('먼저 공포된 판이 그 조항을 신설하고 뒤 판이 먼저 시행되면, 아직 없는 조항이라 현행 문구가 없고 신설일(그 판의 시행일)을 보인다', () => {
    const out = splitLawInForce({
      today: TODAY,
      articles: [row('9//', 'Y2')],
      events: [ev('9//', 'created', null, 'Y1', '2027-06-01', 'vB'), ev('9//', 'modified', 'Y1', 'Y2', '2026-12-01', 'vC')],
      versions: [version('vB', '2', '2027-06-01', '102'), version('vC', '3', '2026-12-01', '103')],
    });
    expect(out.articles[0].content).toBeNull();
    expect(out.articles[0].scheduled).toMatchObject({ changeType: 'created', effectiveDate: '2027-06-01', content: 'Y1', versionId: 'vB', laterCount: 1, orderMismatch: true });
  });

  it('공포 순과 시행 순이 같으면 어긋남 표시가 없다', () => {
    const out = splitLawInForce({
      today: TODAY,
      articles: [row('5//', 'v3')],
      events: [ev('5//', 'modified', 'v1', 'v2', '2026-12-01', 'vB'), ev('5//', 'modified', 'v2', 'v3', '2027-06-01', 'vC')],
      versions: [version('vB', '2', '2026-12-01', '102'), version('vC', '3', '2027-06-01', '103')],
    });
    expect(out.articles[0].scheduled).toMatchObject({ orderMismatch: false });
  });

  it('단계 시행 판은 첫 단계가 지나면 현행이다 — 본문 시행일이 오늘 뒤여도(법제처 현행연혁코드 "현행"과 같은 기준)', () => {
    const out = splitLawInForce({
      today: TODAY,
      articles: [row('1//', 'a')],
      events: [],
      versions: [version('vStaged', '1', '2027-04-28', '291447', ['2026-10-27', '2027-01-28', '2027-04-28', '2027-10-28'])],
    });
    expect(out.current).toMatchObject({ id: 'vStaged', stageEffectiveDates: ['2026-10-27', '2027-01-28', '2027-04-28', '2027-10-28'] });
    expect(out.scheduled).toEqual([]);
  });

  it('단계가 모두 오늘 뒤인 판은 시행 예정이다', () => {
    const out = splitLawInForce({
      today: TODAY,
      articles: [row('1//', 'a')],
      events: [],
      versions: [version('vNow', '1', '2026-01-01', '1'), version('vLater', '2', '2027-07-01', '2', ['2027-01-01', '2027-07-01'])],
    });
    expect(out.current?.id).toBe('vNow');
    expect(out.scheduled.map((v) => v.id)).toEqual(['vLater']);
  });

  it('시행 예정 변경(이벤트)이 남은 판은 첫 단계가 지났어도 예정으로 둔다 — 조항의 계획용 시행일은 본문 시행일(D-17 결정 전 A안)', () => {
    const out = splitLawInForce({
      today: TODAY,
      articles: [row('3//', 'c2')],
      events: [ev('3//', 'modified', 'c1', 'c2', '2027-04-28', 'vS')],
      versions: [version('vNow', '1', '2026-01-01', '1'), version('vS', '2', '2027-04-28', '2', ['2026-10-01', '2027-04-28'])],
    });
    expect(out.current?.id).toBe('vNow');
    expect(out.scheduled).toEqual([expect.objectContaining({ id: 'vS', changeCount: 1 })]);
    expect(out.articles[0].content).toBe('c1');
  });
});
