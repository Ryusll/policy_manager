import { describe, it, expect } from 'vitest';
import { SUMMARY_LINES, summarize, type SummaryCandidate, type SummaryEvent } from '../apps/api/src/amendments/amendment-summary';
import { candidateListWhere } from '../apps/api/src/amendments/amendment-list-where';
import { groupImpactCounts, impactCounts } from '../apps/api/src/law-changes/law-link-reach';

/**
 * 대시보드 법령 개정 배너·메뉴 처리 대기 배지(T-158, SRS LAW-19, ADR-0021 결과) — 숫자만 센다.
 *
 * 막고 싶은 사고:
 * 1. 개정 한 판 안의 변경마다 조문을 세어 더해 같은 조문을 두 번 센다(조 머리 연결이 여러 항 개정을 받는 경우 — T-148)
 * 2. 처리 대기를 AI 의견·신뢰도로 거르거나, 배지 숫자가 개정 검토 화면 기본 목록과 다르다
 * 3. 법령 시행일이 지났는데 처리하지 않은 후보가 시행 예정 줄에 섞이거나 빠진다, 시행일 경계(오늘)가 법령 화면과 다르다
 */
const TODAY = '2026-11-08';
const ev = (id: string, date: string | null, o: Partial<SummaryEvent> = {}): SummaryEvent => ({
  id,
  lawId: 'law-1',
  lawVersionId: 'v1',
  lawEffectiveDate: date,
  lawName: '남녀고용평등과 일·가정 양립 지원에 관한 법률',
  shortTitle: '남녀고용평등법',
  version: { lawType: '법률', promulgationNo: '21700', revisionType: '일부개정' },
  ...o,
});

/** 처리 대기 후보 — 그 후보의 조문과 변경 */
const cand = (id: string, date: string | null, articleId = 'A', o: Partial<SummaryEvent> = {}): SummaryCandidate => ({ ...ev(id, date, o), articleId });
const none = () => new Set<string>();

