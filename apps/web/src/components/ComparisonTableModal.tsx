/**
 * 신구조문대비표 (T-56).
 *
 * 국가법령정보센터의 신구법비교와 같은 2단 대비표. 왼쪽이 구조문, 오른쪽이 신조문이고
 * 바뀐 낱말만 강조한다. 대상이 *우리 규정끼리*라 외부 데이터 없이 시점 조회(T-72)로 만든다.
 * 표는 조마다 묶어 그린다 — 구분 칸에 어느 조인지까지, 묶음 머리에 `제N조(제목)`(T-229, `ComparisonTable`).
 */

import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { holdPrintRoot } from '../lib/printRoot';
import { useQuery } from '@tanstack/react-query';
import { X, Printer, ArrowRight } from 'lucide-react';
import { policiesApi, type PolicyComparison } from '../api/policies';
import { countChangedJo, countMovedOnly, currentJoTitles, groupComparisonRows } from '../lib/compareTableGroups';
import { useI18n } from '../i18n/useI18n';
import ComparisonTable from './ComparisonTable';
import { LoadingBlock } from './ui/LoadingBlock';
import { EmptyState } from './ui/EmptyState';

export default function ComparisonTableModal({
  policyId,
  effectiveDates,
  onClose,
}: {
  policyId: string;
  /** 본문이 바뀐 시행일 목록(내림차순) */
  effectiveDates: string[];
  onClose: () => void;
}) {
  const { t, locale } = useI18n();
  // 기본값: 직전 개정 → 최신 개정. 이력이 하나뿐이면 같은 날짜가 되어 "변동 없음"만 나온다.
  const [from, setFrom] = useState(effectiveDates[1] ?? effectiveDates[0] ?? '');
  const [to, setTo] = useState(effectiveDates[0] ?? '');
  const [hideUnchanged, setHideUnchanged] = useState(true);

  const enabled = !!from && !!to;
  const { data, isFetching, error } = useQuery<PolicyComparison>({
    queryKey: ['policy', policyId, 'compare', from, to],
    queryFn: () => policiesApi.compare(policyId, from, to),
    enabled,
  });

  // 본문 없는 조 머리 행은 판이 없어 대비표 행에 없다 — 묶음 머리의 조 제목은 지금 규정에서(T-229). 규정 상세가 이미 받아 둔
  // 같은 조회라 창을 열 때 다시 받지 않는다(규정 상세가 최신으로 유지한다)
  const { data: current } = useQuery({
    queryKey: ['policy', policyId],
    queryFn: () => policiesApi.get(policyId),
    refetchOnMount: false,
  });

  // 조 제목·묶음은 거르기 전의 행으로 정하고, 숨기기는 묶음 안에서 한다(T-229)
  const groups = useMemo(
    () => groupComparisonRows(data?.rows ?? [], hideUnchanged, currentJoTitles(current)),
    [data?.rows, hideUnchanged, current],
  );
  const moved = useMemo(() => countMovedOnly(data?.rows ?? []), [data?.rows]);
  // API 요약은 번호만 바뀐 줄을 변동 없음에 넣는다 — 화면은 그 줄을 보이므로 따로 센다. 인쇄물 머리말에도 같은 줄
  const summaryText = data
    ? t('compareTable.summary', { jo: countChangedJo(groups), ...data.summary, same: data.summary.same - moved }) +
      (moved > 0 ? t('compareTable.summaryMoved', { moved }) : '')
    : '';

  const errMessage =
    (error as any)?.response?.data?.message?.toString() || (error ? t('compareTable.loadFailed') : '');

  // 인쇄 때 앱 화면을 빼고 이 창만 흐름대로(전체화면 전문 보기와 같은 인쇄 규칙, T-133) — 그래서 body 바로 아래에 그린다
  useEffect(() => holdPrintRoot(), []);

  return createPortal(
    <div className="printable-policy-modal fixed inset-0 z-50 bg-black/60 p-2 sm:p-4 print:bg-white print:p-0">
      <div className="mx-auto h-full w-full max-w-6xl bg-white border border-gray-300 shadow-xl flex flex-col print:max-w-none print:h-auto print:border-0 print:shadow-none">
        <div className="bg-navy-900 text-white px-4 py-3 flex items-center justify-between gap-2 print:hidden">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold">{t('compareTable.title')}</h2>
            <p className="text-[11px] text-navy-200 mt-0.5">{t('compareTable.subtitle')}</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => window.print()}
              className="rounded border border-navy-500 bg-navy-800 hover:bg-navy-700 px-3 py-1.5 text-sm inline-flex items-center gap-1"
            >
              <Printer size={14} /> {t('compareTable.print')}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded border border-navy-500 bg-navy-800 hover:bg-navy-700 px-3 py-1.5 text-sm inline-flex items-center gap-1"
              aria-label={t('compareTable.close')}
            >
              <X size={14} /> {t('compareTable.close')}
            </button>
          </div>
        </div>

        <div className="px-4 py-2.5 border-b border-gray-200 bg-gray-50 flex flex-wrap items-center gap-2 print:hidden">
          <label className="text-[11px] font-semibold text-gray-700" htmlFor="cmp-from">
            {t('compareTable.from')}
          </label>
          <input
            id="cmp-from"
            type="date"
            className="input text-xs py-1.5 w-[10.5rem]"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            list="cmp-dates"
          />
          <ArrowRight size={14} className="text-gray-400" aria-hidden />
          <label className="text-[11px] font-semibold text-gray-700" htmlFor="cmp-to">
            {t('compareTable.to')}
          </label>
          <input
            id="cmp-to"
            type="date"
            className="input text-xs py-1.5 w-[10.5rem]"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            list="cmp-dates"
          />
          <datalist id="cmp-dates">
            {effectiveDates.map((d) => (
              <option key={d} value={d} />
            ))}
          </datalist>
          <label className="text-[11px] text-gray-600 inline-flex items-center gap-1.5 ml-1">
            <input
              type="checkbox"
              checked={hideUnchanged}
              onChange={(e) => setHideUnchanged(e.target.checked)}
            />
            {t('compareTable.hideUnchanged')}
          </label>
          {data && <span className="text-[11px] text-gray-600 ml-auto">{summaryText}</span>}
        </div>

        <div className="flex-1 overflow-auto print:overflow-visible">
          <div className="hidden print:block px-4 pt-4 pb-2 border-b border-gray-300">
            <h2 className="text-lg font-bold text-gray-900">
              {t('compareTable.printTitle', { title: data?.policy.title ?? '' })}
            </h2>
            <p className="text-xs text-gray-600 mt-1">
              {t('compareTable.printMeta', {
                from,
                to,
                date: new Date().toLocaleDateString(locale === 'en' ? 'en-US' : 'ko-KR'),
              })}
            </p>
            {summaryText && <p className="text-xs text-gray-600 mt-0.5">{summaryText}</p>}
          </div>

          {!enabled ? (
            <EmptyState title={t('compareTable.pickDates')} description={t('compareTable.pickDatesHint')} />
          ) : errMessage ? (
            <p className="m-4 text-xs text-red-700 bg-red-50 border border-red-200 rounded px-3 py-2">
              {errMessage}
            </p>
          ) : isFetching ? (
            <LoadingBlock label={t('compareTable.loading')} />
          ) : groups.length === 0 ? (
            <EmptyState
              title={t('compareTable.empty')}
              description={hideUnchanged ? t('compareTable.emptyHint') : undefined}
            />
          ) : (
            <ComparisonTable groups={groups} from={from} to={to} />
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
