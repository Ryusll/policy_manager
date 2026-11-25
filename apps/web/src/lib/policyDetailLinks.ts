import { VIEWER_HOME, roleCanOpen } from './viewerAccess';
import { fullViewArticleClass } from '../components/policy-template/templateUtils';

/** 목차 패널 id — 위쪽 줄 목차 토글의 aria-controls 가 가리킨다(패널은 PolicyDetailPage) */
export const POLICY_TOC_PANEL_ID = 'policy-toc-panel';

/**
 * 규정 상세에서 '목록으로' 가는 곳(T-215, SRS POLICY-13) — 규정 목록을 열 수 있는 역할이면 규정 목록, 아니면(열람자) 통합검색.
 * 판정은 PrivateRoute 와 같은 lib/viewerAccess — 열람자가 눌러 통합검색으로 튕기는 링크를 두지 않는다.
 * 이름 키는 상단 메뉴와 같은 것을 쓴다(같은 대상을 다른 이름으로 부르지 않는다).
 */
export function backToListLink(role: string | null | undefined): { to: string; labelKey: string } {
  return roleCanOpen(role, '/policies') ? { to: '/policies', labelKey: 'layout.nav.policies' } : { to: VIEWER_HOME, labelKey: 'layout.nav.search' };
}

type ArticleNo = { number?: number | null; branchNumber?: number | null };

/**
 * 전문 보기에서 한 조의 묶음을 찾는 선택자 — 조 묶음 클래스(`tmpl-art-3`, 가지 조 `tmpl-art-3-2`)는 화면 렌더러와 HTML 양식이
 * 같이 단다(templateUtils fullViewArticleClass). 양식 HTML 정화가 data-* 를 지우므로 클래스로 찾는다. 항·호 행을 골라도 그 조로 간다.
 */
export function fullViewArticleSelector(article: ArticleNo): string | null {
  if (!(Number(article.number) > 0)) return null;
  return `.${fullViewArticleClass(article.number, article.branchNumber)}`;
}

type ChapterRows = { articles?: ({ id: string } & ArticleNo)[] | null }[] | null | undefined;

/**
 * 전문 보기 안에서 갈 조 — 지금 그려진 본문(현행이면 현행, 시점 조회면 그 시점 본문)에서 같은 조문 행을 찾아 그 본문의 번호를 쓴다.
 * 조문 선택·목차는 현행 행 목록이라, 시점 본문에 없는 행(그 날짜 뒤에 생긴 조)이면 null — 부르는 쪽이 알린다(T-215 2차 검토).
 */
export function resolveFullViewJump(articleId: string, shownChapters: ChapterRows): ({ id: string } & ArticleNo) | null {
  for (const ch of shownChapters ?? []) {
    const row = (ch.articles ?? []).find((a) => a.id === articleId);
    if (row) return fullViewArticleSelector(row) ? { id: row.id, number: row.number, branchNumber: row.branchNumber } : null;
  }
  return null;
}

export type FullViewJumpPlan = { kind: 'blocked' } | { kind: 'missing' } | { kind: 'go'; target: { id: string } & ArticleNo };

/**
 * 전문 보기 안 이동을 어떻게 할지 — 시점 본문을 받는 중(또는 받지 못함)이면 보류(부르는 쪽이 받은 뒤 다시 부른다),
 * 그려진 본문에 없는 조면 알림, 아니면 그 조로.
 */
export function planFullViewJump(articleId: string, o: { asOfBlocked: boolean; shownChapters: ChapterRows }): FullViewJumpPlan {
  if (o.asOfBlocked) return { kind: 'blocked' };
  const target = resolveFullViewJump(articleId, o.shownChapters);
  return target ? { kind: 'go', target } : { kind: 'missing' };
}
