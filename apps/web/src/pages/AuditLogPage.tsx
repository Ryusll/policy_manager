import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { clsx } from 'clsx';
import { ChevronDown, ChevronRight, ShieldAlert } from 'lucide-react';
import { auditLogsApi, type AuditLogFilter } from '../api/auditLogs';
import { useAuthStore } from '../stores/authStore';
import { AUDIT_GROUPS, auditActionLabel, isDestructiveAction } from '../lib/auditLabels';

/**
 * 감사 로그 조회 (T-11).
 *
 * `GET /audit-logs` 는 있었지만 화면이 없어서, 무슨 일이 있었는지 보려면 DB 를 열어야 했다.
 *
 * 목록은 `details` 본문을 받지 않는다 — 템플릿 수정 기록에는 before/after 스냅샷이 통째로
 * 들어 있어서 50건이면 응답이 수 MB 다. 펼칠 때만 상세를 받아 온다.
 */

const PAGE_SIZE = 50;

function DetailRow({ id }: { id: string }) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['audit-log', id],
    queryFn: () => auditLogsApi.get(id),
  });

  if (isLoading) return <p className="text-xs text-gray-400">불러오는 중…</p>;
  if (isError) return <p className="text-xs text-red-600">상세를 불러오지 못했습니다.</p>;

  return (
    <pre className="text-[11px] leading-relaxed text-gray-700 whitespace-pre-wrap break-all max-h-72 overflow-y-auto">
      {JSON.stringify(data?.details ?? {}, null, 2)}
    </pre>
  );
}

