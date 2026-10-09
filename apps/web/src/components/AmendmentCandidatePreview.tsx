import { Link } from 'react-router-dom';
import { clsx } from 'clsx';
import {
  CONFIDENCE_LABEL,
  REVIEW_FLAG_LABEL,
  REVIEW_STATE_LABEL,
  RULE_LABEL,
  UNMAPPED_REASON_LABEL,
  VARIABLE_HOLD_LABEL,
  type AmendmentCandidate,
} from '../api/amendments';

/**
 * 개정 후보 미리보기 (T-106, 특허 도 11 검토 화면의 읽기 전용 부분).
 *
 * 제1 조문 대비 바뀐 곳을 **삭제는 취소선, 추가는 밑줄**로 보이고, 그 아래 무엇을 근거로 고쳤는지
 * (적용 규칙)와 **고치지 못한 법령 변경**을 함께 둔다 — 근거 없이 초안만 보이면 검토가 형식이 된다.
 * 손질·검토 요청은 T-107, 승인·반려는 T-108.
 */
export default function AmendmentCandidatePreview({
  candidate,
  isCurrentBase,
  repealedOn = null,
}: {
  candidate: AmendmentCandidate;
  isCurrentBase: boolean;
  /** 기준일에 조문이 폐지돼 있으면 그 폐지 시행일 — 다시 만들어도 후보가 생기지 않는다(T-126) */
  repealedOn?: string | null;
}) {
  const { rationale, diff } = candidate;
  const changes = rationale.lawChanges;
  // 생성 때 표시는 고정이라, 사람이 고친 뒤에도 "직접 작성 필요"로 남는다 — 본문을 보일지는 지금 판으로 정한다
  const manual = !candidate.current.hasChanges;

  return (
    <div className="mt-1.5 rounded border border-navy-100 bg-navy-50/30 px-2 py-1.5 space-y-1.5" data-testid="amendment-candidate">
      <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
        <span className="font-semibold text-navy-800">개정 후보</span>
        <span className="text-gray-500">{REVIEW_STATE_LABEL[candidate.reviewState]}</span>
        <span
          className={clsx(
            'px-1.5 py-0.5 rounded border',
            candidate.confidence === 'high' && 'border-emerald-300 text-emerald-800 bg-emerald-50',
            candidate.confidence === 'medium' && 'border-amber-300 text-amber-800 bg-amber-50',
            candidate.confidence === 'low' && 'border-gray-300 text-gray-600 bg-white',
          )}
          title="후보 신뢰도 — 법령 변경을 얼마나 확실하게 옮겼는지. 연결의 신뢰도와는 다르다"
        >
          신뢰도 {CONFIDENCE_LABEL[candidate.confidence]}
        </span>
        {candidate.reviewFlags
          .filter((f) => (f !== 'unmapped_law_change' || !manual) && f !== 'manual_draft_required')
          .map((f) => (
            <span key={f} className="px-1.5 py-0.5 rounded bg-amber-100 text-amber-900">
              {REVIEW_FLAG_LABEL[f] ?? f}
            </span>
          ))}
      </div>

      {manual && (
        <span className="px-1.5 py-0.5 rounded bg-amber-100 text-amber-900 text-[11px]">직접 작성 필요</span>
      )}
      {manual ? (
        <p className="text-[11px] text-amber-800">
          규칙으로 고칠 곳을 찾지 못해 본문은 기준 본문 그대로입니다 — 직접 고쳐야 합니다.
        </p>
      ) : (
        <p className="whitespace-pre-wrap text-gray-800 leading-relaxed" aria-label="개정 후보 본문 — 삭제는 취소선, 추가는 밑줄">
          {diff.parts.map((p, i) =>
            p.op === 'delete' ? (
              <del key={i} title="삭제되는 문구" className="bg-rose-100 text-rose-900 line-through decoration-rose-400">
                {p.text}
              </del>
            ) : p.op === 'insert' ? (
              <ins
                key={i}
                title="추가되는 문구"
                className="bg-emerald-100 text-emerald-900 font-medium underline decoration-emerald-600 underline-offset-2"
              >
                {p.text}
              </ins>
            ) : (
              <span key={i}>{p.text}</span>
            ),
          )}
        </p>
      )}

      {rationale.applications.length > 0 && (
        <ul className="text-[11px] text-gray-600 space-y-0.5">
          {rationale.applications.map((a) => (
            <li key={a.id}>
              <span className="text-gray-500">근거 · {RULE_LABEL[a.ruleId] ?? a.ruleId}</span>{' '}
              <span className="text-rose-800">{a.base.text}</span> → <span className="text-emerald-800">{a.candidate.text}</span>
            </li>
          ))}
        </ul>
      )}

      {/* 변수 값(T-109 ②) — 법령 근거와 따로. 이미 그 날 값인 자리는 빼고 보인다 */}
      {(rationale.variables ?? []).some((v) => v.status !== 'unchanged') && (
        <ul className="text-[11px] space-y-0.5" data-testid="candidate-variables">
          {(rationale.variables ?? [])
            .filter((v) => v.status !== 'unchanged')
            .map((v) => (
              <li key={v.index} className={v.status === 'applied' ? 'text-gray-600' : 'text-amber-900'}>
                <span className="text-violet-700">변수 · {v.label}</span>{' '}
                {v.status === 'applied' ? (
                  <>
                    <span className="text-rose-800">{v.base.text}</span> → <span className="text-emerald-800">{v.value}</span>{' '}
                    <span className="text-gray-500">(예정 사내 시행일 {candidate.plannedEffectiveDate} 값)</span>
                  </>
                ) : (
                  <>
                    "{v.base.text}" — {VARIABLE_HOLD_LABEL[v.reason ?? ''] ?? v.reason}
                  </>
                )}
              </li>
            ))}
        </ul>
      )}

      {rationale.unmapped.length > 0 && (
        <ul className="text-[11px] text-amber-900 space-y-0.5">
          {rationale.unmapped.map((u) => {
            const c = changes[u.lawChangeIndex];
            return (
              <li key={u.lawChangeIndex}>
                반영 못 한 법령 변경 ·{' '}
                {c ? (
                  <>
                    {c.before ? `"${c.before}"` : '(추가)'} → {c.after ? `"${c.after}"` : '(삭제)'}
                  </>
                ) : null}{' '}
                <span className="text-amber-700">— {u.detail ?? UNMAPPED_REASON_LABEL[u.reason] ?? u.reason}</span>
              </li>
            );
          })}
        </ul>
      )}

      <Link to={`/amendments/${candidate.id}`} className="inline-block text-[11px] text-navy-700 hover:underline">
        검토 화면에서 보기{candidate.current.edited ? ` (판 ${candidate.current.revision})` : ''}
      </Link>

      {!isCurrentBase &&
        (repealedOn ? (
          <p className="text-[11px] text-amber-800">
            이 후보를 만든 뒤 조문이 폐지됐습니다({repealedOn}) — 승인할 수 없으니 검토 화면에서 반려로 닫으세요.
          </p>
        ) : (
          <p className="text-[11px] text-amber-800">
            이 후보를 만든 뒤 기준 본문이 바뀌었습니다(v{candidate.baseVersion.versionNum} 기준) — 다시 만들면 지금 본문으로
            새 후보가 생깁니다.
          </p>
        ))}
    </div>
  );
}
