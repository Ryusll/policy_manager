/**
 * 법령의 현행과 시행 예정 (T-150 ②, SRS LAW-15).
 *
 * 법령조항 본문은 마지막으로 반영한 판(시행 전일 수 있다)의 문구라, 그대로 보이면 11월 27일 시행될 개정이 오늘 시행 중인
 * 것처럼 보였다. 서버가 변경 이벤트로 가른 "지금 시행 중" 문구를 기본으로 보이고, 시행 예정 변경은 날짜와 함께 따로 보인다.
 */
import { clsx } from 'clsx';
import type { Law, LawInForce, LawInForceArticle, LawScheduledChange } from '../api/laws';
import { useI18n } from '../i18n/useI18n';
import { lawVersionLabel } from '../lib/lawVersionLabel';


/** 머리말 — 현행 판과 시행 예정 판. 판 기록이 없으면 법령 행의 값으로 대신한다 */
export function LawInForceHeader({ law, inForce, articleCount }: { law: Law; inForce?: LawInForce; articleCount: number }) {
  const { t } = useI18n();
  const current = inForce?.current;
  const currentLabel = lawVersionLabel(current, t);
  const currentDate = current ? current.effectiveDate : law.effectiveDate?.slice(0, 10);
  return (
    <div className="mt-0.5 space-y-1">
      <p className="text-xs text-gray-500">
        {currentLabel ? t('lawInForce.current', { label: currentLabel }) : [law.lawType, t('lawInForce.currentFallback')].filter(Boolean).join(' · ')}
        {currentDate && ` · ${t('lawInForce.effective', { date: currentDate })}`}
        {` · ${t('lawInForce.articleCount', { count: articleCount })}`}
      </p>
      {inForce?.scheduled.map((v) => (
        <p
          key={v.id ?? `date-${v.effectiveDate}`}
          className="text-xs text-amber-900 bg-amber-50 border border-amber-200 rounded px-2 py-1 inline-flex flex-wrap gap-x-2"
          data-testid="law-scheduled-version"
        >
          <span className="font-semibold">{t('lawInForce.scheduled', { date: v.effectiveDate ?? '' })}</span>
          {lawVersionLabel(v, t) && <span>{lawVersionLabel(v, t)}</span>}
          {v.revisionType && <span>{v.revisionType}</span>}
          {v.stageEffectiveDates.length > 1 && <span>{t('lawInForce.stages', { dates: v.stageEffectiveDates.join(', ') })}</span>}
          <span>{t('lawInForce.changeCount', { count: v.changeCount })}</span>
        </p>
      ))}
    </div>
  );
}

const BADGE_STYLE: Record<LawScheduledChange['changeType'], string> = {
  modified: 'bg-amber-50 text-amber-800 border-amber-200',
  created: 'bg-green-50 text-green-800 border-green-200',
  deleted: 'bg-red-50 text-red-800 border-red-200',
};

/** 목록 줄의 예정 표시 — "2026-11-27 변경" */
export function ScheduledBadge({ scheduled }: { scheduled: LawScheduledChange | null }) {
  const { t } = useI18n();
  if (!scheduled) return null;
  return (
    <span className={clsx('px-1.5 py-0.5 rounded border text-[10px] shrink-0', BADGE_STYLE[scheduled.changeType])}>
      {t(`lawInForce.badge.${scheduled.changeType}`, { date: scheduled.effectiveDate })}
    </span>
  );
}

/** 선택한 조항의 본문 — 지금 시행 중인 문구와, 있으면 시행 예정 문구 */
export function InForceText({ article }: { article: LawInForceArticle }) {
  const { t } = useI18n();
  const s = article.scheduled;
  return (
    <div className="space-y-3">
      {article.content !== null ? (
        <div>
          {s && <p className="text-[11px] font-semibold text-gray-600 mb-1">{t('lawInForce.nowText')}</p>}
          <p className="text-sm text-gray-800 whitespace-pre-wrap leading-relaxed">{article.content}</p>
        </div>
      ) : (
        s && <p className="text-xs text-green-800">{t('lawInForce.notYet', { date: s.effectiveDate })}</p>
      )}
      {s && (
        <div className="border-l-2 border-amber-300 pl-3" data-testid="law-scheduled-text">
          <p className="text-[11px] font-semibold text-amber-800 mb-1">
            {t('lawInForce.fromText', { date: s.effectiveDate })} <ScheduledBadge scheduled={s} />
          </p>
          {s.changeType === 'deleted' ? (
            <p className="text-xs text-red-800">{t('lawInForce.removedFrom', { date: s.effectiveDate })}</p>
          ) : (
            <p className="text-sm text-gray-800 whitespace-pre-wrap leading-relaxed">{s.content}</p>
          )}
          {s.laterCount > 0 && <p className="text-[11px] text-gray-500 mt-1">{t('lawInForce.later', { count: s.laterCount })}</p>}
        </div>
      )}
    </div>
  );
}
