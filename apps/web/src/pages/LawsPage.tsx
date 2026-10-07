/**
 * 법령 관리 (T-100·T-102). 등록된 법령 목록 + 법제처 검색으로 신규 등록.
 *
 * 법령은 테넌트 공용이다(ADR-0020) — 여기서 등록하면 모든 회사가 같이 본다.
 * 조회는 로그인만 하면 열리지만, 등록·삭제는 admin·editor 전용(백엔드 가드와 동일).
 */

import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, Plus, Scale, Search, Trash2, X } from 'lucide-react';
import { lawsApi } from '../api/laws';
import { lawGoKrApi } from '../api/lawgokr';
import { useAuthStore } from '../stores/authStore';
import { toast } from '../stores/toastStore';
import LawChangeList from '../components/LawChangeList';

export default function LawsPage() {
  const { user } = useAuthStore();
  const canEdit = user?.role === 'admin' || user?.role === 'editor';
  const qc = useQueryClient();
  const [showRegister, setShowRegister] = useState(false);

  const lawsQuery = useQuery({ queryKey: ['laws', 'list'], queryFn: lawsApi.list });

  const removeMutation = useMutation({
    mutationFn: lawsApi.remove,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['laws', 'list'] }),
  });

  const laws = lawsQuery.data || [];

  return (
    <div className="space-y-4">
      <div className="bg-white border border-gray-300 px-5 py-3 flex items-center justify-between shadow-sm">
        <div>
          <h1 className="text-base font-bold text-gray-800">법령 관리</h1>
          <p className="text-xs text-gray-500 mt-0.5">
            법제처에서 가져와 추적하는 상위 법령입니다. 조문 상세의 &quot;걸린 법&quot;이 여기 등록된
            법령을 참조합니다.
          </p>
        </div>
        {canEdit && (
          <button type="button" onClick={() => setShowRegister(true)} className="btn-primary text-sm py-1.5">
            <Plus size={15} /> 법령 등록
          </button>
        )}
      </div>

      {/* T-105: "법이 바뀌었고 우리 제28조가 걸려 있다"를 법령 화면 첫머리에서 알린다 */}
      {canEdit && laws.length > 0 && (
        <div className="bg-white border border-gray-300 shadow-sm px-5 py-3 space-y-2">
          <div>
            <h2 className="text-sm font-semibold text-gray-800">최근 법령 변경</h2>
            <p className="text-[11px] text-gray-500">
              추적 중인 법령에서 감지된 조문 변경입니다. 누르면 해당 법령에서 우리 회사의 어느 조문이 걸려
              있는지 볼 수 있습니다.
            </p>
          </div>
          <LawChangeList affectedOnlyDefault expandable={false} limit={20} />
        </div>
      )}

      {lawsQuery.isLoading && <p className="text-sm text-gray-500 px-1">불러오는 중…</p>}

      {!lawsQuery.isLoading && laws.length === 0 && (
        <div className="bg-white border border-dashed border-gray-300 rounded-lg p-10 text-center">
          <Scale size={36} className="mx-auto text-gray-300 mb-3" strokeWidth={1.25} />
          <p className="text-sm text-gray-700">등록된 법령이 없습니다.</p>
          {canEdit && (
            <p className="text-xs text-gray-500 mt-1">
              법제처에서 법령을 검색해 등록하면 조·항·호가 저장되고, 사내 조문과 연결할 수 있습니다.
            </p>
          )}
        </div>
      )}

      {laws.length > 0 && (
        <div className="bg-white border border-gray-300 shadow-sm overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200 text-xs text-gray-600">
              <tr>
                <th className="text-left px-4 py-2 font-medium">법령명</th>
                <th className="text-left px-4 py-2 font-medium">구분</th>
                <th className="text-left px-4 py-2 font-medium">조문 수</th>
                <th className="text-left px-4 py-2 font-medium">마지막 확인</th>
                {canEdit && <th className="w-10" />}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {laws.map((law) => (
                <tr key={law.id} className="hover:bg-gray-50/70">
                  <td className="px-4 py-2.5">
                    <Link to={`/laws/${law.id}`} className="font-medium text-navy-700 hover:underline">
                      {law.lawName}
                    </Link>
                    {law.lawNo && <span className="text-xs text-gray-400 ml-1.5">{law.lawNo}</span>}
                  </td>
                  <td className="px-4 py-2.5 text-xs text-gray-600">{law.lawType || '—'}</td>
                  <td className="px-4 py-2.5 text-xs text-gray-600 tabular-nums">{law.articleCount}</td>
                  <td className="px-4 py-2.5 text-xs text-gray-500 tabular-nums">
                    {law.lastCheckedAt ? new Date(law.lastCheckedAt).toLocaleString('ko-KR') : '—'}
                    {/* 확인 실패는 "개정 없음"이 아니다 — 지금 이 법령의 개정 여부를 모른다는 뜻이다 */}
                    {law.lastCheckError && (
                      <span
                        className="ml-1.5 inline-block text-[10px] px-1.5 py-0.5 rounded border border-red-200 bg-red-50 text-red-700 align-middle"
                        title={law.lastCheckError}
                      >
                        확인 실패
                      </span>
                    )}
                  </td>
                  {canEdit && (
                    <td className="px-4 py-2.5 text-right">
                      <button
                        type="button"
                        title="추적 해제"
                        className="text-gray-400 hover:text-red-600"
                        disabled={removeMutation.isPending}
                        onClick={() => {
                          if (!window.confirm(`"${law.lawName}" 추적을 해제할까요?`)) return;
                          removeMutation.mutate(law.id);
                        }}
                      >
                        <Trash2 size={14} />
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {removeMutation.isError && (
        <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded px-3 py-2">
          {(removeMutation.error as any)?.response?.data?.message?.toString() ||
            '삭제하지 못했습니다. 연결된 법령 관계 정보가 남아 있을 수 있습니다.'}
        </p>
      )}

      {showRegister && <RegisterLawModal onClose={() => setShowRegister(false)} />}
    </div>
  );
}

function RegisterLawModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [input, setInput] = useState('');
  const [query, setQuery] = useState('');
  const [error, setError] = useState('');

  const { data: config } = useQuery({ queryKey: ['lawgokr', 'status'], queryFn: lawGoKrApi.status });

  const searchQuery = useQuery({
    queryKey: ['lawgokr', 'search-for-register', query],
    queryFn: () => lawGoKrApi.search({ q: query, display: 20 }),
    enabled: !!query && config?.configured !== false,
  });

  const registerMutation = useMutation({
    mutationFn: (mst: string) => lawsApi.register(mst),
    onSuccess: (law) => {
      qc.invalidateQueries({ queryKey: ['laws', 'list'] });
      setError('');
      onClose();
      toast(`"${law.lawName}" ${law.articleCount}개 조문을 등록했습니다.`, 'success');
    },
    onError: (err: any) => {
      setError(err?.response?.data?.message?.toString() || '법령을 등록하지 못했습니다.');
    },
  });

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-white rounded-lg shadow-xl w-full max-w-lg max-h-[80vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
          <h2 className="text-sm font-semibold text-gray-800">법령 등록</h2>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-700">
            <X size={16} />
          </button>
        </div>

        <div className="p-4 space-y-3 overflow-y-auto">
          {config?.configured === false ? (
            <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded px-3 py-2">
              법제처 연동이 설정되지 않았습니다. 서버 환경변수 <code className="font-mono">LAW_GO_KR_OC</code>가
              필요합니다.
            </p>
          ) : (
            <>
              <form
                className="flex gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  const next = input.trim();
                  if (next) setQuery(next);
                }}
              >
                <div className="relative flex-1">
                  <Search size={15} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
                  <input
                    className="input w-full pl-8 text-sm"
                    placeholder="법령명 검색 (예: 근로기준법)"
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    autoFocus
                  />
                </div>
                <button type="submit" className="btn-primary text-sm" disabled={!input.trim()}>
                  검색
                </button>
              </form>

              {error && <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded px-3 py-2">{error}</p>}

              {searchQuery.isFetching && <p className="text-xs text-gray-500">검색 중…</p>}

              {searchQuery.data && (
                <ul className="divide-y divide-gray-100 border border-gray-200 rounded-lg overflow-hidden">
                  {searchQuery.data.items.map((law) => (
                    <li key={law.mst} className="flex items-center justify-between gap-3 p-2.5 hover:bg-gray-50/70">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-gray-900 truncate">{law.title}</p>
                        <p className="text-[11px] text-gray-500">
                          {[law.lawType, law.ministry].filter(Boolean).join(' · ')}
                        </p>
                      </div>
                      <button
                        type="button"
                        className="btn-primary text-xs whitespace-nowrap shrink-0"
                        disabled={registerMutation.isPending}
                        onClick={() => {
                          setError('');
                          registerMutation.mutate(law.mst);
                        }}
                      >
                        <Download size={13} />
                        {registerMutation.isPending && registerMutation.variables === law.mst
                          ? '등록 중…'
                          : '등록'}
                      </button>
                    </li>
                  ))}
                  {searchQuery.data.items.length === 0 && (
                    <li className="p-4 text-sm text-gray-500 text-center">검색 결과가 없습니다.</li>
                  )}
                </ul>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
