import { Injectable } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import { todayDateOnly } from '../common/date-only';
import { readSnapshot, type SnapshotLabel } from '../common/read-snapshot';
import { listScheduledGroups, scheduledTotals } from '../policies/scheduled-groups';
import { candidateCounts, linkStatus, policyCounts, recentLawChanges } from './dashboard-counts';
import type { RecentLawLine } from './recent-law-lines';

/** 제한을 넘기면 503 — 로그에는 'dashboard' 로, 사용자에게는 현황 숫자 문구로(규정 본문 문구가 아니라) */
export const DASHBOARD_SNAPSHOT: SnapshotLabel = {
  name: 'dashboard',
  timeoutMessage: '현황 숫자를 읽는 데 너무 오래 걸려 멈췄습니다 — 잠시 뒤 다시 시도하세요.',
};

/** 대시보드 지표 카드·법령 개정 구역의 숫자 (T-213, SRS LAW-29·LAW-19 수정) */
export type DashboardOverview = {
  /** ① 관리 규정 — 활성·비활성 규정 수, 활성 규정의 오늘 시행 중인 조 수 */
  policies: { active: number; inactive: number; articlesInForce: number };
  /** ② 연결 법령 — 확정 연결이 닿는 법령 수·확정 연결 수·추천 연결 수, 그 법령들의 확인 상태(법령별 '마지막 확인') */
  links: {
    confirmedLinks: number;
    suggestedLinks: number;
    linkedLaws: number;
    /** 연결 법령의 마지막 확인(성공) 가운데 가장 오래된 시각 — 확인에 성공한 법령이 없으면 null */
    oldestCheckedAt: string | null;
    failedLaws: number;
    uncheckedLaws: number;
  };
  /** ③ 개정 검토 대기 — 작성·검토(합 = 메뉴 배지·개정 검토 기본 목록 건수) */
  candidates: { draft: number; review: number };
  /** ④ 사내 시행 예정 — 제·개정 예고 목록과 같은 조건·같은 단위(조문 행), 상한 없이 */
  scheduled: { amend: number; repeal: number };
  /** 최근 법령 개정 다섯 줄 */
  recentLawChanges: RecentLawLine[];
};

@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 한 스냅숏으로 읽는다 — 카드끼리, 카드와 구역이 서로 다른 시점의 숫자를 보이지 않게. 규정 본문과 같은 `readSnapshot`
   * (읽기 전용 REPEATABLE READ, 문장마다 DB 쪽 제한, 시작 대기·제한을 넘기면 503 — 읽기만 하니 다시 시도하면 된다).
   */
  overview(tenantId: string, today = todayDateOnly()): Promise<DashboardOverview> {
    return readSnapshot(
      this.prisma,
      async (db) => ({
        policies: await policyCounts(db, tenantId, today),
        links: await linkStatus(db, tenantId),
        candidates: await candidateCounts(db, tenantId),
        scheduled: scheduledTotals(await listScheduledGroups(db, tenantId, today)),
        recentLawChanges: await recentLawChanges(db, tenantId),
      }),
      DASHBOARD_SNAPSHOT,
    );
  }
}
