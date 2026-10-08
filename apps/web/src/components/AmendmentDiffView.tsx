import { clsx } from 'clsx';
import type { CandidateChange } from '../api/amendments';

/**
 * 제1 조문 대비 개정 후보 — 바뀐 부분을 눌러 근거를 보는 비교 표시 (T-107, 특허 도 11).
 *
 * 서버가 준 문자 구간(`diff.changes`)으로 그린다. 변경 하나(삭제+추가)가 한 단위라서, 누르면 그 변경의
 * 근거가 옆에 뜬다. 삭제는 취소선, 추가는 밑줄. 근거가 연결되지 않은 변경은 점선 테두리로 표시한다 —
 * 사람이 고쳤거나 규칙 밖에서 바뀐 곳이라 검토해야 한다. outline 이 아니라 border 로 그리는 것은, 누르면
 * 포커스 스타일이 outline 을 덮어 표시가 사라지기 때문이다.
 */
export default function AmendmentDiffView({
  base,
  changes,
  selected,
  onSelect,
}: {
  base: string;
  changes: CandidateChange[];
  selected: number | null;
  onSelect: (index: number) => void;
}) {
  const pieces: React.ReactNode[] = [];
  let pos = 0;
  for (const ch of changes) {
    if (ch.base.start > pos) pieces.push(<span key={`e${pos}`}>{base.slice(pos, ch.base.start)}</span>);
    const unexplained = ch.rationaleRefs.length === 0;
    pieces.push(
      <button
        key={`c${ch.index}`}
        type="button"
        onClick={() => onSelect(ch.index)}
        aria-pressed={selected === ch.index}
        aria-label={`변경 ${ch.index + 1}: ${ch.base.text ? `"${ch.base.text}" 삭제` : ''}${ch.base.text && ch.candidate.text ? ', ' : ''}${ch.candidate.text ? `"${ch.candidate.text}" 추가` : ''}${unexplained ? ' — 근거 없음' : ''}`}
        data-testid="amendment-change"
        className={clsx(
          'inline rounded-sm px-0.5 text-left align-baseline cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-navy-400',
          selected === ch.index ? 'ring-2 ring-navy-500' : 'hover:ring-1 hover:ring-navy-300',
          unexplained ? 'border border-dashed border-amber-500' : 'border border-transparent',
        )}
      >
        {ch.base.text && (
          <del title="삭제되는 문구" className="bg-rose-100 text-rose-900 line-through decoration-rose-400">
            {ch.base.text}
          </del>
        )}
        {ch.candidate.text && (
          <ins
            title="추가되는 문구"
            className="bg-emerald-100 text-emerald-900 font-medium underline decoration-emerald-600 underline-offset-2"
          >
            {ch.candidate.text}
          </ins>
        )}
      </button>,
    );
    pos = ch.base.end;
  }
  if (pos < base.length) pieces.push(<span key={`e${pos}`}>{base.slice(pos)}</span>);
  return <p className="whitespace-pre-wrap text-gray-800 leading-relaxed">{pieces}</p>;
}
