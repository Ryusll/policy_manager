import { describe, it, expect } from 'vitest';
import {
  finishRecentLines,
  lineKey,
  pickLineKeys,
  pickRecentLines,
  type LineCandidate,
  type LineEvent,
  type LineGroup,
} from '../apps/api/src/dashboard/recent-law-lines';

const ev = (over: Partial<LineEvent> & { id: string }): LineEvent => ({
  lawId: 'law-a',
  lawEffectiveDate: '2026-12-01',
  promulgatedDate: '2026-06-01',
  detectedAt: '2026-06-02T00:00:00.000Z',
  lawName: '남녀고용평등과 일ㆍ가정 양립 지원에 관한 법률',
  shortTitle: '남녀고용평등법',
  version: { lawType: '법률', promulgationNo: '21700', revisionType: '일부개정' },
  ...over,
});
const cand = (event: LineEvent, articleId: string, state: LineCandidate['state']): LineCandidate => ({ event, articleId, state });
const reach = (map: Record<string, string[]>) => (ids: string[]) => new Set(ids.flatMap((id) => map[id] ?? []));

describe('대시보드 최근 법령 개정 줄 (T-213, LAW-19 수정)', () => {
  it('법령·법령 시행일이 같은 변경은 한 줄 — 우리 조문은 확정 연결 도달 ∪ 후보 조문을 한 번씩 센다', () => {
    const e1 = ev({ id: 'e1' });
    const e2 = ev({ id: 'e2' }); // 같은 법령·같은 시행일의 다른 조항 변경
    const lines = finishRecentLines(
      pickRecentLines([e1, e2], [cand(e1, 'art-1', 'draft')]),
      reach({ e1: ['art-1', 'art-2'], e2: ['art-2', 'art-3'] }),
    );
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ lawName: '남녀고용평등법', lawFullName: e1.lawName, articles: 3, pending: 1, approved: 0, rejected: 0 });
  });

  it('후보 현황은 상태별로 — 대기(작성·검토)·승인·반려', () => {
    const e = ev({ id: 'e1' });
    const [line] = finishRecentLines(
      pickRecentLines([e], [cand(e, 'a1', 'draft'), cand(e, 'a2', 'review'), cand(e, 'a3', 'approved'), cand(e, 'a4', 'rejected')]),
      reach({}),
    );
    expect(line).toMatchObject({ pending: 2, approved: 1, rejected: 1, articles: 4 });
  });

  it('시행 전후를 가리지 않고 공포일이 늦은 순 — 공포일이 없으면 감지한 날(법령 시행일로 세우지 않는다)', () => {
    const lines = pickRecentLines(
      [
        ev({ id: 'old', lawId: 'L1', promulgatedDate: '2025-01-10', lawEffectiveDate: '2025-07-01' }),
        ev({ id: 'future', lawId: 'L2', promulgatedDate: '2026-11-01', lawEffectiveDate: '2027-06-10' }),
        // 공포일이 없고 감지는 6/2 — 법령 시행일(10/1)로 세우면 L4 보다 위로 간다
        ev({ id: 'noPromul', lawId: 'L3', promulgatedDate: null, lawEffectiveDate: '2026-10-01' }),
        ev({ id: 'nothing', lawId: 'L4', promulgatedDate: null, lawEffectiveDate: null, detectedAt: '2026-09-15T03:00:00.000Z' }),
        // 공포일 없이 먼 미래에 시행되는 오래전 감지 — 맨 위에 붙지 않는다
        ev({ id: 'far', lawId: 'L5', promulgatedDate: null, lawEffectiveDate: '2030-01-01', detectedAt: '2024-01-01T00:00:00.000Z' }),
      ],
      [],
      10,
    );
    expect(lines.map((l) => l.lawId)).toEqual(['L2', 'L4', 'L3', 'L1', 'L5']);
  });

  it('감지한 날은 한국 날짜다 — 한국 시간 0~9시 감지가 전날로 가지 않는다', () => {
    // A 는 UTC 9/14 16시 = 한국 9/15 01시. UTC 로 자르면 B(공포 9/14)와 같은 날이 되어 늦게 감지한 B 가 위로 간다
    const a = ev({ id: 'a', lawId: 'LA', promulgatedDate: null, lawEffectiveDate: null, detectedAt: '2026-09-14T16:00:00.000Z' });
    const b = ev({ id: 'b', lawId: 'LB', promulgatedDate: '2026-09-14', lawEffectiveDate: null, detectedAt: '2026-09-20T00:00:00.000Z' });
    const lines = finishRecentLines(pickRecentLines([b, a], []), reach({}));
    expect(lines.map((l) => l.lawId)).toEqual(['LA', 'LB']);
    expect(lines[0].detectedDate).toBe('2026-09-15');
  });

  it('법령 시행일이 없는 변경은 공포일로 가른다 — 서로 다른 개정을 한 줄로 합치지 않는다', () => {
    const lines = pickRecentLines(
      [
        ev({ id: 'u1', lawEffectiveDate: null, promulgatedDate: '2026-03-01' }),
        ev({ id: 'u2', lawEffectiveDate: null, promulgatedDate: '2026-05-01' }),
        ev({ id: 'u3', lawEffectiveDate: null, promulgatedDate: '2026-05-01' }), // 같은 개정의 다른 조항
        // 시행일이 있으면 시행일 줄(공포일이 같아 늦게 감지한 것이 위로)
        ev({ id: 'd1', lawEffectiveDate: '2026-12-01', promulgatedDate: '2026-05-01', detectedAt: '2026-06-03T00:00:00.000Z' }),
      ],
      [],
    );
    expect(lines.map((l) => [l.key, [...l.eventIds].sort()])).toEqual([
      ['law-a|2026-12-01', ['d1']],
      ['law-a||2026-05-01', ['u2', 'u3']],
      ['law-a||2026-03-01', ['u1']],
    ]);
    // 공포일도 없으면 감지한 날(한국 날짜)로 — UTC 9/14 16시 = 한국 9/15
    expect(lineKey({ lawId: 'L', lawEffectiveDate: null, promulgatedDate: null, detectedAt: '2026-09-14T16:00:00.000Z' })).toBe('L||@2026-09-15');
  });

  it('법령 시행일·공포일이 둘 다 없는 변경은 감지한 날(한국 날짜)로 가른다 — 같은 날 감지한 것만 한 줄', () => {
    const bare = (id: string, detectedAt: string) => ev({ id, lawEffectiveDate: null, promulgatedDate: null, detectedAt });
    const lines = pickRecentLines([bare('a', '2026-09-14T16:00:00.000Z'), bare('b', '2026-09-15T05:00:00.000Z'), bare('c', '2026-09-20T01:00:00.000Z')], []);
    expect(lines.map((l) => [l.key, [...l.eventIds].sort()])).toEqual([
      ['law-a||@2026-09-20', ['c']],
      ['law-a||@2026-09-15', ['a', 'b']], // 한국 날짜로는 둘 다 9/15
    ]);
    const keys = pickLineKeys(
      [
        { lawId: 'law-a', lawEffectiveDate: null, promulgatedDate: null, detectedAt: '2026-09-14T16:00:00.000Z' },
        { lawId: 'law-a', lawEffectiveDate: null, promulgatedDate: null, detectedAt: '2026-09-20T01:00:00.000Z' },
      ],
      () => '법',
    );
    expect(keys.map((k) => [k.key, k.detectedDay])).toEqual([
      ['law-a||@2026-09-20', '2026-09-20'],
      ['law-a||@2026-09-15', '2026-09-15'],
    ]);
  });

  it('DB 묶음 값으로 고른 줄(pickLineKeys)은 변경을 다 읽어 고른 줄과 같은 줄·같은 순서다', () => {
    const events = [
      // 같은 시행일의 두 묶음 — 줄의 공포일은 늦은 쪽(2/10)이라 위로 간다. 먼저 본 묶음(2025-01-05)으로 세우면 맨 아래로 떨어진다
      ev({ id: 'e1', lawId: 'L1', promulgatedDate: '2025-01-05', lawEffectiveDate: '2026-07-01' }),
      ev({ id: 'e2', lawId: 'L1', promulgatedDate: '2026-02-10', lawEffectiveDate: '2026-07-01' }),
      ev({ id: 'e3', lawId: 'L2', promulgatedDate: null, lawEffectiveDate: '2027-01-01', detectedAt: '2026-03-01T20:00:00.000Z' }),
      ev({ id: 'e4', lawId: 'L3', promulgatedDate: '2026-02-05', lawEffectiveDate: '2026-08-01', lawName: '가나다법' }),
      ev({ id: 'e5', lawId: 'L4', promulgatedDate: null, lawEffectiveDate: null, detectedAt: '2025-12-31T23:00:00.000Z' }),
      ev({ id: 'e6', lawId: 'L5', promulgatedDate: '2025-06-01', lawEffectiveDate: '2025-12-01' }),
      ev({ id: 'e7', lawId: 'L6', promulgatedDate: '2026-02-05', lawEffectiveDate: '2026-09-01', lawName: '가나다법' }),
      // 날짜가 둘 다 없는 변경 — DB 는 하나씩 돌려준다(감지한 날로 가른다)
      ev({ id: 'e8', lawId: 'L7', promulgatedDate: null, lawEffectiveDate: null, detectedAt: '2026-02-20T16:30:00.000Z' }),
      ev({ id: 'e9', lawId: 'L7', promulgatedDate: null, lawEffectiveDate: null, detectedAt: '2025-11-01T00:00:00.000Z' }),
    ];
    // DB 의 groupBy(법령, 법령 시행일, 공포일) + max(감지 시각)를 흉내 낸다
    const groups = new Map<string, LineGroup>();
    for (const e of events) {
      const k = e.lawEffectiveDate || e.promulgatedDate ? `${e.lawId}|${e.lawEffectiveDate}|${e.promulgatedDate}` : e.id;
      const g = groups.get(k);
      if (!g || g.detectedAt < e.detectedAt) groups.set(k, { lawId: e.lawId, lawEffectiveDate: e.lawEffectiveDate, promulgatedDate: e.promulgatedDate, detectedAt: e.detectedAt });
    }
    const nameOf = new Map(events.map((e) => [e.lawId, e.lawName]));
    for (const limit of [3, 5, 10]) {
      const keys = pickLineKeys([...groups.values()], (id) => nameOf.get(id) ?? '', limit).map((k) => k.key);
      expect(keys, String(limit)).toEqual(pickRecentLines(events, [], limit).map((l) => l.key));
    }
  });

  it('다섯 줄까지만 고른다', () => {
    const many = Array.from({ length: 8 }, (_, i) => ev({ id: `e${i}`, lawId: `L${i}`, promulgatedDate: `2026-0${i + 1}-01` }));
    const lines = pickRecentLines(many, []);
    expect(lines).toHaveLength(5);
    expect(lines[0].lawId).toBe('L7');
  });

  it('같은 날 시행되는 판이 둘 이상이면 판 표기를 단정하지 않는다', () => {
    const a = ev({ id: 'a', version: { lawType: '법률', promulgationNo: '100', revisionType: '일부개정' } });
    const b = ev({ id: 'b', version: { lawType: '법률', promulgationNo: '101', revisionType: '타법개정' } });
    const [line] = finishRecentLines(pickRecentLines([a, b], []), reach({}));
    expect(line.version).toBeNull();
    const [single] = finishRecentLines(pickRecentLines([a], []), reach({}));
    expect(single.version).toEqual(a.version);
  });

  it('연결을 지운 뒤에도 후보가 있는 변경은 줄이 된다 — 그 후보의 조문은 우리 조문이다', () => {
    const gone = ev({ id: 'gone', lawId: 'L9' });
    const [line] = finishRecentLines(pickRecentLines([], [cand(gone, 'art-9', 'approved')]), reach({}));
    expect(line).toMatchObject({ lawId: 'L9', articles: 1, approved: 1 });
  });

  it('도달 계산은 고른 줄의 확정 연결 변경에 대해서만 부른다', () => {
    const asked: string[][] = [];
    const lines = pickRecentLines([ev({ id: 'x', lawId: 'LX' })], [cand(ev({ id: 'y', lawId: 'LY' }), 'a', 'draft')]);
    finishRecentLines(lines, (ids) => {
      asked.push(ids);
      return new Set();
    });
    expect(asked).toEqual([['x']]); // 후보만 있는 줄(LY)은 도달 계산을 부르지 않는다
  });

  it('빈 입력은 빈 줄', () => {
    expect(finishRecentLines(pickRecentLines([], []), reach({}))).toEqual([]);
  });
});
