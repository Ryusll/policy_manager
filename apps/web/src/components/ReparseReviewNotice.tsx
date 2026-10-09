/**
 * 이 규정에 진행 중인 재파싱 검토 안내 (T-110) — 다시 가져온 원문을 비교해 두고 결정이 남았거나, 원문에 없어
 * 삭제 여부를 정하지 않은 조문이 있으면 검토 화면으로 이끈다.
 */
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { reparseApi, type ReparseReviewRow } from '../api/reparse';

export function ReparseReviewNotice({ policyId }: { policyId: string }) {
  const { data = [] } = useQuery<ReparseReviewRow[]>({
    queryKey: ['reparse-reviews', policyId],
    queryFn: () => reparseApi.listForPolicy(policyId),
  });
  const open = data.find((r) => r.status === 'open');
  if (!open) return null;
  return (
    <div
      className="rounded-lg border border-sky-300 bg-sky-50 px-3 py-2.5 text-xs text-sky-900 flex flex-col sm:flex-row sm:items-center gap-2"
      data-testid="reparse-notice"
    >
      <p className="flex-1 leading-relaxed">
        이 규정과 비교해 둔 원문이 있습니다 — <b>{open.sourceName}</b> · 결정 남음 {open.undecided}건
        {open.deletionUndecided > 0 && <> · 원문에 없어 삭제 여부를 정하지 않은 조문 {open.deletionUndecided}건</>}
      </p>
      <Link
        to={`/policies/${policyId}/reparse/${open.id}`}
        className="shrink-0 rounded bg-sky-700 px-3 py-1.5 font-medium text-white hover:bg-sky-800 text-center"
      >
        비교 결과 보기
      </Link>
    </div>
  );
}