export default function AuditLogPage() {
  const user = useAuthStore((s) => s.user);
  const isAdmin = user?.role === 'admin';

  const [filter, setFilter] = useState<AuditLogFilter>({ page: 1, limit: PAGE_SIZE });
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['audit-logs', filter],
    queryFn: () => auditLogsApi.list(filter),
    enabled: isAdmin,
  });

  const { data: actors = [] } = useQuery({
    queryKey: ['audit-log-actors'],
    queryFn: auditLogsApi.actors,
    enabled: isAdmin,
    staleTime: 5 * 60 * 1000,
  });

  if (!isAdmin) {
    return (
      <div className="max-w-2xl bg-white border border-gray-300 shadow-sm p-5 space-y-2">
        <h1 className="text-lg font-bold text-gray-800">감사 로그</h1>
        <p className="text-sm text-gray-600">
          감사 로그는 회사 관리자만 볼 수 있습니다. 누가 무엇을 바꿨는지에는 다른 구성원의 활동이 함께 담깁니다.
        </p>
      </div>
    );
  }

  const rows = data?.rows ?? [];
  const total = data?.total ?? 0;
  const page = data?.page ?? 1;
  const lastPage = Math.max(1, Math.ceil(total / (data?.limit ?? PAGE_SIZE)));

  /** 필터를 바꾸면 첫 장으로 돌아간다 — 3페이지에서 조건을 바꾸면 빈 화면이 나온다 */
  const setFilterField = (patch: Partial<AuditLogFilter>) =>
    setFilter((prev) => ({ ...prev, ...patch, page: 1 }));

  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div className="page-shell">
      <div className="page-header">
        <div className="page-header__text">
          <h1 className="page-title">감사 로그</h1>
          <p className="page-subtitle">회사에서 일어난 변경을 시간 순으로 봅니다. 관리자 전용입니다.</p>
        </div>
      </div>

      <div className="card p-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <label className="block text-xs text-gray-600 mb-1" htmlFor="audit-group">
            분류
          </label>
          <select
            id="audit-group"
            className="input"
            value={filter.action ?? ''}
            onChange={(e) => setFilterField({ action: e.target.value })}
          >
            {AUDIT_GROUPS.map((g) => (
              <option key={g.value} value={g.value}>
                {g.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs text-gray-600 mb-1" htmlFor="audit-actor">
            수행자
          </label>
          <select
            id="audit-actor"
            className="input"
            value={filter.userId ?? ''}
            onChange={(e) => setFilterField({ userId: e.target.value })}
          >
            <option value="">전체</option>
            {actors.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name} ({a.email})
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs text-gray-600 mb-1" htmlFor="audit-from">
            시작일
          </label>
          <input
            id="audit-from"
            type="date"
            className="input"
            value={filter.from ?? ''}
            onChange={(e) => setFilterField({ from: e.target.value })}
          />
        </div>
        <div>
          <label className="block text-xs text-gray-600 mb-1" htmlFor="audit-to">
            종료일
          </label>
          <input
            id="audit-to"
            type="date"
            className="input"
            value={filter.to ?? ''}
            onChange={(e) => setFilterField({ to: e.target.value })}
          />
          <p className="text-[11px] text-gray-500 mt-1">종료일 당일까지 포함합니다.</p>
        </div>
      </div>

      <div className="card overflow-hidden">
        <div className="px-4 py-2.5 border-b border-gray-200 bg-gray-50 flex items-center gap-2">
          <span className="text-xs text-gray-600" aria-live="polite">
            {isLoading ? '불러오는 중…' : `${total.toLocaleString('ko-KR')}건`}
          </span>
          {(filter.action || filter.userId || filter.from || filter.to) && (
            <button
              type="button"
              className="ml-auto text-xs text-navy-700 hover:underline"
              onClick={() => setFilter({ page: 1, limit: PAGE_SIZE })}
            >
              필터 지우기
            </button>
          )}
        </div>

        {isError && (
          <p className="px-4 py-6 text-sm text-red-700">
            {(error as any)?.response?.data?.message || '감사 로그를 불러오지 못했습니다.'}
          </p>
        )}

        {!isLoading && !isError && rows.length === 0 && (
          <p className="px-4 py-10 text-sm text-gray-500 text-center">조건에 맞는 기록이 없습니다.</p>
        )}

        <ul className="divide-y divide-gray-100">
          {rows.map((row) => {
            const open = expanded.has(row.id);
            return (
              <li key={row.id}>
                <div className="flex items-start gap-2 px-4 py-2.5 text-sm">
                  <button
                    type="button"
                    onClick={() => toggle(row.id)}
                    disabled={!row.hasDetails}
                    className="mt-0.5 text-gray-400 hover:text-navy-700 disabled:opacity-25 shrink-0"
                    aria-label={open ? '상세 접기' : '상세 펼치기'}
                    aria-expanded={open}
                  >
                    {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                  </button>
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={clsx(
                          'font-medium',
                          isDestructiveAction(row.action) ? 'text-red-700' : 'text-gray-800',
                        )}
                      >
                        {auditActionLabel(row.action)}
                      </span>
                      {isDestructiveAction(row.action) && (
                        <ShieldAlert size={13} className="text-red-500" aria-label="되돌릴 수 없는 동작" />
                      )}
                      {row.entityType && (
                        <span className="text-[11px] text-gray-500 bg-gray-100 border border-gray-200 rounded px-1.5 py-0.5">
                          {row.entityType}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-gray-500 mt-0.5">
                      {new Date(row.createdAt).toLocaleString('ko-KR')} ·{' '}
                      {row.user ? `${row.user.name} (${row.user.email})` : '시스템'}
                    </p>
                    {open && (
                      <div className="mt-2 bg-gray-50 border border-gray-200 rounded p-2.5">
                        <DetailRow id={row.id} />
                      </div>
                    )}
                  </div>
                  {row.entityId && (
                    <span className="hidden sm:block shrink-0 font-mono text-[10px] text-gray-400 mt-1">
                      {row.entityId.slice(0, 8)}
                    </span>
                  )}
                </div>
              </li>
            );
          })}
        </ul>

        {total > 0 && (
          <div className="px-4 py-2.5 border-t border-gray-200 bg-gray-50 flex items-center gap-2">
            <span className="text-xs text-gray-600">
              {page} / {lastPage}
            </span>
            <div className="ml-auto flex gap-2">
              <button
                type="button"
                className="btn-secondary text-xs"
                disabled={page <= 1}
                onClick={() => setFilter((prev) => ({ ...prev, page: Math.max(1, (prev.page ?? 1) - 1) }))}
              >
                이전
              </button>
              <button
                type="button"
                className="btn-secondary text-xs"
                disabled={page >= lastPage}
                onClick={() => setFilter((prev) => ({ ...prev, page: (prev.page ?? 1) + 1 }))}
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
