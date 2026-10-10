import { serviceToday } from './serviceDate';

/**
 * 버전·조문의 "현재" 표시 (T-127).
 *
 * 서버가 규정 상세에 싣는 오늘 시행본(`versions[0]`)과 시행 예정(`scheduledVersions`)을 기준으로 붙인다.
 * 상태(status)만 보고 붙이면 틀린다: 미래 시행일로 개정을 승인하면 지금 시행 중인 버전은 `archived`,
 * 아직 시행 전인 버전이 `published` 다. 예전에는 그대로 "이전 버전"·"시행중"으로 거꾸로 보였다.
 */
export type VersionDisplayState = 'in_force' | 'scheduled' | 'superseded' | 'repealed' | 'draft' | 'review';

export const VERSION_STATE_LABEL: Record<VersionDisplayState, string> = {
  in_force: '시행중',
  scheduled: '시행 예정',
  superseded: '이전 버전',
  repealed: '폐지',
  draft: '초안',
  review: '검토중',
};

export const VERSION_STATE_BADGE: Record<VersionDisplayState, string> = {
  in_force: 'badge-published',
  scheduled: 'badge-scheduled',
  superseded: 'badge-archived',
  repealed: 'badge-archived',
  draft: 'badge-draft',
  review: 'badge-review',
};

type VersionLike = { id?: string; status: string; effectiveDate?: string | null; repealedOn?: string | null };
const dayOf = (d?: string | null) => (d ? String(d).slice(0, 10) : null);

/**
 * 버전 하나의 표시 상태.
 * @param opts.currentId 그 조문의 오늘 시행본 id(`article.versions[0]?.id`). 모르면 `undefined` — 그때는 날짜로만 가른다.
 */
export function versionDisplayState(
  v: VersionLike,
  opts: { currentId?: string | null; today?: string } = {},
): VersionDisplayState {
  if (v.status === 'draft') return 'draft';
  if (v.status === 'review') return 'review';
  const today = opts.today ?? serviceToday();
  const repealed = dayOf(v.repealedOn);
  if (repealed && repealed <= today) return 'repealed';
  if (opts.currentId && v.id === opts.currentId) return 'in_force';
  const effective = dayOf(v.effectiveDate);
  if (effective && effective > today) return 'scheduled';
  if (opts.currentId === undefined && v.status === 'published') return 'in_force';
  return 'superseded';
}

type VersionRowLike = {
  id?: string;
  content?: string | null;
  versionNum?: number;
  effectiveDate?: string | null;
  changeNote?: string | null;
};
type ArticleLike = {
  versions?: VersionRowLike[];
  scheduledVersions?: VersionRowLike[];
  pendingVersion?: { status: string; content?: string | null } | null;
  currentState?: 'in_force' | 'repealed' | 'scheduled' | 'none';
  /** 폐지일(YYYY-MM-DD) — 오늘 폐지 상태일 때만 */
  repealedOn?: string | null;
};
/** 규정 상세(GET /policies/:id)의 조문 모양 중 현재·시행 예정 표시에 쓰는 부분 */
export type CurrentViewArticle = ArticleLike;

/** 목차·본문 머리의 상태 배지 — 오늘 시행본 → 폐지 → 시행 예정 → 초안·검토중 순으로 하나 */
export function articleBadgeState(article: ArticleLike): VersionDisplayState | null {
  if (article.versions?.[0]) return 'in_force';
  if (article.currentState === 'repealed') return 'repealed';
  if (article.scheduledVersions?.length) return 'scheduled';
  const pending = article.pendingVersion?.status;
  if (pending === 'draft' || pending === 'review') return pending;
  return null;
}

/** 가장 이른 시행 예정 버전 — 본문에 "시행 예정" 표시를 붙일 때(받은 버전 모양 그대로 돌려준다) */
type ScheduledLike = {
  id?: string;
  status: string;
  versionNum?: number;
  effectiveDate?: string | null;
  content?: string | null;
  publishedAt?: string | null;
  publishedAtFromApproval?: boolean;
};
export function nextScheduled<V = ScheduledLike>(article: { scheduledVersions?: V[] } | null | undefined): V | null {
  return article?.scheduledVersions?.[0] ?? null;
}

/**
 * 새 초안의 바탕 — **가장 늦은 시행 예정 본문**, 없으면 오늘 시행본.
 * 오늘 본문으로 초안을 만들어 승인하면 시행 예정 개정을 잃는다(그 개정 위에 고쳐야 한다).
 */
