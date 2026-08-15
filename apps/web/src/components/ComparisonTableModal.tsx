/**
 * 신구조문대비표 (T-56).
 *
 * 국가법령정보센터의 신구법비교와 같은 2단 대비표. 왼쪽이 구조문, 오른쪽이 신조문이고
 * 바뀐 낱말만 강조한다. 대상이 *우리 규정끼리*라 외부 데이터 없이 시점 조회(T-72)로 만든다.
 */

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { X, Printer, ArrowRight } from 'lucide-react';
import { clsx } from 'clsx';
import {
  policiesApi,
  type CompareKind,
  type CompareRow,
  type PolicyComparison,
} from '../api/policies';
import { articleShortLabel } from '../lib/legalArticleLabel';
import { LoadingBlock } from './ui/LoadingBlock';
import { EmptyState } from './ui/EmptyState';

const KIND_LABEL: Record<CompareKind, string> = {
  added: '신설',
  removed: '삭제',
  changed: '개정',
  same: '변동 없음',
};

const KIND_BADGE: Record<CompareKind, string> = {
  added: 'bg-emerald-50 border-emerald-300 text-emerald-800',
  removed: 'bg-rose-50 border-rose-300 text-rose-800',
  changed: 'bg-amber-50 border-amber-300 text-amber-800',
  same: 'bg-gray-50 border-gray-300 text-gray-500',
};

function rowLabel(row: CompareRow) {
  return articleShortLabel({
    number: row.number,
    clauseNumber: row.clauseNumber,
    itemNumber: row.itemNumber,
  });
}

