import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, Columns2, X } from 'lucide-react';
import { policiesApi, type CrossPolicyRow } from '../api/policies';
import { LoadingBlock } from './ui/LoadingBlock';
import { EmptyState } from './ui/EmptyState';

/**
 * 규정 간 비교 (T-91) — 서로 다른 두 규정을 나란히 본다.
 *
 * 기존 두 비교와 다른 기능이다.
 *  - 신구조문대비표(T-56): **같은 규정**의 두 시점
 *  - 3단비교(T-56): 규정↔세칙↔지침, 본문의 인용 관계로 짝짓기
 *  - 여기: 인용 관계가 없는 **두 문서**를 조·항·목 번호로 맞댐
 *
 * 번호로 맞추는 건 가정이다(본사↔지사 규정처럼 같은 뼈대일 때만 맞다).
 * 그래서 번호는 같은데 제목이 다른 줄에 경고를 붙인다 — 조용히 짝지으면
 * 표가 그럴듯하게 틀린다.
 */

const KIND_LABEL: Record<CrossPolicyRow['kind'], string> = {
  same: '같음',
  different: '다름',
  'left-only': '왼쪽에만',
  'right-only': '오른쪽에만',
};

const KIND_CLASS: Record<CrossPolicyRow['kind'], string> = {
  same: 'bg-gray-100 text-gray-600',
  different: 'bg-amber-100 text-amber-800',
  'left-only': 'bg-sky-100 text-sky-800',
  'right-only': 'bg-violet-100 text-violet-800',
};

function articleLabel(row: CrossPolicyRow): string {
  if (row.itemNumber != null) return `${row.itemNumber}.`;
  if (row.clauseNumber != null) return `제${row.clauseNumber}항`;
  return `제${row.number}조`;
}

function SideCell({ side, diff, which }: {
  side: CrossPolicyRow['left'];
  diff: CrossPolicyRow['diff'];
  which: 'left' | 'right';
}) {
  if (!side) return <span className="text-xs text-gray-300">—</span>;
  return (
    <div className="space-y-1">
      {side.title && <p className="text-xs font-semibold text-gray-900">{side.title}</p>}
      <p className="text-xs text-gray-700 whitespace-pre-wrap">
        {diff
          ? diff
              // 왼쪽 칸에서는 추가분을, 오른쪽 칸에서는 삭제분을 빼고 보여 준다
              .filter((part) => (which === 'left' ? !part.added : !part.removed))
              .map((part, i) => (
                <span
                  key={i}
                  className={
                    part.added
                      ? 'bg-green-100 text-green-900'
                      : part.removed
                        ? 'bg-red-100 text-red-900 line-through'
                        : undefined
                  }
                >
                  {part.value}
                </span>
              ))
          : side.content}
      </p>
    </div>
  );
}

