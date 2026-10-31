/**
 * 이 규정에 진행 중인 재파싱 검토 안내 (T-110) — 비교해 두고 결정이 남았거나, 반영한 묶음이 검토 요청·승인을 기다리거나,
 * 승인 뒤에도 원문에 없어 삭제 여부를 정하지 않은 조문이 있으면 검토 화면으로 이끈다.
 */
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { reparseApi, type ReparseReviewRow } from '../api/reparse';

function message(r: ReparseReviewRow): string | null {
  switch (r.status) {
    case 'open':
      return `이 규정과 비교해 둔 원문이 있습니다 — ${r.sourceName} · 결정 남음 ${r.undecided}건`;
    case 'applied':
      return `다시 가져온 원문을 반영해 묶음 초안을 만들었습니다 — ${r.sourceName} · 묶음 검토 요청 전`;
    case 'submitted':
      return `재파싱 묶음이 검토 중입니다 — ${r.sourceName} · 관리자 승인 대기`;
    case 'approved':
    case 'rejected':
      return r.deletionUndecided > 0 ? `원문에 없어 삭제 여부를 정하지 않은 조문이 있습니다 — ${r.deletionUndecided}건` : null;
    default:
      return null;
  }
}

export function ReparseReviewNotice({ policyId }: { policyId: string }) {
  const { data = [] } = useQuery<ReparseReviewRow[]>({
    queryKey: ['reparse-reviews', policyId],
    queryFn: () => reparseApi.listForPolicy(policyId),
  });
  const current = data.find((r) => r.status !== 'superseded');
  const text = current ? message(current) : null;
  if (!current || !text) return null;
  return (
    <div
      className="rounded-lg border border-sky-300 bg-sky-50 px-3 py-2.5 text-xs text-sky-900 flex flex-col sm:flex-row sm:items-center gap-2"
      data-testid="reparse-notice"
    >
      <p className="flex-1 leading-relaxed">
        {current.status === 'open' && current.deletionUndecided > 0
          ? `${text} · 원문에 없어 삭제 여부를 정하지 않은 조문 ${current.deletionUndecided}건`
          : text}
      </p>
      <Link
        to={`/policies/${policyId}/reparse/${current.id}`}
        className="shrink-0 rounded bg-sky-700 px-3 py-1.5 font-medium text-white hover:bg-sky-800 text-center"
      >
        재파싱 검토 보기
      </Link>
    </div>
  );
}