/** 구조문 쪽: 삭제된 낱말만 표시 / 신조문 쪽: 추가된 낱말만 표시 */
function DiffText({ row, side }: { row: CompareRow; side: 'before' | 'after' }) {
  const source = side === 'before' ? row.before : row.after;
  if (!source) return <span className="text-gray-400">—</span>;
  if (!row.diff) return <>{source.content}</>;

  return (
    <>
      {row.diff.map((part, i) => {
        if (side === 'before' && part.added) return null;
        if (side === 'after' && part.removed) return null;
        const highlight = side === 'before' ? part.removed : part.added;
        return (
          <span
            key={i}
            className={clsx(
              highlight &&
                (side === 'before'
                  ? 'bg-rose-100 text-rose-900 line-through decoration-rose-400'
                  : 'bg-emerald-100 text-emerald-900 font-medium'),
            )}
          >
            {part.value}
          </span>
        );
      })}
    </>
  );
}

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

  const rows = useMemo(
    () => (data?.rows ?? []).filter((r) => (hideUnchanged ? r.kind !== 'same' : true)),
    [data?.rows, hideUnchanged],
  );

  const errMessage =
    (error as any)?.response?.data?.message?.toString() ||
    (error ? '대비표를 불러오지 못했습니다.' : '');

  return (
    <div className="printable-policy-modal fixed inset-0 z-50 bg-black/60 p-2 sm:p-4 print:bg-white print:p-0">
      <div className="mx-auto h-full w-full max-w-6xl bg-white border border-gray-300 shadow-xl flex flex-col print:max-w-none print:h-auto print:border-0 print:shadow-none">
        <div className="bg-navy-900 text-white px-4 py-3 flex items-center justify-between gap-2 print:hidden">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold">신구조문대비표</h2>
            <p className="text-[11px] text-navy-200 mt-0.5">
              두 시점에 시행 중이던 본문을 조문 단위로 대비합니다.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => window.print()}
              className="rounded border border-navy-500 bg-navy-800 hover:bg-navy-700 px-3 py-1.5 text-sm inline-flex items-center gap-1"
            >
              <Printer size={14} /> 인쇄
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded border border-navy-500 bg-navy-800 hover:bg-navy-700 px-3 py-1.5 text-sm inline-flex items-center gap-1"
              aria-label="닫기"
            >
              <X size={14} /> 닫기
            </button>
          </div>
        </div>

        <div className="px-4 py-2.5 border-b border-gray-200 bg-gray-50 flex flex-wrap items-center gap-2 print:hidden">
          <label className="text-[11px] font-semibold text-gray-700" htmlFor="cmp-from">
            구조문 기준일
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
            신조문 기준일
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
            변동 없는 조문 숨기기
          </label>
          {data && (
            <span className="text-[11px] text-gray-600 ml-auto">
              신설 {data.summary.added} · 개정 {data.summary.changed} · 삭제 {data.summary.removed} ·
              변동없음 {data.summary.same}
            </span>
          )}
        </div>

        <div className="flex-1 overflow-auto print:overflow-visible">
          <div className="hidden print:block px-4 pt-4 pb-2 border-b border-gray-300">
            <h2 className="text-lg font-bold text-gray-900">
              신구조문대비표 — {data?.policy.title}
            </h2>
            <p className="text-xs text-gray-600 mt-1">
              {from} 시행분 → {to} 시행분 · 출력일 {new Date().toLocaleDateString('ko-KR')}
            </p>
          </div>

          {!enabled ? (
            <EmptyState
              title="비교할 시점을 선택하세요."
              description="시행일이 기록된 개정이 2건 이상이어야 대비가 의미 있습니다."
            />
          ) : errMessage ? (
            <p className="m-4 text-xs text-red-700 bg-red-50 border border-red-200 rounded px-3 py-2">
              {errMessage}
            </p>
          ) : isFetching ? (
            <LoadingBlock label="대비표를 만드는 중입니다…" />
          ) : rows.length === 0 ? (
            <EmptyState
              title="두 시점 사이에 바뀐 조문이 없습니다."
              description={hideUnchanged ? '“변동 없는 조문 숨기기”를 해제하면 전체를 볼 수 있습니다.' : undefined}
            />
          ) : (
            <table className="w-full text-sm border-collapse">
              <thead className="sticky top-0 bg-gray-100 print:static">
                <tr>
                  <th className="border border-gray-300 px-2 py-1.5 w-24 text-xs font-semibold text-gray-700">
                    구분
                  </th>
                  <th className="border border-gray-300 px-3 py-1.5 text-xs font-semibold text-gray-700 w-1/2">
                    구조문 ({from})
                  </th>
                  <th className="border border-gray-300 px-3 py-1.5 text-xs font-semibold text-gray-700 w-1/2">
                    신조문 ({to})
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.articleId} className="align-top">
                    <td className="border border-gray-300 px-2 py-2">
                      <div className="text-xs font-semibold text-navy-800">{rowLabel(row)}</div>
                      <span
                        className={clsx(
                          'inline-flex mt-1 items-center rounded border px-1.5 py-0.5 text-[10px] font-semibold',
                          KIND_BADGE[row.kind],
                        )}
                      >
                        {KIND_LABEL[row.kind]}
                      </span>
                    </td>
                    <td className="border border-gray-300 px-3 py-2">
                      {row.before ? (
                        <>
                          {row.before.title && (
                            <div
                              className={clsx(
                                'text-xs font-medium mb-1',
                                row.titleChanged ? 'text-rose-800 line-through' : 'text-gray-800',
                              )}
                            >
                              {row.before.title}
                            </div>
                          )}
                          <div className="text-xs text-gray-700 whitespace-pre-wrap leading-relaxed">
                            <DiffText row={row} side="before" />
                          </div>
                        </>
                      ) : (
                        <span className="text-xs text-gray-400">(신설)</span>
                      )}
                    </td>
                    <td className="border border-gray-300 px-3 py-2">
                      {row.after ? (
                        <>
                          {row.after.title && (
                            <div
                              className={clsx(
                                'text-xs font-medium mb-1',
                                row.titleChanged ? 'text-emerald-800' : 'text-gray-800',
                              )}
                            >
                              {row.after.title}
                            </div>
                          )}
                          <div className="text-xs text-gray-700 whitespace-pre-wrap leading-relaxed">
                            <DiffText row={row} side="after" />
                          </div>
                        </>
                      ) : (
                        <span className="text-xs text-gray-400">(삭제)</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
