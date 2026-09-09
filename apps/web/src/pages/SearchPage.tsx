import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { searchApi } from '../api/policies';
import { useAuthStore } from '../stores/authStore';
import { clearHistory, loadHistory, pushHistory, removeHistory } from '../lib/searchHistory';
import { Search, FileText, BookOpen, Clock, X } from 'lucide-react';
import { useI18n } from '../i18n/useI18n';
import { PageHeader } from '../components/ui/PageHeader';
import { EmptyState } from '../components/ui/EmptyState';
import { LoadingBlock } from '../components/ui/LoadingBlock';

export default function SearchPage() {
  const { t } = useI18n();
  const [searchParams, setSearchParams] = useSearchParams();
  const [query, setQuery] = useState(searchParams.get('q') || '');
  const [submitted, setSubmitted] = useState(searchParams.get('q') || '');
  const { user } = useAuthStore();
  const tenantId = (user as any)?.tenantId ?? null;
  const [history, setHistory] = useState<string[]>(() => loadHistory(tenantId));
  const [openPanel, setOpenPanel] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  // 입력이 멎은 뒤에 부른다. 글자마다 때리면 한 단어 치는 동안 여러 번 나간다.
  const [debounced, setDebounced] = useState('');
  useEffect(() => {
    const id = setTimeout(() => setDebounced(query.trim()), 180);
    return () => clearTimeout(id);
  }, [query]);

  const { data: suggestions } = useQuery({
    queryKey: ['search-suggest', debounced],
    queryFn: () => searchApi.suggest(debounced),
    enabled: openPanel && debounced.length >= 1,
    staleTime: 30_000,
  });

  // 바깥을 누르면 패널을 닫는다
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpenPanel(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, []);

  const runSearch = (term: string) => {
    const value = term.trim();
    if (!value) return;
    setQuery(value);
    setSubmitted(value);
    setSearchParams({ q: value });
    setHistory(pushHistory(value, tenantId));
    setOpenPanel(false);
  };

  const hasSuggestions = useMemo(
    () => !!suggestions && (suggestions.policies.length > 0 || suggestions.articles.length > 0),
    [suggestions],
  );

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ['search', submitted],
    queryFn: () => searchApi.search(submitted),
    enabled: !!submitted,
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    runSearch(query);
  };

  const highlightText = (text: string, q: string) => {
    if (!q) return text;
    const idx = text.toLowerCase().indexOf(q.toLowerCase());
    if (idx === -1) return text.slice(0, 200);
    const start = Math.max(0, idx - 60);
    const end = Math.min(text.length, idx + q.length + 140);
    return (start > 0 ? '...' : '') + text.slice(start, end) + (end < text.length ? '...' : '');
  };

  const articleCount = data?.pagination?.total ?? data?.versions?.length ?? 0;

  return (
    <div className="page-shell max-w-3xl">
      <PageHeader title={t('search.title')} description={t('search.subtitle')} />

      <form onSubmit={handleSubmit} className="card p-4 flex gap-2">
        <div className="relative flex-1" ref={boxRef}>
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onFocus={() => setOpenPanel(true)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setOpenPanel(false);
            }}
            placeholder={t('search.placeholder')}
            className="input pl-10 text-sm"
            autoFocus
            role="combobox"
            aria-expanded={openPanel}
            aria-autocomplete="list"
          />

          {openPanel && (hasSuggestions || history.length > 0) && (
            <div className="absolute z-30 left-0 right-0 mt-1 bg-white border border-gray-300 rounded-lg shadow-lg max-h-80 overflow-auto">
              {!debounced && history.length > 0 && (
                <div className="py-1">
                  <div className="flex items-center justify-between px-3 py-1.5">
                    <span className="text-[11px] font-medium text-gray-500">최근 검색어</span>
                    <button
                      type="button"
                      className="text-[11px] text-gray-500 hover:text-gray-700 underline"
                      onClick={() => setHistory(clearHistory(tenantId))}
                    >
                      전체 삭제
                    </button>
                  </div>
                  {history.map((term) => (
                    <div key={term} className="flex items-center gap-1 px-1">
                      <button
                        type="button"
                        onClick={() => runSearch(term)}
                        className="flex-1 flex items-center gap-2 px-2 py-1.5 text-sm text-left text-gray-700 hover:bg-gray-50 rounded"
                      >
                        <Clock size={13} className="text-gray-400 flex-none" />
                        <span className="truncate">{term}</span>
                      </button>
                      <button
                        type="button"
                        aria-label={`${term} 삭제`}
                        onClick={() => setHistory(removeHistory(term, tenantId))}
                        className="p-1 text-gray-400 hover:text-gray-700"
                      >
                        <X size={13} />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {suggestions && suggestions.policies.length > 0 && (
                <div className="py-1 border-t border-gray-100 first:border-t-0">
                  <p className="px-3 py-1.5 text-[11px] font-medium text-gray-500">규정</p>
                  {suggestions.policies.map((p) => (
                    <Link
                      key={p.id}
                      to={`/policies/${p.id}`}
                      onClick={() => setOpenPanel(false)}
                      className="flex items-center gap-2 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
                    >
                      <FileText size={13} className="text-navy-500 flex-none" />
                      <span className="truncate">{p.title}</span>
                      <span className="ml-auto text-[10px] text-gray-400 font-mono flex-none">{p.code}</span>
                    </Link>
                  ))}
                </div>
              )}

              {suggestions && suggestions.articles.length > 0 && (
                <div className="py-1 border-t border-gray-100">
                  <p className="px-3 py-1.5 text-[11px] font-medium text-gray-500">조문</p>
                  {suggestions.articles.map((a) => (
                    <Link
                      key={a.id}
                      to={`/policies/${a.policyId}#제${a.number}조`}
                      onClick={() => setOpenPanel(false)}
                      className="flex items-center gap-2 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
                    >
                      <BookOpen size={13} className="text-gold-600 flex-none" />
                      <span className="truncate">
                        제{a.number}조 {a.title}
                      </span>
                      <span className="ml-auto text-[10px] text-gray-400 truncate max-w-[40%] flex-none">
                        {a.policyTitle}
                      </span>
                    </Link>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
        <button type="submit" className="btn-primary px-6">
          {t('search.button')}
        </button>
      </form>

      {submitted && (isLoading || isFetching) && <LoadingBlock label={t('search.searching')} />}

      {submitted && !(isLoading || isFetching) && (
        <div className="text-sm text-gray-500 px-1">
          {t('search.resultsFor', { q: submitted })}
          {data && (
            <span className="ml-1 text-gray-400">
              {t('search.meta', {
                pc: data.policies?.length || 0,
                ac: articleCount,
              })}
            </span>
          )}
        </div>
      )}

      {data && !(isLoading || isFetching) && (
        <div className="space-y-4">
          {data.policies?.length > 0 && (
            <div className="section-card">
              <div className="section-card__head flex items-center gap-2">
                <BookOpen size={14} />
                {t('search.sectionPoliciesCount', { n: data.policies.length })}
              </div>
              <table className="w-full gov-table">
                <thead>
                  <tr>
                    <th className="w-28">{t('search.code')}</th>
                    <th>{t('search.name')}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.policies.map((policy: any) => (
                    <tr key={policy.id}>
                      <td className="font-mono text-xs text-gray-500">{policy.code}</td>
                      <td>
                        <Link to={'/policies/' + policy.id} className="text-navy-700 hover:underline font-medium text-sm">
                          {policy.title}
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {data.versions?.length > 0 && (
            <div className="section-card">
              <div className="section-card__head flex items-center gap-2">
                <FileText size={14} />
                {t('search.sectionArticlesCount', { n: articleCount })}
              </div>
              <div className="divide-y divide-gray-100">
                {data.versions.map((version: any) => (
                  <Link
                    key={version.id}
                    to={'/policies/' + version.article?.chapter?.policy?.id}
                    className="flex gap-3 px-4 py-3.5 hover:bg-gray-50 transition-colors block"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="text-xs text-gray-400 mb-0.5">
                        {version.article?.chapter?.policy?.title}
                        {' > '}
                        {t('search.chapter', { ch: version.article?.chapter?.number })}
                        {' > '}
                        {t('search.article', { a: version.article?.number })}
                      </div>
                      <div className="text-sm font-medium text-navy-700 hover:underline mb-1">
                        {version.article?.title}
                      </div>
                      <div className="text-xs text-gray-500 line-clamp-2 bg-gray-50 border border-gray-200 rounded px-2 py-1">
                        {highlightText(version.content, submitted)}
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            </div>
          )}

          {data.policies?.length === 0 && data.versions?.length === 0 && (
            <div className="card">
              <EmptyState
                icon={Search}
                title={t('search.noResults', { q: submitted })}
                description={t('search.tryOther')}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
