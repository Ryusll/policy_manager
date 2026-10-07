import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { lawChangesApi, type ImpactedArticle } from '../api/lawChanges';
import { RELATION_TYPE_LABEL } from '../api/lawLinks';
import { formatArticleAnchor } from '../lib/articleAnchor';

/**
 * 법령 변경 하나가 우리 회사의 어느 조문에 걸리는지 (T-105).
 *
 * 확정된 연결만 영향으로 보이고, 자동 추천 연결은 "확인이 필요한 연결 N건"으로만 알린다.
 * 각 조문에는 **제1 조문**(기준일에 시행 중인 본문)을 함께 보여 준다 — 개정 초안(T-106)의 출발점이다.
 */
export default function LawImpactPanel({ eventId }: { eventId: string }) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['law-changes', 'impact', eventId],
    queryFn: () => lawChangesApi.impact(eventId),
  });

  if (isLoading) return <p className="text-xs text-gray-500">불러오는 중…</p>;
  if (isError || !data) return <p className="text-xs text-red-700">영향 분석을 불러오지 못했습니다.</p>;

  const { event } = data;
  const groups = new Map<string, ImpactedArticle[]>();
  for (const item of data.impacted) {
    const list = groups.get(item.policy.id) ?? [];
    list.push(item);
    groups.set(item.policy.id, list);
  }

  return (
    <div className="space-y-3 text-xs">
      <div className="grid gap-2 sm:grid-cols-2">
        <div>
          <div className="text-[11px] text-gray-500 mb-0.5">변경 전</div>
          <p className="whitespace-pre-wrap rounded border border-gray-200 bg-gray-50 px-2 py-1.5 text-gray-700 min-h-[2.5rem]">
            {event.beforeContent ?? <span className="text-gray-400">(없음 — 신설 조문)</span>}
          </p>
        </div>
        <div>
          <div className="text-[11px] text-gray-500 mb-0.5">변경 후</div>
          <p className="whitespace-pre-wrap rounded border border-navy-100 bg-navy-50/50 px-2 py-1.5 text-gray-800 min-h-[2.5rem]">
            {event.afterContent ?? <span className="text-gray-400">(없음 — 조문 삭제)</span>}
          </p>
        </div>
      </div>

      <p className="text-[11px] text-gray-500">
        기준일 <b className="text-gray-700 tabular-nums">{data.asOf}</b> — 법령 시행일과 오늘 중 늦은 날에 시행
        중인 우리 조문 본문을 기준으로 봅니다.
      </p>

      {data.unresolvable && (
        <p role="alert" className="rounded border border-amber-200 bg-amber-50 px-2 py-1.5 text-amber-800">
          {data.unresolvable}
        </p>
      )}

      {data.suggestedCount > 0 && (
        <p className="rounded border border-amber-200 bg-amber-50/70 px-2 py-1.5 text-amber-800">
          확인이 필요한 추천 연결이 <b>{data.suggestedCount}건</b> 있습니다. 추천 연결은 확정해야 영향
          분석에 들어갑니다 — 왼쪽에서 이 법령조항을 눌러 확정하거나 반려하세요.
        </p>
      )}

      {!data.unresolvable && data.impacted.length === 0 && (
        <p className="text-gray-500">이 변경에 확정된 연결로 걸린 우리 회사 조문이 없습니다.</p>
      )}

      {[...groups.values()].map((items) => {
        const policy = items[0].policy;
        return (
          <div key={policy.id} className="rounded border border-gray-200">
            <div className="px-2.5 py-1.5 border-b border-gray-100 bg-gray-50 flex items-center gap-2">
              <span className="font-semibold text-gray-800">{policy.title}</span>
              <span className="text-gray-400">{policy.code}</span>
              {!policy.isActive && (
                <span className="text-[10px] px-1.5 py-0.5 rounded border border-gray-300 text-gray-500">비활성 규정</span>
              )}
            </div>
            <ul className="divide-y divide-gray-100">
              {items.map((item) => (
                <ImpactRow key={item.linkId} item={item} />
              ))}
            </ul>
          </div>
        );
      })}
    </div>
  );
}

function ImpactRow({ item }: { item: ImpactedArticle }) {
  const anchor = formatArticleAnchor(item.article);
  return (
    <li className="px-2.5 py-2 space-y-1">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
        <Link to={`/policies/${item.policy.id}#${anchor}`} className="font-medium text-navy-700 hover:underline">
          {anchor}
        </Link>
        <span className="text-gray-700">{item.article.title}</span>
        <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-600">
          {RELATION_TYPE_LABEL[item.relationType]}
        </span>
        {item.evidenceText && <span className="text-[11px] text-gray-500">— {item.evidenceText}</span>}
      </div>
      {item.baseVersion ? (
        <div>
          <div className="text-[11px] text-gray-500">
            지금 기준 본문 · v{item.baseVersion.versionNum}
            {item.baseVersion.effectiveDate && ` · 시행 ${item.baseVersion.effectiveDate}`}
          </div>
          <p className="whitespace-pre-wrap text-gray-800 line-clamp-4">{item.baseVersion.content}</p>
        </div>
      ) : (
        <p className="text-[11px] text-amber-700">
          기준일에 시행 중인 본문이 없습니다(아직 시행 전이거나 초안뿐) — 이 조문은 개정 초안을 만들 수 없습니다.
        </p>
      )}
    </li>
  );
}