export default function CrossPolicyComparePanel({
  policyId,
  policyTitle,
  onClose,
}: {
  policyId: string;
  policyTitle: string;
  onClose: () => void;
}) {
  const [targetId, setTargetId] = useState('');
  const [onlyDifferences, setOnlyDifferences] = useState(true);

  const { data: policies = [] } = useQuery({
    queryKey: ['policies'],
    queryFn: () => policiesApi.list(),
  });

  const candidates = useMemo(
    () => (policies as any[]).filter((p) => p.id !== policyId),
    [policies, policyId],
  );

  const { data, isFetching, error } = useQuery({
    queryKey: ['crossCompare', policyId, targetId],
    queryFn: () => policiesApi.compareWith(policyId, targetId),
    enabled: !!targetId,
  });

  const rows = useMemo(() => {
    if (!data) return [];
    return onlyDifferences ? data.rows.filter((r) => r.kind !== 'same') : data.rows;
  }, [data, onlyDifferences]);

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white border border-gray-300 shadow-xl w-full max-w-6xl max-h-[90vh] flex flex-col">
        <div className="bg-navy-800 text-white px-4 py-3 flex items-center justify-between flex-shrink-0">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Columns2 size={16} />
            규정 간 비교
          </div>
          <button type="button" className="text-navy-200 hover:text-white p-1" onClick={onClose} aria-label="닫기">
            <X size={18} />
          </button>
        </div>

        <div className="p-4 space-y-3 overflow-auto">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="font-medium text-navy-800">{policyTitle}</span>
            <span className="text-gray-400">↔</span>
            <select
              value={targetId}
              onChange={(e) => setTargetId(e.target.value)}
              className="border border-gray-300 rounded px-2 py-1 text-sm min-w-[16rem]"
              aria-label="비교할 규정"
            >
              <option value="">비교할 규정을 고르세요</option>
              {candidates.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.code} {p.title}
                </option>
              ))}
            </select>
            {data && (
              <label className="ml-auto inline-flex items-center gap-1.5 text-xs text-gray-600">
                <input
                  type="checkbox"
                  checked={onlyDifferences}
                  onChange={(e) => setOnlyDifferences(e.target.checked)}
                />
                다른 조문만
              </label>
            )}
          </div>

          {/* 번호로 맞춘 결과라는 것을 먼저 말한다. 표를 그대로 믿게 두면 안 된다. */}
          <p className="text-[11px] text-gray-500 bg-gray-50 border border-gray-200 rounded px-2 py-1.5">
            서로 다른 두 규정은 공유하는 조문 식별자가 없어 <strong>조·항·목 번호</strong>로 맞댑니다.
            두 규정의 조 번호 체계가 다르면 짝이 어긋날 수 있습니다 — 번호는 같은데 제목이 다른 줄에는
            경고 표시가 붙습니다.
          </p>

          {!targetId ? (
            <EmptyState title="비교할 규정을 고르세요" description="같은 기관의 다른 규정과 조문을 나란히 대조합니다." />
          ) : isFetching ? (
            <LoadingBlock />
          ) : error ? (
            <p className="text-sm text-red-600">비교를 불러오지 못했습니다.</p>
          ) : data ? (
            <>
              <div className="flex flex-wrap gap-2 text-xs">
                <span className="px-2 py-1 rounded bg-gray-100 text-gray-700">같음 {data.summary.same}</span>
                <span className="px-2 py-1 rounded bg-amber-100 text-amber-800">다름 {data.summary.different}</span>
                <span className="px-2 py-1 rounded bg-sky-100 text-sky-800">왼쪽에만 {data.summary.leftOnly}</span>
                <span className="px-2 py-1 rounded bg-violet-100 text-violet-800">오른쪽에만 {data.summary.rightOnly}</span>
                {data.summary.suspect > 0 && (
                  <span className="px-2 py-1 rounded bg-red-50 text-red-700 inline-flex items-center gap-1">
                    <AlertTriangle size={12} /> 짝이 의심스러운 줄 {data.summary.suspect}
                  </span>
                )}
              </div>

              {rows.length === 0 ? (
                <EmptyState title="다른 조문이 없습니다" description="두 규정의 본문이 모두 같습니다." />
              ) : (
                <table className="w-full text-left border border-gray-200">
                  <thead className="bg-gray-50 text-xs text-gray-600">
                    <tr>
                      <th className="p-2 w-24">위치</th>
                      <th className="p-2 w-[38%]">{data.left.code}</th>
                      <th className="p-2 w-[38%]">{data.right.code}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => (
                      <tr key={row.key} className="align-top border-t border-gray-100">
                        <td className="p-2">
                          <div className="text-xs font-medium text-gray-800">{articleLabel(row)}</div>
                          <span className={`inline-block mt-1 px-1.5 py-0.5 rounded text-[10px] ${KIND_CLASS[row.kind]}`}>
                            {KIND_LABEL[row.kind]}
                          </span>
                          {row.titleDiffers && (
                            <span
                              className="mt-1 flex items-center gap-1 text-[10px] text-red-700"
                              title="번호는 같은데 제목이 다릅니다. 같은 조문이 아닐 수 있습니다."
                            >
                              <AlertTriangle size={10} /> 제목 불일치
                            </span>
                          )}
                        </td>
                        <td className="p-2"><SideCell side={row.left} diff={row.diff} which="left" /></td>
                        <td className="p-2"><SideCell side={row.right} diff={row.diff} which="right" /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}