export function articleDraftBase(article: ArticleLike): {
  content: string;
  kind: 'scheduled' | 'current' | 'none';
  versionNum: number | null;
  effectiveDate: string | null;
} {
  const scheduled = article.scheduledVersions?.length ? article.scheduledVersions[article.scheduledVersions.length - 1] : null;
  const base = scheduled ?? article.versions?.[0] ?? null;
  return {
    content: String(base?.content ?? ''),
    kind: scheduled ? 'scheduled' : base ? 'current' : 'none',
    versionNum: base?.versionNum ?? null,
    effectiveDate: dayOf(base?.effectiveDate),
  };
}

/**
 * "시행 전 초안만 있는" 조문 — 한꺼번에 시행(publish-drafts)이 시행할 조문과 같은 뜻.
 * 시행 예정 버전이 있는 조문은 이미 승인된 버전이 있어 한꺼번에 시행 대상이 아니다.
 */
export function isDraftOnlyArticle(article: ArticleLike): boolean {
  return !article.versions?.[0] && !article.scheduledVersions?.length && !!article.pendingVersion;
}

/** 법령 표기 날짜 — "2026. 10. 10." */
export function statuteDate(day: string | null | undefined): string {
  const d = dayOf(day);
  if (!d) return '';
  const [y, m, dd] = d.split('-');
  return `${y}. ${Number(m)}. ${Number(dd)}.`;
}

/**
 * 오늘 시행 중인 본문이 없는 조문을 공식 문서(인쇄·PDF·한글·TXT)에 적는 말 — 시행 예정 본문 자체는 넣지 않는다(T-127).
 * 폐지는 법령 표기대로 "삭제 <날짜>", 시행일 전인 새 조문은 "날짜 시행 예정". 둘 다 아니면 null(쓰는 쪽의 기본 문구).
 */
export function noCurrentTextMarker(article: ArticleLike): string | null {
  if (article.versions?.[0]) return null;
  if (article.currentState === 'repealed' && article.repealedOn) return `삭제 <${statuteDate(article.repealedOn)}>`;
  const upcoming = article.scheduledVersions?.[0];
  if (upcoming?.effectiveDate) return `${dayOf(upcoming.effectiveDate)} 시행 예정`;
  return null;
}

export type ArticleChangeNote = {
  key: string;
  label: string;
  note: string;
  effectiveDate: string | null;
  /** 승인됐지만 시행일 전 */
  scheduled: boolean;
};

/**
 * 조문별 개정 사유(승인 때 적은 changeNote) — 오늘 시행본과 시행 예정 버전(T-127)을 시행일 늦은 순으로.
 * 예전에는 시행본(`published`) 하나만 봤는데, 이제 미래 시행 개정은 `scheduledVersions` 에 따로 오므로 함께 모은다.
 */
export function collectArticleChangeNotes(
  policy:
    | {
        chapters?: { articles?: (CurrentViewArticle & { number: number; branchNumber?: number | null; title?: string | null })[] }[];
        /** 본문 목록에서 빠진 시행 예정 신설 조문(자리가 겹친 것, T-127) — 사유는 여기서 온다(T-132 ⑧) */
        current?: {
          scheduledArticles?: {
            number: number;
            branchNumber?: number | null;
            title?: string | null;
            versionId?: string | null;
            changeNote?: string | null;
            effectiveDate?: string | null;
          }[];
        } | null;
      }
    | null
    | undefined,
  joLabel: (number: number, branch?: number | null) => string,
): ArticleChangeNote[] {
  const rows: ArticleChangeNote[] = [];
  for (const a of policy?.current?.scheduledArticles || []) {
    const note = String(a.changeNote ?? '').trim();
    if (!note || !a.versionId) continue;
    rows.push({
      key: a.versionId,
      label: `${joLabel(a.number, a.branchNumber)}${a.title ? ` (${a.title})` : ''}`,
      note,
      effectiveDate: a.effectiveDate ?? null,
      scheduled: true,
    });
  }
  for (const chapter of policy?.chapters || []) {
    for (const article of chapter.articles || []) {
      const label = `${joLabel(article.number, article.branchNumber)}${article.title ? ` (${article.title})` : ''}`;
      const current = article.versions?.[0];
      const picked = [
        ...(current ? [{ v: current, scheduled: false }] : []),
        ...(article.scheduledVersions || []).map((v) => ({ v, scheduled: true })),
      ];
      for (const { v, scheduled } of picked) {
        const note = String(v.changeNote ?? '').trim();
        if (!note || !v.id) continue;
        rows.push({ key: v.id, label, note, effectiveDate: v.effectiveDate ?? null, scheduled });
      }
    }
  }
  return rows.sort((a, b) => String(b.effectiveDate ?? '').localeCompare(String(a.effectiveDate ?? '')));
}
