import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { clsx } from 'clsx';
import { policiesApi } from '../api/policies';
import {
  amendmentsApi,
  CONFIDENCE_LABEL,
  REVIEW_STATE_LABEL,
  type AmendmentListItem,
  type AmendmentListState,
} from '../api/amendments';
import { formatArticleAnchor } from '../lib/articleAnchor';
import { useAuthStore } from '../stores/authStore';

/**
 * 개정 검토 — 개정 후보 목록 (T-107).
 *
 * 여러 법령 변경·규정에 걸친 후보를 한곳에서 처리한다. 기본은 처리할 것(작성·검토). 비활성 규정의
 * 후보도 숨기지 않는다 — 규정을 쉬게 했다고 개정 검토가 끝난 것은 아니다.
 */
const PAGE_SIZE = 30;

const STATE_TABS: { value: AmendmentListState; label: string }[] = [
  { value: 'open', label: '처리할 것' },
  { value: 'draft', label: '작성 중' },
  { value: 'review', label: '검토 중' },
  { value: 'approved', label: '승인됨' },
  { value: 'rejected', label: '반려됨' },
  { value: 'all', label: '전체' },
];

type Filter = { state: AmendmentListState; policyId: string; policyActive: '' | 'active' | 'inactive'; page: number };

export default function AmendmentsPage() {
  const user = useAuthStore((s) => s.user);
  const canReview = user?.role === 'admin' || user?.role === 'editor';
  const [filter, setFilter] = useState<Filter>({ state: 'open', policyId: '', policyActive: '', page: 1 });

  const { data, isLoading, isError } = useQuery({
    queryKey: ['amendments', filter],
    queryFn: () =>
      amendmentsApi.list({
        state: filter.state,
        policyId: filter.policyId || undefined,
        policyActive: filter.policyActive || undefined,
        page: filter.page,
        limit: PAGE_SIZE,
      }),
    enabled: canReview,
  });
  const { data: policies = [] } = useQuery<{ id: string; code: string; title: string }[]>({
    queryKey: ['policies'],
    queryFn: policiesApi.list,
    enabled: canReview,
  });

  if (!canReview) {
    return (
      <div className="max-w-2xl bg-white border border-gray-300 shadow-sm p-5 space-y-2">
        <h1 className="text-lg font-bold text-gray-800">개정 검토</h1>
        <p className="text-sm text-gray-600">개정 후보는 확정 전 내부 문서라 관리자·편집자만 볼 수 있습니다.</p>
      </div>
    );
  }

  /** 필터를 바꾸면 첫 장으로 — 3쪽에서 조건을 바꾸면 빈 화면이 나온다 */
  const patch = (p: Partial<Filter>) => setFilter((prev) => ({ ...prev, ...p, page: 1 }));
  const rows = data?.rows ?? [];
  const total = data?.total ?? 0;
  const lastPage = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="page-shell">
      <div className="page-header">
        <div className="page-header__text">
          <h1 className="page-title">개정 검토</h1>
          <p className="page-subtitle">
            법령이 바뀌어 만들어진 개정 후보입니다. 후보는 초안이라 승인 전까지 시행 중인 규정 본문은 그대로입니다.
          </p>
        </div>
      </div>

      <div className="card p-3 space-y-3">
        <div role="tablist" aria-label="상태" className="flex flex-wrap gap-1.5">
          {STATE_TABS.map((t) => (
            <button
              key={t.value}
              type="button"
              role="tab"
              aria-selected={filter.state === t.value}
              onClick={() => patch({ state: t.value })}
              className={clsx(
                'px-2.5 py-1 rounded text-xs border',
                filter.state === t.value
                  ? 'bg-navy-700 text-white border-navy-700'
                  : 'bg-white text-gray-700 border-gray-300 hover:border-navy-300',
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="block text-xs text-gray-600 mb-1" htmlFor="amend-policy">
              규정
            </label>
            <select
              id="amend-policy"
              className="input"
              value={filter.policyId}
              onChange={(e) => patch({ policyId: e.target.value })}
            >
              <option value="">전체</option>
              {policies.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.title} ({p.code})
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs text-gray-600 mb-1" htmlFor="amend-active">
              규정 시행 여부
            </label>
            <select
              id="amend-active"
              className="input"
              value={filter.policyActive}
              onChange={(e) => patch({ policyActive: e.target.value as Filter['policyActive'] })}
            >
              <option value="">전체</option>
              <option value="active">시행 중인 규정</option>
              <option value="inactive">비활성 규정</option>
            </select>
          </div>
        </div>
      </div>

      <div className="card overflow-hidden">
        <div className="px-4 py-2.5 border-b border-gray-200 bg-gray-50 text-xs text-gray-600" aria-live="polite">
          {isLoading ? '불러오는 중…' : `${total.toLocaleString('ko-KR')}건`}
        </div>
        {isError && <p className="px-4 py-6 text-sm text-red-700">개정 후보를 불러오지 못했습니다.</p>}
        {!isLoading && !isError && rows.length === 0 && (
          <p className="px-4 py-10 text-sm text-gray-500 text-center">
            {filter.state === 'open' ? '처리할 개정 후보가 없습니다.' : '조건에 맞는 개정 후보가 없습니다.'}
          </p>
        )}
        <ul className="divide-y divide-gray-100">
          {rows.map((row) => (
            <AmendmentRow key={row.id} row={row} />
          ))}
        </ul>
        {total > PAGE_SIZE && (
          <div className="px-4 py-2.5 border-t border-gray-200 bg-gray-50 flex items-center gap-2">
            <span className="text-xs text-gray-600">
              {filter.page} / {lastPage}
            </span>
            <div className="ml-auto flex gap-2">
              <button
                type="button"
                className="btn-secondary text-xs"
                disabled={filter.page <= 1}
                onClick={() => setFilter((p) => ({ ...p, page: Math.max(1, p.page - 1) }))}
              >
                이전
              </button>
              <button
                type="button"
                className="btn-secondary text-xs"
                disabled={filter.page >= lastPage}
                onClick={() => setFilter((p) => ({ ...p, page: p.page + 1 }))}
              >
                다음
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function AmendmentRow({ row }: { row: AmendmentListItem }) {
  return (
    <li>
      <Link to={`/amendments/${row.id}`} className="block px-4 py-2.5 hover:bg-gray-50" data-testid="amendment-row">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
          <span className="font-medium text-gray-900">{row.policy.title}</span>
          <span className="text-navy-700">{formatArticleAnchor(row.article)}</span>
          <span className="text-gray-700">{row.article.title}</span>
          <StateBadge state={row.reviewState} />
          {!row.policy.isActive && (
            <span className="text-[10px] px-1.5 py-0.5 rounded border border-gray-300 text-gray-500">비활성 규정</span>
          )}
          {!row.isCurrentBase && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-900">기준 본문 바뀜</span>
          )}
          {!row.current.hasChanges && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-900">직접 작성 필요</span>
          )}
          {row.current.unexplained > 0 && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-900">
              근거 없는 변경 {row.current.unexplained}
            </span>
          )}
        </div>
        <div className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-gray-500">
          <span>
            {row.event.lawName} {row.event.label}
            {row.event.lawEffectiveDate && ` · 법령 시행 ${row.event.lawEffectiveDate}`}
          </span>
          <span>생성 시 신뢰도 {CONFIDENCE_LABEL[row.confidence]}</span>
          <span>판 {row.current.revision}</span>
          <span>
            {row.createdBy ? `만든 사람 ${row.createdBy.name ?? '알 수 없음'}` : '자동 생성'} ·{' '}
            {new Date(row.createdAt).toLocaleDateString('ko-KR')}
          </span>
        </div>
      </Link>
    </li>
  );
}

export function StateBadge({ state }: { state: AmendmentListItem['reviewState'] }) {
  return (
    <span
      className={clsx(
        'text-[10px] px-1.5 py-0.5 rounded border',
        state === 'draft' && 'border-gray-300 text-gray-700 bg-white',
        state === 'review' && 'border-sky-300 text-sky-800 bg-sky-50',
        state === 'approved' && 'border-emerald-300 text-emerald-800 bg-emerald-50',
        state === 'rejected' && 'border-rose-300 text-rose-800 bg-rose-50',
      )}
    >
      {REVIEW_STATE_LABEL[state]}
    </span>
  );
}
