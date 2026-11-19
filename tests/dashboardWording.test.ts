import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { dashboardMessages } from '../apps/web/src/i18n/messages.dashboard';
import { messages } from '../apps/web/src/i18n/messages';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { DASHBOARD_OVERVIEW_KEY, type DashboardOverview } from '../apps/web/src/api/dashboardOverview';
import { AMENDMENT_SUMMARY_KEY } from '../apps/web/src/api/amendmentSummary';
import LawAmendmentSection from '../apps/web/src/components/dashboard/LawAmendmentSection';

/*
 * 대시보드 문구·구성 (T-213, SRS LAW-29·LAW-19 수정) — 화면은 렌더 시험 환경이 없어 문구 표와 원문으로 본다.
 */

const ROOT = join(__dirname, '..');
const src = (p: string) => readFileSync(join(ROOT, p), 'utf8');
const ko = dashboardMessages.ko as Record<string, string>;
const en = dashboardMessages.en as Record<string, string>;

describe('대시보드 문구 (T-213)', () => {
  it('화면별 문구 파일의 키는 ko·en 짝이 맞다', () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(ko).sort());
  });

  it('messages.ts 가 펼쳐 넣은 키를 뒤에서 다시 정의해 덮지 않는다', () => {
    for (const [k, v] of Object.entries(ko)) expect(messages.ko[k], k).toBe(v);
    for (const [k, v] of Object.entries(en)) expect(messages.en[k], k).toBe(v);
  });

  it("'실시간'·위험·리스크·등급·'자동 매핑'·'충돌 판정'을 쓰지 않는다(LAW-17·LAW-23·영업 문구 기준표) — 대시보드에 그려지는 키 전부, ko·en", () => {
    // 화면별 문구 파일의 키만이 아니라 messages.ts 쪽 대시보드 키(배너 dashboard.lawBanner.* 등)와 구역에 뜨는 동기화 멈춤 안내까지
    const shown = (table: Record<string, string>) => Object.entries(table).filter(([k]) => k.startsWith('dashboard.') || k === 'lawSync.stale.laws');
    const koShown = shown(messages.ko as Record<string, string>);
    expect(koShown.map(([k]) => k)).toEqual(expect.arrayContaining(['dashboard.lawBanner.upcoming', 'lawSync.stale.laws', ...Object.keys(ko)]));
    for (const [k, v] of koShown) expect(v, k).not.toMatch(/실시간|위험|리스크|등급|자동\s*매핑|충돌\s*판정|감시/);
    for (const [k, v] of shown(messages.en as Record<string, string>)) {
      expect(v, k).not.toMatch(/real-?\s*time|\blive\b|\brisk|rating|\bgrade|auto-?\s*mapping|conflict|monitor/i);
    }
  });

  it('대시보드 화면에 한국어 문구를 직접 적지 않는다(최근 개정·제·개정 예고 구역 포함) — 옛 카드 넷(전체·시행중·비활성·권한)은 없앴다', () => {
    const page = src('apps/web/src/pages/DashboardPage.tsx');
    expect(page).not.toMatch(/>\s*(최근 개정|제·개정 예고|전체)\s*</);
    expect(page).not.toMatch(/일 후 시행|조문 \{item|개정일이 기록된|시행 예정인 규정이/);
    expect(page).not.toContain('dashboard.stat.');
    expect(messages.ko['dashboard.stat.role']).toBeUndefined();
    expect(page).toContain('<DashboardStatCards />');
    expect(page).toContain('<LawAmendmentSection />');
    expect(page).toContain('id="dashboard-scheduled"');
  });

  it("집계 조회 키는 'amendments' 로 시작한다 — 연결·후보 동작 뒤 배너·배지와 함께 다시 읽힌다(SRS LAW-29)", () => {
    expect(DASHBOARD_OVERVIEW_KEY[0]).toBe('amendments');
    expect(src('apps/web/src/api/amendmentSummary.ts')).toMatch(/invalidateQueries\(\{\s*queryKey:\s*\['amendments'\]/);
  });

  it('제·개정 예고 구역은 관리자·편집자에게 늘 있다(카드가 가리키는 곳), 조문 시행 예정을 못 받으면 알린다', () => {
    const page = src('apps/web/src/pages/DashboardPage.tsx');
    expect(page).toContain('{(canCreate || revised.length > 0 || upcoming.length > 0) && (');
    expect(page).toContain('const { data: scheduledChanges = [], isError: scheduledFailed } = useQuery({');
    expect(page).toMatch(/\{scheduledFailed && \([\s\S]{0,160}t\('dashboard\.upcoming\.loadFailed'\)/);
    // 못 받았으면 '시행 예정인 규정이 없습니다'라고 단정하지 않는다
    expect(page).toMatch(/scheduledFailed \? null : <p[^>]*>\{t\('dashboard\.upcoming\.empty'\)\}/);
  });

  it('법령 개정 구역은 처리할 것이 없어도 그린다 — 숨기는 조건 없이 배너(T-158 줄)를 안에 둔다', () => {
    const section = src('apps/web/src/components/dashboard/LawAmendmentSection.tsx');
    // 배너는 집계 상태와 따로 그린다 — 집계가 실패했을 때만 배너의 오류 줄을 접는다
    expect(section).toContain('<LawAmendmentBanner hideError={isError} />');
    expect(section).toContain("t('dashboard.law.noPending')");
    expect(section).toContain('<LawSyncStaleNotice scope="laws" />');
    expect(section).not.toMatch(/return null/);
  });
});

const OVERVIEW: DashboardOverview = {
  policies: { active: 3, inactive: 1, articlesInForce: 40 },
  links: { confirmedLinks: 5, suggestedLinks: 2, linkedLaws: 4, oldestCheckedAt: '2026-11-01T00:00:00.000Z', failedLaws: 1, uncheckedLaws: 0 },
  candidates: { draft: 0, review: 0 },
  scheduled: { amend: 1, repeal: 0 },
  recentLawChanges: [
    {
      key: 'L1|2026-12-01',
      lawId: 'L1',
      lawName: '근로기준법',
      lawFullName: '근로기준법',
      promulgatedDate: '2026-06-01',
      effectiveDate: '2026-12-01',
      detectedDate: '2026-06-02',
      articles: 2,
      pending: 0,
      approved: 1,
      rejected: 0,
    },
  ],
};

/** 구역을 조회 상태별로 그린다 — 집계(overview)와 배너 요약(summary)을 캐시에 넣어 둔다 */
function renderSection(opts: { overview?: DashboardOverview; overviewError?: boolean; summaryPending?: number; summaryError?: boolean }) {
  const client = new QueryClient();
  // 실패한 상태 — TanStack 은 이전 값(data)이 있으면 남긴 채 error 로 둔다
  const fail = (key: readonly string[], data: unknown) => {
    client.getQueryCache().build(client, { queryKey: key }).setState({ status: 'error', data, error: new Error('fail'), fetchStatus: 'idle' });
  };
  if (opts.overviewError) fail(DASHBOARD_OVERVIEW_KEY, opts.overview);
  else if (opts.overview) client.setQueryData(DASHBOARD_OVERVIEW_KEY, opts.overview);
  const summary = { pending: opts.summaryPending ?? 0, overdue: 0, undated: 0, upcoming: [], moreUpcoming: 0 };
  // 값이 없는 오류는 서버 그리기에서 '다시 받는 중'으로 그려진다(TanStack 이 마운트 때 다시 받는다) — 다시 읽기 실패(이전 값 있음)로 둔다
  if (opts.summaryError) fail(AMENDMENT_SUMMARY_KEY, summary);
  else if (opts.summaryPending !== undefined) client.setQueryData(AMENDMENT_SUMMARY_KEY, summary);
  return renderToStaticMarkup(
    createElement(QueryClientProvider, { client }, createElement(MemoryRouter, null, createElement(LawAmendmentSection))),
  );
}

describe('법령 개정 구역 그리기 — 불러오는 중·실패·처리 대기 없음 (T-213)', () => {
  const ko = messages.ko as Record<string, string>;

  it('받기 전에는 불러오는 중을 보이고 본문·최근 개정은 그리지 않는다', () => {
    const html = renderSection({});
    expect(html).toContain('data-testid="dashboard-law-section"');
    expect(html).toContain(ko['dashboard.law.loading']);
    expect(html).not.toContain('dashboard-law-status');
    expect(html).not.toContain('dashboard-recent-laws');
  });

  it('받으면 확인 상태·최근 개정을 그리고, 배너 요약의 처리 대기가 0 일 때만 처리 대기 없음', () => {
    const none = renderSection({ overview: OVERVIEW, summaryPending: 0 });
    expect(none).toContain('data-testid="dashboard-law-status"');
    expect(none).toContain('data-testid="dashboard-recent-law-line"');
    expect(none).toContain(ko['dashboard.law.noPending']);
    expect(none).not.toContain(ko['dashboard.law.loading']);
    // 집계의 후보 수가 0 이어도 배너 요약이 처리 대기를 말하면 '없음'이라 하지 않는다(서로 다른 시점의 숫자로 엇갈리지 않게)
    expect(renderSection({ overview: OVERVIEW, summaryPending: 2 })).not.toContain(ko['dashboard.law.noPending']);
    // 요약을 아직 못 받았으면 단정하지 않는다
    expect(renderSection({ overview: OVERVIEW })).not.toContain(ko['dashboard.law.noPending']);
  });

  it('집계 다시 읽기가 실패하면 옛 숫자·최근 개정을 감추고 오류 한 줄 — 배너 요약은 따로라 처리 대기 없음은 요약대로', () => {
    const html = renderSection({ overview: OVERVIEW, overviewError: true, summaryPending: 0 });
    expect(html.split(ko['dashboard.law.loadFailed']).length - 1).toBe(1);
    expect(html).not.toContain('dashboard-law-status');
    expect(html).not.toContain('dashboard-law-unverified');
    expect(html).not.toContain('dashboard-recent-laws');
    expect(html).toContain(ko['dashboard.law.noPending']);
  });

  it('집계가 실패하거나 아직 오지 않아도 배너(T-158 줄)는 요약대로 보인다 — 처리 대기 줄이 사라지지 않게', () => {
    const review = ko['dashboard.lawBanner.review'].replace('{count}', '2');
    const failed = renderSection({ overview: OVERVIEW, overviewError: true, summaryPending: 2 });
    expect(failed).toContain('data-testid="law-amendment-banner"');
    expect(failed).toContain(review);
    expect(failed.split(ko['dashboard.law.loadFailed']).length - 1).toBe(1);
    const loading = renderSection({ summaryPending: 2 });
    expect(loading).toContain(ko['dashboard.law.loading']);
    expect(loading).toContain(review);
  });

  it('집계와 요약이 둘 다 실패하면 오류는 한 줄만 — 배너의 오류 줄은 접는다', () => {
    const html = renderSection({ overview: OVERVIEW, overviewError: true, summaryError: true });
    expect(html.match(/법령 개정 현황을 불러오지 못했습니다/g) ?? []).toHaveLength(1);
    // 집계만 성공하면 배너는 제 오류 줄을 보인다
    const bannerOnly = renderSection({ overview: OVERVIEW, summaryError: true });
    expect(bannerOnly).toContain(ko['dashboard.lawBanner.loadFailed']);
    expect(bannerOnly).toContain('data-testid="dashboard-law-status"');
    // 요약 다시 읽기가 실패하면 남은 0 으로 '없습니다'라고 하지 않는다 — 대기 후보가 있는데 0건처럼 보이지 않게
    expect(html).not.toContain(ko['dashboard.law.noPending']);
    expect(bannerOnly).not.toContain(ko['dashboard.law.noPending']);
  });
});
