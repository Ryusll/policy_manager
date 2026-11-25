import { Link } from 'react-router-dom';
import { versionDates, type VersionDateInput } from '../lib/versionDates';

/**
 * 버전 카드의 날짜 3종 줄(T-111, 특허 청구항 7) — 사내 규정 시행일 · 발행일시 · 법령 시행일.
 *
 * 법령·개정 후보 화면은 열람자가 열 수 없어(App 의 열람자 경로 제한) `linkable` 이 아니면 링크 없이 글자만 보인다.
 */
export function VersionDatesLine({
  version,
  linkable,
}: {
  version: VersionDateInput & { sourceCandidateId?: string | null };
  linkable: boolean;
}) {
  const d = versionDates(version);
  if (!d) return null;
  const lawText = d.law ? `${d.law.lawName} ${d.law.label}` : '';
  return (
    <p className="mt-1.5 mb-2 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[11px] text-gray-600" data-testid="version-dates">
      <span data-testid="version-date-effective">
        사내 시행일 <span className="font-medium text-gray-800">{d.effective ?? '기록 없음'}</span>
        {d.upcoming && <span className="ml-1 text-amber-800">(시행 예정)</span>}
      </span>
      <span aria-hidden className="text-gray-300">
        ·
      </span>
      <span data-testid="version-date-published">
        발행{' '}
        {d.published ? (
          <span className="font-medium text-gray-800">{d.published}</span>
        ) : (
          <span className="text-gray-500">기록 없음</span>
        )}
        {d.publishedBasis === 'approval' && (
          <span
            className="ml-1 text-gray-500"
            title="발행일을 기록하기 전에 발행한 버전이라, 발행하는 순간에 함께 적어 둔 승인 시각으로 채웠습니다"
          >
            (승인 기록으로 보정)
          </span>
        )}
      </span>
      {d.law && (
        <>
          <span aria-hidden className="text-gray-300">
            ·
          </span>
          <span data-testid="version-date-law">
            법령 시행일 <span className="font-medium text-gray-800">{d.law.date ?? '기록 없음'}</span> (
            {linkable ? (
              <Link to={`/laws/${d.law.lawId}?change=${d.law.eventId}`} className="text-navy-700 hover:underline">
                {lawText}
              </Link>
            ) : (
              lawText
            )}
            )
          </span>
          {d.law.early && (
            <span
              className="px-1.5 py-0.5 rounded bg-amber-100 text-amber-900"
              title="사내 규정을 법령 시행일보다 먼저 시행합니다 — 승인할 때 그 이유를 적었습니다"
              data-testid="version-date-early"
            >
              법령보다 조기 시행
            </span>
          )}
          {linkable && version.sourceCandidateId && (
            <Link to={`/amendments/${version.sourceCandidateId}`} className="text-navy-700 hover:underline">
              {d.law.early ? '승인 사유 보기' : '개정 후보 보기'}
            </Link>
          )}
        </>
      )}
    </p>
  );
}
