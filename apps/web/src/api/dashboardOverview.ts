import client from './client';

/** 대시보드 지표 카드·법령 개정 구역의 숫자 — `GET /dashboard/overview` (T-213, SRS LAW-29·LAW-19 수정, 관리자·편집자) */
export type RecentLawLine = {
  /** 줄 구분 — 같은 법령의 줄이 여럿일 수 있다 */
  key: string;
  lawId: string;
  /** 약칭이 있으면 약칭 */
  lawName: string;
  lawFullName: string;
  promulgatedDate: string | null;
  effectiveDate: string | null;
  /** 줄의 변경을 마지막으로 감지한 날 — 공포일이 없으면 이 날로 줄을 세운다(그때 화면에도 보인다) */
  detectedDate: string;
  /** 우리 조문 수 — 확정 연결로 닿는 조문 ∪ 그 줄의 후보 조문 */
  articles: number;
  pending: number;
  approved: number;
  rejected: number;
};

export type DashboardOverview = {
  policies: { active: number; inactive: number; articlesInForce: number };
  links: {
    confirmedLinks: number;
    suggestedLinks: number;
    linkedLaws: number;
    /** 연결 법령의 마지막 확인(성공) 가운데 가장 오래된 시각 */
    oldestCheckedAt: string | null;
    failedLaws: number;
    uncheckedLaws: number;
  };
  candidates: { draft: number; review: number };
  scheduled: { amend: number; repeal: number };
  recentLawChanges: RecentLawLine[];
};

/**
 * 'amendments' 로 시작한다 — 연결 확정·수정·삭제, 후보 만들기·승인·반려 뒤에 `invalidateAmendmentCounts`(배너·배지)가
 * 다시 읽게 하는 묶음에 같이 든다(SRS LAW-29 '숫자가 바뀌는 동작 뒤에는 배너·배지와 함께 다시 읽는다').
 */
export const DASHBOARD_OVERVIEW_KEY = ['amendments', 'dashboard'] as const;

export const dashboardOverviewApi = {
  get: (): Promise<DashboardOverview> => client.get('/dashboard/overview').then((r) => r.data),
};
