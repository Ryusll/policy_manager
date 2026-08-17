/**
 * 법제처에서 법령을 찾아 가져오기 세션을 만드는 패널 (T-55).
 *
 * 별도 컴포넌트로 둔 이유: 가져오기 화면은 이미 3단 위저드라, 검색·페이지네이션 상태까지
 * 같은 파일에 두면 원문 소스와 트리 편집 관심사가 섞인다. 여기는 "무엇을 가져올지"만 고른다.
 * 고른 뒤의 미리보기·수정·커밋은 PDF 경로와 완전히 같은 화면을 쓴다.
 */

import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Search, Scale, Download, ExternalLink } from 'lucide-react';
import { clsx } from 'clsx';
import { lawGoKrApi, type LawSearchItem } from '../api/lawgokr';
import { regulationParseApi, type ParseSession } from '../api/regulationParse';

const PAGE_SIZE = 20;

export function LawGoKrSearchPanel({
  onSessionCreated,
}: {
  onSessionCreated: (session: ParseSession) => void;
}) {
  const [input, setInput] = useState('');
  const [query, setQuery] = useState('');
  const [scope, setScope] = useState<'title' | 'fulltext'>('title');
  const [page, setPage] = useState(1);
  const [error, setError] = useState('');

  const { data: config } = useQuery({
    queryKey: ['lawgokr', 'status'],
    queryFn: lawGoKrApi.status,
    staleTime: 5 * 60 * 1000,
  });

  const {
    data: result,
    isFetching,
    error: searchError,
  } = useQuery({
    queryKey: ['lawgokr', 'search', query, scope, page],
    queryFn: () => lawGoKrApi.search({ q: query, page, display: PAGE_SIZE, scope }),
    enabled: !!query && config?.configured !== false,
  });

  const importMutation = useMutation({
    mutationFn: (mst: string) => regulationParseApi.createFromLawGoKr(mst),
    onSuccess: onSessionCreated,
    onError: (err: any) => {
      setError(err?.response?.data?.message?.toString() || '법령을 가져오지 못했습니다.');
    },
  });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const next = input.trim();
    if (!next) return;
    setError('');
    setPage(1);
    setQuery(next);
  };

  // 인증값이 없으면 검색 자체가 불가능하다. 실패를 기다리게 하지 말고 미리 알린다.
  if (config?.configured === false) {
    return (
      <div className="border border-amber-200 bg-amber-50 rounded-lg p-4 space-y-2">
        <p className="text-sm font-medium text-amber-900">법제처 연동이 설정되지 않았습니다.</p>
        <p className="text-xs text-amber-800 leading-relaxed">
          서버 환경변수 <code className="font-mono">LAW_GO_KR_OC</code>에 법제처 인증값을 넣어야 합니다.
          {' '}
          <a
            href="https://open.law.go.kr"
            target="_blank"
            rel="noreferrer noopener"
            className="underline font-medium"
          >
            open.law.go.kr
          </a>
          에서 OPEN API를 신청해 발급받으세요.
        </p>
        <p className="text-xs text-amber-800 leading-relaxed">
          인증값만으로는 부족합니다 — <b>배포 서버의 공인 IP</b>도 마이페이지 &gt; API인증키관리에
          등록해야 운영에서 호출이 통과합니다.
        </p>
      </div>
    );
  }

  const total = result?.total ?? 0;
  const lastPage = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="space-y-3">
      <form onSubmit={submit} className="flex flex-wrap gap-2">
        <div className="relative flex-1 min-w-[220px]">
          <Search size={15} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            className="input w-full pl-8 text-sm"
            placeholder="법령명 검색 (예: 근로기준법)"
            value={input}
            onChange={(e) => setInput(e.target.value)}
          />
        </div>
        <select
          className="input text-sm w-auto"
          value={scope}
          onChange={(e) => {
            setScope(e.target.value as 'title' | 'fulltext');
            setPage(1);
          }}
        >
          <option value="title">법령명</option>
          <option value="fulltext">본문 포함</option>
        </select>
        <button type="submit" className="btn-primary text-sm" disabled={!input.trim() || isFetching}>
          {isFetching ? '검색 중…' : '검색'}
        </button>
      </form>

      {error && (
        <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded px-3 py-2">{error}</p>
      )}
      {searchError && (
        <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded px-3 py-2">
          {(searchError as any)?.response?.data?.message?.toString() || '법제처 검색에 실패했습니다.'}
        </p>
      )}

      {!query && (
        <div className="border border-dashed border-gray-300 rounded-lg p-8 text-center">
          <Scale size={34} className="mx-auto text-gray-300 mb-3" strokeWidth={1.25} />
          <p className="text-sm text-gray-700">가져올 법령을 검색하세요.</p>
          <p className="text-xs text-gray-500 mt-1">
            국가법령정보 공동활용 API에서 조·항·호·목 구조를 그대로 받아옵니다.
          </p>
        </div>
      )}

      {query && result && result.items.length === 0 && !isFetching && (
        <p className="text-sm text-gray-600 px-1 py-6 text-center">
          &quot;{query}&quot; 검색 결과가 없습니다.
        </p>
      )}

      {result && result.items.length > 0 && (
        <>
          <p className="text-[11px] text-gray-500 px-1">
            전체 {total.toLocaleString()}건 · {page}/{lastPage} 페이지
          </p>
          <ul className="divide-y divide-gray-100 border border-gray-200 rounded-lg overflow-hidden">
            {result.items.map((law) => (
              <LawRow
                key={law.mst}
                law={law}
                busy={importMutation.isPending}
                pendingMst={importMutation.variables}
                onImport={(mst) => {
                  setError('');
                  importMutation.mutate(mst);
                }}
              />
            ))}
          </ul>
          {lastPage > 1 && (
            <div className="flex items-center justify-center gap-2 pt-1">
              <button
                type="button"
                className="btn-secondary text-xs"
                disabled={page <= 1 || isFetching}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                이전
              </button>
              <span className="text-xs text-gray-500 tabular-nums">
                {page} / {lastPage}
              </span>
              <button
                type="button"
                className="btn-secondary text-xs"
                disabled={page >= lastPage || isFetching}
                onClick={() => setPage((p) => p + 1)}
              >
                다음
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function LawRow({
  law,
  busy,
  pendingMst,
  onImport,
}: {
  law: LawSearchItem;
  busy: boolean;
  pendingMst?: string;
  onImport: (mst: string) => void;
}) {
  const isThis = busy && pendingMst === law.mst;
  const meta = [law.lawType, law.revisionType, law.ministry].filter(Boolean).join(' · ');
  return (
    <li className="flex items-start justify-between gap-3 p-3 bg-white hover:bg-gray-50/70">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-sm font-medium text-gray-900">{law.title}</span>
          {law.status && (
            <span
              className={clsx(
                'text-[10px] px-1.5 py-0.5 rounded font-medium',
                law.status === '현행'
                  ? 'bg-green-50 text-green-700 border border-green-200'
                  : 'bg-gray-100 text-gray-600 border border-gray-200',
              )}
            >
              {law.status}
            </span>
          )}
        </div>
        {meta && <p className="text-[11px] text-gray-500 mt-0.5">{meta}</p>}
        <p className="text-[11px] text-gray-500 mt-0.5 tabular-nums">
          {law.promulgationDate ? `공포 ${law.promulgationDate}` : ''}
          {law.effectiveDate ? ` · 시행 ${law.effectiveDate}` : ''}
        </p>
      </div>
      <div className="flex items-center gap-1.5 flex-none">
        <a
          href={`https://www.law.go.kr/LSW/lsInfoP.do?lsiSeq=${law.mst}`}
          target="_blank"
          rel="noreferrer noopener"
          className="btn-secondary text-xs"
          title="국가법령정보센터에서 원문 보기"
        >
          <ExternalLink size={13} />
        </a>
        <button
          type="button"
          className="btn-primary text-xs whitespace-nowrap"
          disabled={busy}
          onClick={() => onImport(law.mst)}
        >
          <Download size={13} />
          {isThis ? '가져오는 중…' : '가져오기'}
        </button>
      </div>
    </li>
  );
}
