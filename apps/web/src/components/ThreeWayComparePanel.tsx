/**
 * 3단비교 (T-56) — 규정 · 세칙 · 지침을 나란히 본다.
 *
 * 짝짓기는 서버가 하위 조문 본문의 상위 규정 인용("규정 제5조")으로 판단한다.
 * 조 번호를 그냥 맞추지 않는 이유는 세칙 제1조가 규정 제1조와 관계있다는 보장이
 * 없기 때문이다 — 그렇게 하면 표가 그럴듯하게 틀린다.
 */

import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Columns3, Info } from 'lucide-react';
import { policiesApi, type ThreeWayRow } from '../api/policies';
import { LoadingBlock } from './ui/LoadingBlock';
import { EmptyState } from './ui/EmptyState';

const LEVEL_LABEL = ['규정', '세칙', '지침'];

function ArticleCell({ article }: { article: { number: number; title: string; content: string } }) {
  return (
    <div className="space-y-0.5">
      <p className="text-xs font-semibold text-gray-900">
        제{article.number}조{article.title ? ` (${article.title})` : ''}
      </p>
      <p className="text-xs text-gray-600 whitespace-pre-wrap line-clamp-6">{article.content}</p>
    </div>
  );
}

function Row({ row, levelPolicies }: { row: ThreeWayRow; levelPolicies: Map<string, string> }) {
  const byLevel = (level: number) => row.related.filter((r) => r.level === level);
  return (
    <tr className="align-top border-t border-gray-100">
      <td className="p-3 w-[34%]">
        {row.base ? (
          <ArticleCell article={row.base} />
        ) : (
          <span className="text-xs text-gray-400">— 연결된 상위 조문 없음 —</span>
        )}
      </td>
      {[1, 2].map((level) => (
        <td key={level} className="p-3 w-[33%]">
          {byLevel(level).length === 0 ? (
            <span className="text-xs text-gray-300">—</span>
          ) : (
            <div className="space-y-3">
              {byLevel(level).map((rel) => (
                <div key={rel.article.id}>
                  <p className="text-[10px] text-navy-600 mb-0.5">{levelPolicies.get(rel.policyId)}</p>
                  <ArticleCell article={rel.article} />
                </div>
              ))}
            </div>
          )}
        </td>
      ))}
    </tr>
  );
}

export function ThreeWayComparePanel({ policyId }: { policyId: string }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['policy', policyId, 'three-way'],
    queryFn: () => policiesApi.threeWay(policyId),
  });

  if (isLoading) return <LoadingBlock label="3단비교를 불러오는 중" />;
  if (error) {
    return (
      <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded px-3 py-2">
        {(error as any)?.response?.data?.message?.toString() || '3단비교를 불러오지 못했습니다.'}
      </p>
    );
  }
  if (!data) return null;

  const levelPolicies = new Map(data.levels.map((p) => [p.id, p.title]));
  const lower = data.levels.filter((p) => p.level > 0);

  if (lower.length === 0) {
    return (
      <EmptyState
        title="하위 규정이 없습니다"
        description="규정 목록의 체계도에서 이 규정을 상위로 하는 세칙·지침을 지정하면 여기에 나란히 표시됩니다."
      />
    );
  }

  const allRows = [...data.rows, ...data.unmatched];

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-600">
        <span className="inline-flex items-center gap-1.5 font-medium text-gray-800">
          <Columns3 size={14} /> 3단비교
        </span>
        <span>기준 조문 {data.summary.baseArticles}건</span>
        <span>연결 {data.summary.related}건</span>
        {data.summary.unmatched > 0 && (
          <span className="text-amber-700">연결 안 됨 {data.summary.unmatched}건</span>
        )}
      </div>

      <div className="flex items-start gap-2 text-[11px] text-gray-500 bg-gray-50 border border-gray-200 rounded px-3 py-2">
        <Info size={13} className="flex-none mt-0.5" />
        <p>
          하위 조문이 본문에서 <b>&quot;규정 제5조&quot;</b>처럼 상위를 인용한 것을 근거로 짝지었습니다.
          인용이 없으면 표 아래 &quot;연결 안 됨&quot;에 모읍니다.
        </p>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] border border-gray-200 rounded-lg overflow-hidden bg-white">
          <thead>
            <tr className="bg-gray-50 text-left">
              {[0, 1, 2].map((level) => (
                <th key={level} className="p-3 text-xs font-semibold text-gray-700">
                  {LEVEL_LABEL[level]}
                  {level === 0 && <span className="ml-1 font-normal text-gray-400">{data.base.title}</span>}
                  {level > 0 && (
                    <span className="ml-1 font-normal text-gray-400">
                      {lower
                        .filter((p) => p.level === level)
                        .map((p) => p.title)
                        .join(', ') || '—'}
                    </span>
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {allRows.map((row, i) => (
              <Row
                key={row.base?.id ?? `unmatched-${i}`}
                row={row}
                levelPolicies={levelPolicies}
              />
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-[11px] text-gray-400">
        하위 규정은{' '}
        <Link to="/policies" className="underline">
          규정 목록 &gt; 체계도
        </Link>
        에서 지정합니다.
      </p>
    </div>
  );
}
