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
