import { useState } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { searchApi } from '../api/policies';
import { Search, FileText, BookOpen } from 'lucide-react';
import { useI18n } from '../i18n/useI18n';
import { PageHeader } from '../components/ui/PageHeader';
import { EmptyState } from '../components/ui/EmptyState';
import { LoadingBlock } from '../components/ui/LoadingBlock';

export default function SearchPage() {
  const { t } = useI18n();
  const [searchParams, setSearchParams] = useSearchParams();
  const [query, setQuery] = useState(searchParams.get('q') || '');
  const [submitted, setSubmitted] = useState(searchParams.get('q') || '');

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ['search', submitted],
    queryFn: () => searchApi.search(submitted),
    enabled: !!submitted,
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (query.trim()) {
      setSubmitted(query.trim());
      setSearchParams({ q: query.trim() });
    }
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
        <div className="relative flex-1">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('search.placeholder')}
            className="input pl-10 text-sm"
            autoFocus
          />
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
