/**
 * 법령의 현행과 시행 예정 (T-150 ②, SRS LAW-15).
 *
 * 법령조항 본문은 마지막으로 반영한 판(시행 전일 수 있다)의 문구라, 그대로 보이면 11월 27일 시행될 개정이 오늘 시행 중인
 * 것처럼 보였다. 서버가 변경 이벤트로 가른 "지금 시행 중" 문구를 기본으로 보이고, 시행 예정 변경은 날짜와 함께 따로 보인다.
 */
import { clsx } from 'clsx';
import type { Law, LawInForce, LawInForceArticle, LawScheduledChange } from '../api/laws';
import { useI18n } from '../i18n/useI18n';
import { currentStageDate, lawVersionLabel } from '../lib/lawVersionLabel';

/**
 * 머리말 — 현행 판과 시행 예정 판. 판 기록이 없으면 법령 행의 값으로 대신한다.
 * 현행·예정을 가른 결과가 오기 전(불러오는 중·오류)에는 법령 행의 시행일을 '현행'으로 찍지 않는다 — 시행 예정 판의 날짜일 수 있다.
 * 단계 시행 판은 오늘까지 시작된 단계일과 단계 목록을 보인다(본문 시행일은 뒤 단계일 수 있다, T-150 검토).
 */
export function LawInForceHeader({ law, inForce, failed, articleCount }: { law: Law; inForce?: LawInForce; failed?: boolean; articleCount: number }) {
  const { t } = useI18n();
  if (!inForce) {
    return failed ? (
      <p role="alert" className="mt-0.5 text-xs text-red-700">
        {t('lawInForce.loadFailed')}
      </p>
    ) : (
      <p className="mt-0.5 text-xs text-gray-500">{t('lawInForce.loading')}</p>
    );
  }
  const current = inForce.current;
  const currentLabel = lawVersionLabel(current, t);
  // 판 기록이 모두 시행 예정이면(보정하지 않은 묻힌 법령) 법령 행의 시행일은 예정 판의 날짜라 '현행'으로 찍지 않는다
  const unconfirmed = !current && inForce.scheduled.length > 0;
  const currentDate = current ? currentStageDate(current, inForce.today) : unconfirmed ? null : law.effectiveDate?.slice(0, 10);
  // 첫 개정 확인 전에는 '현행'이라 하지 않는다 — 현행보다 앞 판으로 등록했으면 현행 판까지 아직 반영되지 않았다(T-150 마지막 검토).
  // 판 기록이 없는 옛 행도 같다 — 확인에 성공한 적이 없으면 '등록한 판'(T-153 ⑤)
  const fallback = t(unconfirmed ? 'lawInForce.currentUnknown' : law.lastCheckedAt ? 'lawInForce.currentFallback' : 'lawInForce.registeredFallback');
  const currentKey = law.lastCheckedAt ? 'lawInForce.current' : 'lawInForce.registeredVersion';
  return (
    <div className="mt-0.5 space-y-1">
      <p className="text-xs text-gray-500">
        {currentLabel ? t(currentKey, { label: currentLabel }) : [law.lawType, fallback].filter(Boolean).join(' · ')}
        {currentDate && ` · ${t('lawInForce.effective', { date: currentDate })}`}
        {current && current.stageEffectiveDates.length > 1 && ` · ${t('lawInForce.stages', { dates: current.stageEffectiveDates.join(', ') })}`}
        {` · ${t('lawInForce.articleCount', { count: articleCount })}`}
      </p>
      {inForce.scheduled.map((v) => (
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

/**
 * 선택한 조항의 본문 — 지금 시행 중인 문구와, 있으면 시행 예정 문구. 뒤 변경 건수의 '개정 내역에서 보세요'는 개정 내역을 볼 수 있는
 * 관리자·편집자에게만 붙인다(직원 화면에는 그 칸이 없다, T-150 검토)
 */
export function InForceText({ article, canEdit }: { article: LawInForceArticle; canEdit: boolean }) {
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
          {s.laterCount > 0 && (
            <p className="text-[11px] text-gray-500 mt-1">{t(canEdit ? 'lawInForce.later' : 'lawInForce.laterViewer', { count: s.laterCount })}</p>
          )}
          {s.orderMismatch && <p className="text-[11px] text-amber-800 mt-1">{t('lawInForce.orderMismatch')}</p>}
        </div>
      )}
    </div>
  );
}