describe('대시보드 법령 개정 숫자 (T-158)', () => {
  it('시행 예정 변경은 판 한 줄로 — 우리 조문은 판 안의 변경을 합쳐 한 번씩, 처리 대기 후보는 그 판의 후보 수, 약칭으로 보인다', () => {
    const asked: string[][] = [];
    const s = summarize({
      today: TODAY,
      pending: [cand('e1', '2026-11-27'), cand('e2', '2026-11-27')],
      upcoming: [ev('e1', '2026-11-27'), ev('e2', '2026-11-27')],
      articles: (ids) => (asked.push(ids), new Set(['A'])),
    });
    expect(s.upcoming).toEqual([
      { lawId: 'law-1', lawName: '남녀고용평등법', lawFullName: '남녀고용평등과 일·가정 양립 지원에 관한 법률', version: ev('x', null).version, effectiveDate: '2026-11-27', articles: 1, pending: 2 },
    ]);
    expect(asked).toEqual([['e1', 'e2']]); // 줄 하나에 한 번 — 변경마다 세어 더하지 않는다
    expect(s).toMatchObject({ pending: 2, overdue: 0, undated: 0, more: 0 });
  });

  it('법령 시행일이 오늘이거나 지났으면 시행 예정 줄이 아니라 "시행일 지난 미처리"로, 시행일이 없으면 총수에만', () => {
    const s = summarize({
      today: TODAY,
      pending: [cand('a', '2026-11-07'), cand('b', TODAY, 'A', { lawId: 'law-b' }), cand('c', '2026-11-09'), cand('d', null, 'A', { lawVersionId: null })],
      upcoming: [ev('c', '2026-11-09'), ev('b', TODAY, { lawId: 'law-b' })],
      articles: () => new Set(['A']),
    });
    expect(s).toMatchObject({ pending: 4, overdue: 2, undated: 1 });
    expect(s.upcoming.map((l) => [l.effectiveDate, l.pending])).toEqual([['2026-11-09', 1]]); // 오늘 시행은 이미 시행 중
  });

  it('줄은 법령·시행일로 묶는다 — 판 기록이 없는 변경도 같은 날 같은 법령이면 한 줄(판 표기는 기록 있는 변경에서), 약칭이 없으면 정식 제명', () => {
    const noVersion: Partial<SummaryEvent> = { lawVersionId: null, shortTitle: null, version: null };
    const s = summarize({
      today: TODAY,
      pending: [cand('a', '2026-12-01', 'A', noVersion), cand('b', '2026-12-01', 'B', { shortTitle: null }), cand('c', '2026-12-02', 'A', noVersion)],
      upcoming: [],
      articles: none,
    });
    expect(s.upcoming.map((l) => [l.lawName, l.effectiveDate, l.pending, l.articles, l.version?.promulgationNo ?? null])).toEqual([
      ['남녀고용평등과 일·가정 양립 지원에 관한 법률', '2026-12-01', 2, 2, '21700'],
      ['남녀고용평등과 일·가정 양립 지원에 관한 법률', '2026-12-02', 1, 1, null],
    ]);
  });

  it('같은 법령·같은 날 시행되는 판이 둘이면 판 표기를 하나로 단정하지 않는다(줄은 하나)', () => {
    const other = { lawType: '법률', promulgationNo: '22100', revisionType: '타법개정' };
    const s = summarize({ today: TODAY, pending: [cand('a', '2026-12-01'), cand('b', '2026-12-01', 'B', { lawVersionId: 'v2', version: other })], upcoming: [], articles: none });
    expect(s.upcoming).toHaveLength(1);
    expect(s.upcoming[0]).toMatchObject({ pending: 2, version: null });
  });

  it('우리 조문은 확정 연결이 닿는 조문과 처리 대기 후보 조문의 합집합 — 연결이 사라졌어도 "0개, 후보 2건"이 되지 않는다', () => {
    const orphan = summarize({ today: TODAY, pending: [cand('a', '2026-12-01', 'A'), cand('b', '2026-12-01', 'A')], upcoming: [], articles: none });
    expect(orphan.upcoming[0]).toMatchObject({ articles: 1, pending: 2 });
    const both = summarize({
      today: TODAY,
      pending: [cand('a', '2026-12-01', 'B')],
      upcoming: [ev('a', '2026-12-01')],
      articles: () => new Set(['A']),
    });
    expect(both.upcoming[0]).toMatchObject({ articles: 2, pending: 1 });
  });

  it('우리 조문도 처리 대기도 없는 줄은 뺀다 — 처리를 마쳤어도 우리 조문에 닿는 시행 예정 개정은 남긴다(법령 보기)', () => {
    const s = summarize({
      today: TODAY,
      pending: [],
      upcoming: [ev('linked', '2026-12-01', { lawVersionId: 'va' }), ev('none', '2026-12-02', { lawVersionId: 'vb' })],
      articles: (ids) => new Set(ids.includes('linked') ? ['A', 'B'] : []),
    });
    expect(s.upcoming.map((l) => [l.effectiveDate, l.articles, l.pending])).toEqual([['2026-12-01', 2, 0]]);
  });

  it(`시행일 빠른 순 ${SUMMARY_LINES}줄까지, 나머지는 수만`, () => {
    const dates = ['2026-12-05', '2026-11-20', '2027-01-01', '2026-11-10', '2026-12-31'];
    const pending = dates.map((d, i) => cand(`e${i}`, d, 'A', { lawVersionId: `v${i}` }));
    const s = summarize({ today: TODAY, pending, upcoming: [], articles: none });
    expect(s.upcoming.map((l) => l.effectiveDate)).toEqual(['2026-11-10', '2026-11-20', '2026-12-05']);
    expect(s.more).toBe(2);
    expect(s.pending).toBe(5);
  });

  it('처리 대기는 목록 기본 조건 그대로 — 작성·검토 전부, 회사와 조문의 실제 소속으로(AI 의견·신뢰도로 거르지 않는다)', () => {
    const where = candidateListWhere('t1', {});
    expect(where).toEqual({ tenantId: 't1', article: { chapter: { policy: { tenantId: 't1' } } }, reviewState: { in: ['draft', 'review'] } });
    expect(JSON.stringify(where)).not.toMatch(/confidence|reviewFlags|generationMethod/);
    expect(candidateListWhere('t1', { state: 'approved', policyId: 'p1', policyActive: 'active', changeEventId: 'e1' })).toEqual({
      tenantId: 't1',
      article: { chapter: { policy: { tenantId: 't1', id: 'p1', isActive: true } } },
      changeEventId: 'e1',
      reviewState: 'approved',
    });
    expect(candidateListWhere('t1', { state: 'all' })).not.toHaveProperty('reviewState');
  });

  it('판 단위 조문 수 — 조 머리 연결 하나가 두 항 개정을 받아도 1, 추천 연결은 확정에 넣지 않는다(T-148 규칙 그대로)', async () => {
    const links = [
      { lawArticleId: 'jo60', articleId: 'A', confirmState: 'confirmed' },
      { lawArticleId: 'hang602', articleId: 'B', confirmState: 'suggested' },
    ];
    const prisma = { lawLink: { findMany: () => Promise.resolve(links) } };
    const reach = new Map([
      ['e1', ['hang601', 'jo60']],
      ['e2', ['hang602', 'jo60']],
    ]);
    const group = await groupImpactCounts(prisma as never, 't1', reach);
    expect(group(['e1', 'e2'])).toEqual({ confirmed: 1, suggested: 1 });
    const each = await impactCounts(prisma as never, 't1', reach);
    expect(each('e1').confirmed + each('e2').confirmed).toBe(2); // 변경마다 더하면 두 번 — 그래서 묶음 함수가 따로 있다
    expect(each('e2')).toEqual({ confirmed: 1, suggested: 1 });
  });
});
