import { highlightText } from '../../lib/highlightSearch';
import { articleHeadingSegments } from '../../lib/articleHeading';

/**
 * 조 머리 글 — 번호와 제목을 붙여 한 줄로 적는다: `제1조(목적)` (SRS POLICY-10, T-211).
 *
 * 검색 중에는 번호와 제목 조각만 따로 강조한다(괄호는 대상이 아니다). 일치 개수(`countFullViewMatches`)가
 * 제목을 세는 단위와 같아야 `n/m` 과 화면의 강조 수가 맞는다.
 */
export function JoHeadingText({
  number,
  branch,
  title,
  highlightQuery = '',
}: {
  number: number;
  branch?: number | null;
  /** 조 제목. 비어 있으면 번호만 적는다 */
  title?: string | null;
  highlightQuery?: string;
}) {
  const segments = articleHeadingSegments(number, branch, title);
  if (!highlightQuery.trim()) return <>{segments.map((s) => s.text).join('')}</>;
  return (
    <>
      {segments.map((s, i) => (
        <span key={i}>{s.part === 'paren' ? s.text : highlightText(s.text, highlightQuery)}</span>
      ))}
    </>
  );
}
