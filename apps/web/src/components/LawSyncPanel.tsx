import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { RefreshCw } from 'lucide-react';
import { clsx } from 'clsx';
import { lawSyncApi, type LawSyncRun } from '../api/laws';
import { toast } from '../stores/toastStore';
import { apiErrorMessage } from '../lib/apiError';
import LawSyncVersions from './LawSyncVersions';

const STATUS: Record<LawSyncRun['status'], { label: string; className: string }> = {
  succeeded: { label: '성공', className: 'bg-green-50 text-green-800 border-green-200' },
  partial: { label: '일부 실패', className: 'bg-amber-50 text-amber-800 border-amber-200' },
  failed: { label: '실패', className: 'bg-red-50 text-red-700 border-red-200' },
  running: { label: '진행 중', className: 'bg-gray-50 text-gray-700 border-gray-200' },
};

/**
 * 통합 관리자 콘솔 — 법령 동기화 (T-104).
 * 법령은 모든 회사가 함께 쓰는 데이터라 플랫폼 관리자만 돌린다. 예약 실행은 서버 cron 이 한다.
 */
export default function LawSyncPanel() {
  const qc = useQueryClient();
  const [openId, setOpenId] = useState<string | null>(null);
  const { data: runs = [], isLoading } = useQuery({
    queryKey: ['law-sync', 'runs'],
    queryFn: () => lawSyncApi.runs(10),
  });

  const runMutation = useMutation({
    mutationFn: () => lawSyncApi.run(),
    onSuccess: (run) => {
      toast(
        `법령 ${run.checkedCount}건 확인 — 새 판 ${run.changedCount}건, 실패 ${run.failedCount}건`,
        run.status === 'succeeded' ? 'success' : 'error',
      );
      setOpenId(run.id);
      void qc.invalidateQueries({ queryKey: ['law-sync', 'runs'] });
      void qc.invalidateQueries({ queryKey: ['laws'] });
    },
    onError: (err) => toast(apiErrorMessage(err, '법령 동기화를 실행하지 못했습니다.'), 'error'),
  });

  return (
    <div className="bg-white border border-gray-300 shadow-sm p-3 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-xs font-semibold text-gray-700">법령 동기화 (개정 확인)</div>
          <p className="text-[11px] text-gray-500 mt-0.5">
            등록된 법령에 새 판이 났는지 법제처에서 확인하고, 달라진 조항을 변경 기록으로 남깁니다. 서버
            예약 작업이 매일 실행하며 여기서 바로 실행할 수도 있습니다. <b>확인 실패는 "개정 없음"이 아니라
            "확인하지 못함"</b>입니다.
          </p>
        </div>
        <button
          type="button"
          className="btn-primary text-xs py-1.5 shrink-0 inline-flex items-center gap-1"
          disabled={runMutation.isPending}
          onClick={() => runMutation.mutate()}
        >
          <RefreshCw size={12} className={clsx(runMutation.isPending && 'animate-spin')} />
          {runMutation.isPending ? '확인 중…' : '지금 확인'}
        </button>
      </div>

      {isLoading ? (
        <p className="text-xs text-gray-500">불러오는 중...</p>
      ) : runs.length === 0 ? (
        <p className="text-xs text-gray-500">아직 실행 기록이 없습니다.</p>
      ) : (
        <ul className="divide-y divide-gray-100 border border-gray-200 rounded text-xs">
          {runs.map((run) => {
            const status = STATUS[run.status];
            const notable = (run.results ?? []).filter((r) => r.outcome !== 'unchanged' || r.note);
            const open = openId === run.id;
            return (
              <li key={run.id} className="px-3 py-2">
                <button
                  type="button"
                  className="w-full flex flex-wrap items-center gap-x-3 gap-y-1 text-left"
                  aria-expanded={open}
                  onClick={() => setOpenId(open ? null : run.id)}
                >
                  <span className="tabular-nums text-gray-600">
                    {new Date(run.startedAt).toLocaleString('ko-KR')}
                  </span>
                  <span className="text-gray-500">{run.trigger === 'schedule' ? '예약' : '수동'}</span>
                  <span className={clsx('px-1.5 py-0.5 rounded border text-[11px]', status.className)}>
                    {status.label}
                  </span>
                  <span className="text-gray-600">
                    확인 {run.checkedCount} · 새 판 {run.changedCount} · 변경 조항 {run.eventCount} · 실패{' '}
                    <span className={clsx(run.failedCount > 0 && 'text-red-700 font-semibold')}>
                      {run.failedCount}
                    </span>
                  </span>
                </button>
                {open && (
                  <div className="mt-2 space-y-1 text-[11px]">
                    {run.error && <p className="text-red-700">실행 오류: {run.error}</p>}
                    {notable.length === 0 && !run.error && (
                      <p className="text-gray-500">모든 법령이 최신 판입니다.</p>
                    )}
                    {notable.map((r) => (
                      <p
                        key={r.lawId}
                        className={clsx(r.outcome === 'failed' ? 'text-red-700' : 'text-gray-700')}
                      >
                        <b>{r.lawName}</b> —{' '}
                        {r.outcome === 'failed'
                          ? `확인 실패: ${r.error}${r.note ? ` — ${r.note}` : ''}`
                          : r.outcome === 'updated'
                            ? `새 판 반영 (MST ${r.fromMst} → ${r.toMst}), 변경 조항 ${r.events ?? 0}건`
                            : r.note}
                        <LawSyncVersions result={r} />
                      </p>
                    ))}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
