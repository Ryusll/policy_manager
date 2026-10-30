import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import {
  amendmentsApi,
  type ApproveBlock,
  CONFIDENCE_LABEL,
  REVIEW_FLAG_LABEL,
  REVIEW_STATE_LABEL,
  RULE_LABEL,
  UNMAPPED_REASON_LABEL,
  VARIABLE_HOLD_LABEL,
  type AmendmentDetail,
  type AmendmentHistory,
  type CandidateChange,
  type VariableEntry,
} from '../api/amendments';
import { RELATION_TYPE_LABEL } from '../api/lawLinks';
import AmendmentDiffView from '../components/AmendmentDiffView';
import { CorrectionHistoryLabel, CorrectionNotice, IssuedSourceLink, RejectionCorrectionPanel } from '../components/AmendmentCorrection';
import AmendmentDocumentButton from '../components/AmendmentDocumentButton';
import EvidenceSource from '../components/EvidenceSource';
import EffectiveNotesLine from '../components/EffectiveNotesLine';
import { formatArticleAnchor } from '../lib/articleAnchor';
import { serviceToday } from '../lib/serviceDate';
import { versionDates } from '../lib/versionDates';
import { toast } from '../stores/toastStore';
import { useAuthStore } from '../stores/authStore';
import { StateBadge } from './AmendmentsPage';

/**
 * 개정 후보 검토 화면 (T-107, 특허 도 11).
 *
 * 기준 본문(제1 조문) · 개정 후보(바뀐 곳을 누르면) · 그 변경의 근거를 나란히 둔다. 근거가 없는 변경은
 * 점선으로 표시한다 — 사람이 고쳤거나 규칙 밖에서 바뀐 곳이라 검토해야 한다. 승인·반려(관리자, T-108)는 검토
 * 중인 후보에서 — 승인하면 같은 조문의 후속 버전이 발행된다.
 */
export default function AmendmentDetailPage() {
  const { id } = useParams<{ id: string }>();
  const user = useAuthStore((s) => s.user);
  const canReview = user?.role === 'admin' || user?.role === 'editor';
  const [selected, setSelected] = useState<number | null>(null);
  // 다른 후보로 옮기면(다시 만들기 등) 고른 변경을 푼다 — 번호가 그 후보의 다른 변경을 가리킨다
  useEffect(() => setSelected(null), [id]);

  const { data, isLoading, isError } = useQuery({
    queryKey: ['amendment', id],
    queryFn: () => amendmentsApi.get(id!),
    enabled: !!id && canReview,
  });
  const { data: history } = useQuery({
    queryKey: ['amendment', id, 'history'],
    queryFn: () => amendmentsApi.history(id!),
    enabled: !!id && canReview,
  });

  if (!canReview) {
    return (
      <div className="max-w-2xl bg-white border border-gray-300 shadow-sm p-5">
        <p className="text-sm text-gray-600">개정 후보는 관리자·편집자만 볼 수 있습니다.</p>
      </div>
    );
  }
  if (isLoading) return <p className="text-sm text-gray-500">불러오는 중…</p>;
  if (isError || !data) return <p className="text-sm text-red-700">개정 후보를 찾을 수 없습니다.</p>;

  const changes = data.diff.changes ?? [];
  const selectedChange = changes.find((c) => c.index === selected) ?? null;

  return (
    <div className="page-shell space-y-4">
      <Header data={data} />
      <Alerts data={data} />

      <div className="grid gap-3 lg:grid-cols-3">
        <section className="card p-3 space-y-1.5" aria-labelledby="base-title">
          <h2 id="base-title" className="text-sm font-semibold text-gray-800">
            기준 본문 <span className="font-normal text-gray-500">(제1 조문 · v{data.baseVersion.versionNum}
            {data.baseVersion.effectiveDate && ` · 시행 ${data.baseVersion.effectiveDate}`})</span>
          </h2>
          <p className="whitespace-pre-wrap text-sm text-gray-800 leading-relaxed">{data.baseVersion.content}</p>
        </section>

        <section className="card p-3 space-y-1.5" aria-labelledby="cand-title">
          <h2 id="cand-title" className="text-sm font-semibold text-gray-800">
            개정 후보 <span className="font-normal text-gray-500">(판 {data.revision})</span>
          </h2>
          {data.current.hasChanges ? (
            <>
              <div className="text-sm">
                <AmendmentDiffView
                  base={data.baseVersion.content}
                  changes={changes}
                  selected={selected}
                  onSelect={(i) => setSelected((prev) => (prev === i ? null : i))}
                />
              </div>
              <p className="text-[11px] text-gray-500">
                바뀐 곳 {changes.length} · 근거 없는 변경 {data.current.unexplained} — 바뀐 곳을 누르면 근거가 보입니다
              </p>
            </>
          ) : (
            <p className="text-sm text-amber-800">
              기준 본문과 같습니다 — 규칙으로 고칠 곳을 찾지 못했습니다.
              {data.reviewState === 'draft' &&
                ' 아래에서 직접 고치거나, 개정이 필요 없으면 그 이유를 적어 검토를 요청하세요.'}
            </p>
          )}
        </section>

        <section className="card p-3 space-y-1.5" aria-labelledby="why-title" aria-live="polite">
          <h2 id="why-title" className="text-sm font-semibold text-gray-800">
            변경 근거
          </h2>
          {selectedChange ? (
            <ChangeRationale data={data} change={selectedChange} />
          ) : (
            <RationaleOverview data={data} />
          )}
        </section>
      </div>

      <LawChangeCard data={data} />
      {data.reviewState === 'review' && user?.role === 'admin' && <DecisionPanel data={data} />}
      {data.reviewState === 'rejected' && <RejectionCorrectionPanel data={data} canCorrect={user?.role === 'admin'} />}
      {/* 발행본이 후보를 쥔 반려 후보는 손질로도 다시 열 수 없다(서버 409) — 까닭은 반려 정정 자리에(모든 역할) */}
      {data.reviewState !== 'approved' && !(data.reviewState === 'rejected' && data.resultVersion) && <Actions data={data} />}
      {history && <HistoryCard history={history} />}
      {data.siblings.length > 0 && (
        <section className="card p-3 space-y-1.5">
          <h2 className="text-sm font-semibold text-gray-800">같은 법령 변경·조문의 다른 후보</h2>
          <ul className="text-xs space-y-1">
            {data.siblings.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center gap-2">
                <Link to={`/amendments/${s.id}`} className="text-navy-700 hover:underline">
                  기준 본문 v{s.baseVersionNum} · 판 {s.revision}
                </Link>
                <StateBadge state={s.reviewState} />
                <span className="text-gray-500">{new Date(s.createdAt).toLocaleString('ko-KR')}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function Header({ data }: { data: AmendmentDetail }) {
  return (
    <div className="bg-white border border-gray-300 px-5 py-3 shadow-sm space-y-1.5">
      <Link to="/amendments" className="text-xs text-gray-500 hover:text-gray-800 inline-flex items-center gap-1">
        <ArrowLeft size={12} /> 개정 검토
      </Link>
      <h1 className="text-base font-bold text-gray-800 flex flex-wrap items-center gap-2">
        <Link to={`/policies/${data.policy.id}#${formatArticleAnchor(data.article)}`} className="hover:underline">
          {data.policy.title} {formatArticleAnchor(data.article)}
        </Link>
        <span className="font-normal text-gray-700">{data.article.title}</span>
        <StateBadge state={data.reviewState} />
      </h1>
      <div className="flex flex-wrap gap-1.5 text-[11px]">
        <span className="px-1.5 py-0.5 rounded border border-gray-300 text-gray-700" title="만들 때 규칙이 법령 변경을 얼마나 확실하게 옮겼는지. 연결의 신뢰도와 다르다">
          생성 시 신뢰도 {CONFIDENCE_LABEL[data.confidence]}
        </span>
        {data.reviewFlags
          .filter((f) => f !== 'manual_draft_required' && f !== 'unexplained_change')
          .map((f) => (
            <span key={f} className="px-1.5 py-0.5 rounded bg-amber-100 text-amber-900">
              {REVIEW_FLAG_LABEL[f] ?? f}
            </span>
          ))}
        {!data.current.hasChanges && <span className="px-1.5 py-0.5 rounded bg-amber-100 text-amber-900">직접 작성 필요</span>}
        {data.current.unexplained > 0 && (
          <span className="px-1.5 py-0.5 rounded bg-amber-100 text-amber-900">근거 없는 변경 {data.current.unexplained}</span>
        )}
        {data.current.edited && <span className="px-1.5 py-0.5 rounded bg-sky-50 text-sky-800">사람이 고침</span>}
      </div>
      <p className="text-xs text-gray-500">
        <Link to={`/laws/${data.event.lawId}?change=${data.event.id}`} className="text-navy-700 hover:underline">
          {data.event.lawName} {data.event.label}
        </Link>
        {data.event.lawEffectiveDate && ` · 법령 시행일 ${data.event.lawEffectiveDate}`} · 기준일 {data.asOf} · 예정 사내 시행일{' '}
        {data.plannedEffectiveDate}
        {/* 승인 전에는 발행되지 않았다 — 확정 날짜는 승인 뒤 배너(T-111) */}
        {data.reviewState !== 'approved' && ' · 미발행'} ·{' '}
        {data.createdBy ? `만든 사람 ${data.createdByName ?? '알 수 없음'}` : '자동 생성'} ·{' '}
        {new Date(data.createdAt).toLocaleString('ko-KR')}
      </p>
      <EffectiveNotesLine info={data.event.effectiveNotes} />
      <AmendmentDocumentButton
        candidateIds={[data.id]}
        rejected={data.reviewState === 'rejected'}
        stale={data.reviewState !== 'approved' && data.reviewState !== 'rejected' && Boolean(data.staleReason)}
      />
    </div>
  );
}

function Alerts({ data }: { data: AmendmentDetail }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const regenerate = useMutation({
    mutationFn: () => amendmentsApi.regenerate(data.id),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['amendments'] });
      if (r.candidateId && !r.unchanged) {
        toast(r.created ? '지금 기준 본문으로 새 후보를 만들었습니다.' : '지금 기준 본문의 후보가 이미 있어 그것을 엽니다.', 'success');
        navigate(`/amendments/${r.candidateId}`);
      } else if (r.unchanged) {
        toast('기준 본문이 그대로라 새로 만들 후보가 없습니다.', 'info');
      } else {
        toast('지금 기준일에 시행 중인 본문이 없어 다시 만들 수 없습니다.', 'error');
      }
    },
    onError: (err: any) => toast(err?.response?.data?.message ?? '다시 만들지 못했습니다.', 'error'),
  });

  return (
    <>
      {data.decision?.state === 'approved' && data.reviewState === 'approved' && data.resultVersion && (
        <div className="rounded border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-900" data-testid="amendment-approved">
          승인됨 — <b>v{data.resultVersion.versionNum}</b> · <ResultDates data={data} /> · 승인{' '}
          {data.decision.by?.name ?? '알 수 없음'}
          {data.decision.reason && <span className="block text-xs mt-0.5 whitespace-pre-wrap">개정 사유: {data.decision.reason}</span>}
          <Link to={`/policies/${data.policy.id}#${formatArticleAnchor(data.article)}`} className="block text-xs mt-1 text-emerald-800 underline">
            규정에서 보기
          </Link>
        </div>
      )}
      {data.decision?.state === 'rejected' && data.reviewState === 'rejected' && (
        <div className="rounded border border-rose-300 bg-rose-50 px-3 py-2 text-sm text-rose-900" data-testid="amendment-rejected">
          반려됨 — 판 {data.decision.revision} · {data.decision.by?.name ?? '알 수 없음'} ·{' '}
          {new Date(data.decision.at).toLocaleString('ko-KR')}
          {data.decision.reason && <span className="block text-xs mt-0.5 whitespace-pre-wrap">반려 사유: {data.decision.reason}</span>}
          <span className="block text-xs mt-0.5">고치면 작성 상태로 돌아가 다시 검토를 요청할 수 있습니다. 시행 본문은 그대로입니다.</span>
        </div>
      )}
      <CorrectionNotice data={data} />
      {!data.isCurrentBase && data.reviewState !== 'approved' && (
        <div role="alert" className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 space-y-1.5">
          <p>
            {data.staleReason === 'variable_changed' ? (
              <>
                후보를 만든 뒤 예정 사내 시행일({data.plannedEffectiveDate})의 변수 값이 바뀌었습니다(값·유효기간·연결) — 그대로
                승인할 수 없습니다. 다시 만들어 검토하세요.
              </>
            ) : data.staleReason === 'repealed' ? (
              <>후보를 만든 뒤 이 조문이 폐지됐습니다 — 기준일에 시행 중인 본문이 없어 이 후보는 승인할 수 없습니다. 검토에서 반려로 닫으세요.</>
            ) : data.staleReason === 'history_changed' ? (
              <>
                후보를 만든 뒤 이 조문에 다른 발행·폐지·시행일 보정이 있었습니다 — 기준 본문(v{data.baseVersion.versionNum})은
                같아도 그대로 승인할 수 없습니다. 다시 만들어 검토하세요.
              </>
            ) : (
              <>
                후보를 만든 뒤 이 조문이 개정됐습니다
                {data.currentBase &&
                  ` — 지금 기준 본문은 v${data.currentBase.versionNum}${data.currentBase.effectiveDate ? `(시행 ${data.currentBase.effectiveDate})` : ''}입니다`}
                . 비교는 후보를 만들 때의 본문(v{data.baseVersion.versionNum}) 기준이라, 이대로 승인하면 그 사이 개정이
                빠질 수 있습니다.
              </>
            )}
          </p>
          {data.currentBase && (
            <details className="text-xs">
              <summary className="cursor-pointer text-amber-800">지금 기준 본문 보기</summary>
              <p className="mt-1 whitespace-pre-wrap text-gray-800">{data.currentBase.content}</p>
            </details>
          )}
          {/* 폐지된 조문은 다시 만들어도 기준 본문이 없다 */}
          {data.staleReason !== 'repealed' && (
            <button
              type="button"
              className="btn-secondary text-xs"
              disabled={regenerate.isPending}
              onClick={() => regenerate.mutate()}
            >
              {regenerate.isPending ? '만드는 중…' : '지금 기준 본문으로 다시 만들기'}
            </button>
          )}
        </div>
      )}
      {data.reviewRequest && (
        <div className="rounded border border-sky-200 bg-sky-50 px-3 py-2 text-sm text-sky-900">
          검토 요청됨 — 판 {data.reviewRequest.revision} ·{' '}
          {data.reviewRequest.requestedBy?.name ?? '알 수 없음'} ·{' '}
          {new Date(data.reviewRequest.requestedAt).toLocaleString('ko-KR')}
          {data.reviewRequest.reason && <span className="block text-xs mt-0.5">사유: {data.reviewRequest.reason}</span>}
        </div>
      )}
    </>
  );
}

/** 변수 값의 유효기간 표기 */
const periodText = (v: VariableEntry) => `${v.validFrom ?? '처음부터'} ~ ${v.validTo ? `${v.validTo} 전날` : '끝 없음'}`;

function ChangeRationale({ data, change }: { data: AmendmentDetail; change: CandidateChange }) {
  const apps = data.rationale.applications.filter((a) => change.rationaleRefs.includes(a.id));
  // 변수 근거는 법령 근거와 따로 보인다(T-109 ②, 특허 도 11)
  const vars = (data.rationale.variables ?? []).filter((v) => (change.variableRefs ?? []).includes(v.index));
  return (
    <div className="space-y-2 text-xs">
      <p className="text-gray-700">
        <span className="text-rose-800">{change.base.text ? `"${change.base.text}"` : '(없음)'}</span> →{' '}
        <span className="text-emerald-800">{change.candidate.text ? `"${change.candidate.text}"` : '(삭제)'}</span>
      </p>
      {vars.map((v) => (
        <div key={`v${v.index}`} className="rounded border border-violet-200 bg-violet-50/60 px-2 py-1.5 space-y-0.5" data-testid="variable-rationale">
          <p className="font-medium text-violet-900">
            변수 · {v.label} <span className="font-mono font-normal text-violet-700">{`{{${v.key}}}`}</span>
          </p>
          <p className="text-gray-700">
            "{v.base.text}" → "{v.value}" — 예정 사내 시행일 {data.plannedEffectiveDate}에 맞는 값
          </p>
          <p className="text-gray-600">값의 유효기간 {periodText(v)} · 범위: 이 회사</p>
        </div>
      ))}
      {apps.length === 0 && vars.length > 0 ? null : apps.length === 0 ? (
        <p className="rounded border border-amber-200 bg-amber-50 px-2 py-1.5 text-amber-900">
          근거 없음 —{' '}
          {data.current.edited
            ? '사람이 고친 부분입니다. 수정 사유는 아래 이력에 있습니다. 법령 근거로 보지 않으므로 검토해야 합니다.'
            : '규칙 기록과 연결되지 않은 변경입니다. 검토해야 합니다.'}
        </p>
      ) : (
        apps.map((a) => (
          <div key={a.id} className="rounded border border-gray-200 px-2 py-1.5 space-y-1">
            <p className="font-medium text-gray-800">
              {RULE_LABEL[a.ruleId] ?? a.ruleId}
              {apps.length > 1 && <span className="ml-1 text-gray-500 font-normal">(근거 {apps.indexOf(a) + 1}/{apps.length})</span>}
            </p>
            {a.lawChangeIndexes.map((i) => {
              const lc = data.rationale.lawChanges[i];
              return lc ? (
                <p key={i} className="text-gray-600">
                  법령 변경: {lc.before ? `"${lc.before}"` : '(추가)'} → {lc.after ? `"${lc.after}"` : '(삭제)'}
                </p>
              ) : null;
            })}
            <LinkSnapshot data={data} />
          </div>
        ))
      )}
    </div>
  );
}

function RationaleOverview({ data }: { data: AmendmentDetail }) {
  const { lawChanges, applications, unmapped } = data.rationale;
  const variables = data.rationale.variables ?? [];
  const appliedBy = (i: number) => applications.find((a) => a.lawChangeIndexes.includes(i));
  return (
    <div className="space-y-2 text-xs">
      <p className="text-gray-500">바뀐 곳을 누르면 그 부분의 근거만 봅니다. 법령 변경별 반영 결과:</p>
      <ul className="space-y-1">
        {lawChanges.map((lc) => {
          const by = appliedBy(lc.index);
          const miss = unmapped.find((u) => u.lawChangeIndex === lc.index);
          return (
            <li key={lc.index} className="rounded border border-gray-200 px-2 py-1">
              {lc.before ? `"${lc.before}"` : '(추가)'} → {lc.after ? `"${lc.after}"` : '(삭제)'}{' '}
              {by ? (
                <span className="text-emerald-800">— 반영함({RULE_LABEL[by.ruleId] ?? by.ruleId})</span>
              ) : miss ? (
                <span className="text-amber-800">— 반영 못 함: {miss.detail ?? UNMAPPED_REASON_LABEL[miss.reason] ?? miss.reason}</span>
              ) : null}
            </li>
          );
        })}
      </ul>
      {variables.length > 0 && (
        <>
          <p className="text-gray-500">변수 값(예정 사내 시행일 {data.plannedEffectiveDate} 기준):</p>
          <ul className="space-y-1" data-testid="variable-overview">
            {variables.map((v) => (
              <li key={v.index} className="rounded border border-violet-200 px-2 py-1">
                {v.label} "{v.base.text}"{' '}
                {v.status === 'applied' ? (
                  <span className="text-emerald-800">→ "{v.value}" 넣음</span>
                ) : v.status === 'unchanged' ? (
                  <span className="text-gray-600">— 이미 그 날 값</span>
                ) : (
                  <span className="text-amber-800">— {VARIABLE_HOLD_LABEL[v.reason ?? ''] ?? v.reason}</span>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
      <LinkSnapshot data={data} />
    </div>
  );
}

/** 후보를 만들 때의 연결 정보(스냅샷) — 연결이 그 뒤 바뀌거나 지워져도 그때의 근거가 남는다 */
function LinkSnapshot({ data }: { data: AmendmentDetail }) {
  const link = data.rationale.link;
  const path = data.rationale.path;
  if (!link) return null;
  return (
    <div className="text-gray-600 space-y-0.5">
      <p>
        연결: {RELATION_TYPE_LABEL[link.relationType as keyof typeof RELATION_TYPE_LABEL] ?? link.relationType}
        {link.confirmState === 'confirmed' ? ' · 확정' : ` · ${link.confirmState}`}
        {link.scope && ` · 적용 범위 "${link.scope}"`}
      </p>
      {link.evidenceText && <p>근거 문구: "{link.evidenceText}"</p>}
      {link.evidenceText && (
        <EvidenceSource source={link.evidenceVersion} target={{ versionNum: data.baseVersion.versionNum, hasEvidence: link.evidenceInBase }} against="base" />
      )}
      {path && <p className="text-gray-500">{path.filter((p) => p.type !== 'lawLink').map((p) => p.label).join(' → ')}</p>}
    </div>
  );
}

function LawChangeCard({ data }: { data: AmendmentDetail }) {
  return (
    <section className="card p-3 space-y-1.5">
      <h2 className="text-sm font-semibold text-gray-800">
        법령 변경 <span className="font-normal text-gray-500">{data.event.lawName} {data.event.label}</span>
      </h2>
      <div className="grid gap-2 sm:grid-cols-2 text-xs">
        <div>
          <div className="text-[11px] text-gray-500 mb-0.5">변경 전</div>
          <p className="whitespace-pre-wrap rounded border border-gray-200 bg-gray-50 px-2 py-1.5 text-gray-700">
            {data.event.beforeContent ?? '(없음 — 신설 조문)'}
          </p>
        </div>
        <div>
          <div className="text-[11px] text-gray-500 mb-0.5">변경 후</div>
          <p className="whitespace-pre-wrap rounded border border-navy-100 bg-navy-50/50 px-2 py-1.5 text-gray-800">
            {data.event.afterContent ?? '(없음 — 조문 삭제)'}
          </p>
        </div>
      </div>
    </section>
  );
}

/**
 * 승인·반려 (관리자, T-108). 검토를 요청한 판에 대해서만 — 화면이 본 판·잠금 버전을 함께 보낸다.
 * 사내 시행일은 기본값 없이 직접 고른다(법령 시행일은 참고로만 보인다).
 */
function DecisionPanel({ data }: { data: AmendmentDetail }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const today = serviceToday();
  const [effectiveDate, setEffectiveDate] = useState('');
  const [changeNote, setChangeNote] = useState('');
  const [earlyReason, setEarlyReason] = useState('');
  const [rejectReason, setRejectReason] = useState('');
  const [block, setBlock] = useState<{ reason: ApproveBlock; message: string } | null>(null);
  const lawDate = data.event.lawEffectiveDate;
  const early = !!(lawDate && effectiveDate && effectiveDate < lawDate);
  const lock = { expectedRevision: data.revision, expectedLockVersion: data.lockVersion };
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['amendment', data.id] });
    qc.invalidateQueries({ queryKey: ['amendments'] });
  };

  const approve = useMutation({
    mutationFn: () =>
      amendmentsApi.approve(data.id, {
        effectiveDate,
        changeNote,
        earlyReason: early ? earlyReason : undefined,
        ...lock,
      }),
    onSuccess: (r) => {
      setBlock(null);
      refresh();
      toast(r.alreadyApproved ? '이미 승인된 후보입니다.' : `승인했습니다 — v${r.resultVersion?.versionNum} 발행`, 'success');
    },
    onError: (err: any) => {
      const body = err?.response?.data;
      if (err?.response?.status === 409 && body?.reason) {
        setBlock({ reason: body.reason, message: body.message });
      } else {
        if (err?.response?.status === 409) refresh();
        toast(body?.message ?? '승인하지 못했습니다.', 'error');
      }
    },
  });
  const reject = useMutation({
    mutationFn: () => amendmentsApi.reject(data.id, { reason: rejectReason, ...lock }),
    onSuccess: () => {
      refresh();
      toast('반려했습니다. 시행 본문은 그대로입니다.', 'success');
    },
    onError: (err: any) => {
      if (err?.response?.status === 409) refresh();
      toast(err?.response?.data?.message ?? '반려하지 못했습니다.', 'error');
    },
  });
  const regenerate = useMutation({
    mutationFn: () => amendmentsApi.regenerate(data.id, effectiveDate),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['amendments'] });
      if (r.candidateId && !r.unchanged) {
        toast(r.created ? `${effectiveDate} 기준으로 새 후보를 만들었습니다.` : '그 기준의 후보가 이미 있어 그것을 엽니다.', 'success');
        navigate(`/amendments/${r.candidateId}`);
      } else {
        toast('새로 만들 후보가 없습니다.', 'info');
      }
    },
    onError: (err: any) => toast(err?.response?.data?.message ?? '다시 만들지 못했습니다.', 'error'),
  });

  const canApprove = !!effectiveDate && effectiveDate >= today && !!changeNote.trim() && (!early || !!earlyReason.trim());
  const future = effectiveDate > today;
  return (
    <section className="card p-3 space-y-3" aria-labelledby="decision-title">
      <h2 id="decision-title" className="text-sm font-semibold text-gray-800">
        승인 · 반려 <span className="font-normal text-gray-500">(판 {data.revision})</span>
      </h2>
      <div className="grid gap-2 sm:grid-cols-2">
        <div>
          <label htmlFor="approve-effective" className="block text-xs text-gray-600 mb-1">
            사내 규정 시행일 <span className="text-red-600">*</span>
          </label>
          <input
            id="approve-effective"
            type="date"
            className="input"
            min={today}
            value={effectiveDate}
            onChange={(e) => {
              setEffectiveDate(e.target.value);
              setBlock(null);
            }}
          />
          <p className="text-[11px] text-gray-500 mt-1">
            {lawDate ? `참고: 법령 시행일 ${lawDate}. ` : ''}오늘이나 그 뒤 — 소급 개정은 하지 않습니다.
            {(data.rationale.variables ?? []).length > 0 &&
              ` 이 후보의 변수 값은 예정 사내 시행일 ${data.plannedEffectiveDate} 기준입니다 — 다른 날로 승인하면 그 날 값과 다를 때 다시 만들어야 합니다.`}
          </p>
        </div>
        <div>
          <label htmlFor="approve-note" className="block text-xs text-gray-600 mb-1">
            개정 사유 <span className="text-red-600">*</span>
          </label>
          <input
            id="approve-note"
            className="input"
            maxLength={500}
            value={changeNote}
            onChange={(e) => setChangeNote(e.target.value)}
          />
          <button
            type="button"
            className="text-[11px] text-navy-700 hover:underline mt-1"
            onClick={() => setChangeNote(`${data.event.lawName} ${data.event.label} 개정 반영`)}
          >
            사유 초안 넣기
          </button>
        </div>
      </div>
      {early && (
        <div>
          <label htmlFor="approve-early" className="block text-xs text-amber-800 mb-1">
            법령 시행일({lawDate})보다 이르게 시행하는 이유 <span className="text-red-600">*</span>
          </label>
          <input id="approve-early" className="input" maxLength={500} value={earlyReason} onChange={(e) => setEarlyReason(e.target.value)} />
        </div>
      )}
      {effectiveDate && effectiveDate >= today && (
        <p className="text-xs text-gray-600">
          승인하면 이 조문의 새 버전이 발행되고 <b>{effectiveDate}</b>부터 시행됩니다
          {future ? ' — 그날 전까지 시점 조회는 지금 본문을 보여 줍니다' : ''}.
        </p>
      )}
      {block && (
        <div role="alert" className="rounded border border-red-200 bg-red-50 px-2.5 py-2 text-xs text-red-800 space-y-1.5">
          <p className="font-medium">{block.message}</p>
          {block.reason === 'undated_history' ? (
            <Link to={`/policies/${data.policy.id}`} className="underline">
              규정 화면에서 시행일 보정하기
            </Link>
          ) : block.reason === 'issued_source' ? (
            <IssuedSourceLink data={data} />
          ) : block.reason !== 'later_version' && block.reason !== 'repealed' ? (
            <button type="button" className="btn-secondary text-xs" disabled={regenerate.isPending} onClick={() => regenerate.mutate()}>
              {regenerate.isPending ? '만드는 중…' : `${effectiveDate} 기준으로 다시 만들기`}
            </button>
          ) : null}
        </div>
      )}
      <button type="button" className="btn-primary text-xs" disabled={!canApprove || approve.isPending} onClick={() => approve.mutate()}>
        {approve.isPending ? '승인 중…' : '승인 — 후속 버전 발행'}
      </button>

      <div className="border-t border-gray-100 pt-3 space-y-2">
        <label htmlFor="reject-reason" className="block text-xs text-gray-600">
          반려 사유 <span className="text-red-600">*</span>
        </label>
        <textarea
          id="reject-reason"
          className="input min-h-[3.5rem]"
          maxLength={1000}
          placeholder="예: 우리 규정은 이미 법보다 긴 휴가를 주므로 개정이 필요 없다"
          value={rejectReason}
          onChange={(e) => setRejectReason(e.target.value)}
        />
        <button type="button" className="btn-secondary text-xs" disabled={!rejectReason.trim() || reject.isPending} onClick={() => reject.mutate()}>
          {reject.isPending ? '반려 중…' : '반려 — 발행하지 않음'}
        </button>
      </div>
    </section>
  );
}

function Actions({ data }: { data: AmendmentDetail }) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [content, setContent] = useState(data.candidateContent);
  const [note, setNote] = useState('');
  const [conflict, setConflict] = useState(false);
  const [reason, setReason] = useState('');

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['amendment', data.id] });
    qc.invalidateQueries({ queryKey: ['amendments'] });
  };
  const onLockError = (err: any, fallback: string) => {
    if (err?.response?.data?.reason === 'issued_source') {
      // 잠금 충돌이 아니다 — 이 후보로 발행한 버전이 생겨 다시 열 수 없다(T-178). 서버 문구를 그대로 보이고 화면을 새로 받는다
      refresh();
      toast(err.response.data.message ?? fallback, 'error');
    } else if (err?.response?.status === 409) {
      setConflict(true);
      refresh();
      toast('그 사이 다른 사람이 이 후보를 바꿨습니다. 최신 내용을 불러왔습니다.', 'error');
    } else {
      toast(err?.response?.data?.message ?? fallback, 'error');
    }
  };

  const save = useMutation({
    mutationFn: () =>
      amendmentsApi.edit(data.id, {
        candidateContent: content,
        note,
        expectedRevision: data.revision,
        expectedLockVersion: data.lockVersion,
      }),
    onSuccess: () => {
      setEditing(false);
      setNote('');
      setConflict(false);
      refresh();
      toast('새 판으로 저장했습니다.', 'success');
    },
    onError: (err) => onLockError(err, '저장하지 못했습니다.'),
  });
  const request = useMutation({
    mutationFn: () =>
      amendmentsApi.requestReview(data.id, {
        reason: reason.trim() || undefined,
        expectedRevision: data.revision,
        expectedLockVersion: data.lockVersion,
      }),
    onSuccess: () => {
      setReason('');
      refresh();
      toast('검토를 요청했습니다.', 'success');
    },
    onError: (err) => onLockError(err, '검토를 요청하지 못했습니다.'),
  });

  const needReason = !data.current.hasChanges;
  return (
    <section className="card p-3 space-y-3">
      <h2 className="text-sm font-semibold text-gray-800">손질 · 검토 요청</h2>
      {editing ? (
        <div className="space-y-2">
          {data.reviewState === 'review' && (
            <p className="text-xs text-amber-800">
              검토 중인 후보를 고치면 작성 상태로 돌아가고, 고친 판으로 검토를 다시 요청해야 합니다.
            </p>
          )}
          {data.reviewState === 'rejected' && (
            <p className="text-xs text-amber-800">
              반려된 후보를 고치면 작성 상태로 돌아갑니다. 반려 사유와 고치기 전 내용은 이력에 남습니다.
            </p>
          )}
          {conflict && (
            <p role="alert" className="text-xs text-red-800 bg-red-50 border border-red-200 rounded px-2 py-1.5">
              그 사이 다른 사람이 이 후보를 바꿨습니다. 위 화면은 최신 판으로 바뀌었고, 고친 내용은 아래에 그대로 있습니다 —
              최신 판과 비교한 뒤 다시 저장하세요.
            </p>
          )}
          <label htmlFor="cand-edit" className="block text-xs text-gray-600">
            후보 본문
          </label>
          <textarea
            id="cand-edit"
            className="input min-h-[8rem] font-[inherit]"
            value={content}
            onChange={(e) => setContent(e.target.value)}
          />
          <label htmlFor="cand-note" className="block text-xs text-gray-600">
            수정 사유 <span className="text-red-600">*</span>
          </label>
          <input
            id="cand-note"
            className="input"
            value={note}
            maxLength={500}
            placeholder="예: 법 문구를 우리 규정 문체에 맞게 다듬음"
            onChange={(e) => setNote(e.target.value)}
          />
          <div className="flex gap-2">
            <button
              type="button"
              className="btn-primary text-xs"
              disabled={!note.trim() || content === data.candidateContent || save.isPending}
              onClick={() => save.mutate()}
            >
              {save.isPending ? '저장 중…' : '새 판으로 저장'}
            </button>
            <button
              type="button"
              className="btn-secondary text-xs"
              onClick={() => {
                setEditing(false);
                setContent(data.candidateContent);
                setConflict(false);
              }}
            >
              취소
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          className="btn-secondary text-xs"
          onClick={() => {
            setContent(data.candidateContent);
            setEditing(true);
          }}
        >
          후보 손질
        </button>
      )}

      {data.reviewState === 'draft' && !editing && (
        <div className="space-y-2 border-t border-gray-100 pt-3">
          {!data.isCurrentBase && (
            <p className="text-xs text-amber-800">기준 본문이 바뀐 후보입니다 — 요청은 할 수 있지만 검토자가 그 사이 개정을 확인해야 합니다.</p>
          )}
          <label htmlFor="review-reason" className="block text-xs text-gray-600">
            {needReason ? (
              <>
                개정이 필요 없다고 보는 이유 <span className="text-red-600">*</span>
              </>
            ) : (
              '검토 요청 메모 (선택)'
            )}
          </label>
          <input
            id="review-reason"
            className="input"
            value={reason}
            maxLength={500}
            placeholder={needReason ? '예: 우리 규정은 이미 법보다 긴 휴가를 준다' : ''}
            onChange={(e) => setReason(e.target.value)}
          />
          <button
            type="button"
            className="btn-primary text-xs"
            disabled={(needReason && !reason.trim()) || request.isPending}
            onClick={() => request.mutate()}
          >
            {request.isPending ? '요청 중…' : `판 ${data.revision}로 검토 요청`}
          </button>
        </div>
      )}
    </section>
  );
}

const STATE_CHANGE_LABEL = (from: string, to: string) =>
  to === 'review'
    ? '검토 요청'
    : to === 'approved'
      ? '승인 — 후속 버전 발행'
      : to === 'rejected'
        ? '반려'
        : from === 'review' && to === 'draft'
          ? '검토 요청 취소(본문 손질)'
          : from === 'rejected' && to === 'draft'
            ? '반려 뒤 손질 — 작성으로'
            : `${REVIEW_STATE_LABEL[from as 'draft']} → ${REVIEW_STATE_LABEL[to as 'draft']}`;

function HistoryCard({ history }: { history: AmendmentHistory }) {
  type Item = { at: string; key: string; node: React.ReactNode };
  const items: Item[] = [
    ...history.revisions.map((r) => ({
      at: r.createdAt,
      key: `r${r.revision}`,
      node: (
        <div>
          <p className="text-gray-800">
            <b>판 {r.revision}</b> ·{' '}
            {r.revision === 1 ? '생성' : `${r.editedBy?.name ?? '알 수 없음'} 손질`} ·{' '}
            {new Date(r.createdAt).toLocaleString('ko-KR')}
          </p>
          {r.note && <p className="text-gray-600">사유: {r.note}</p>}
          {r.fromPrevious && (
            <details className="mt-0.5">
              <summary className="cursor-pointer text-navy-700">직전 판 대비</summary>
              <p className="mt-1 whitespace-pre-wrap text-gray-800 leading-relaxed">
                {r.fromPrevious.map((p, i) =>
                  p.op === 'delete' ? (
                    <del key={i} className="bg-rose-100 text-rose-900 line-through decoration-rose-400">{p.text}</del>
                  ) : p.op === 'insert' ? (
                    <ins key={i} className="bg-emerald-100 text-emerald-900 underline decoration-emerald-600">{p.text}</ins>
                  ) : (
                    <span key={i}>{p.text}</span>
                  ),
                )}
              </p>
            </details>
          )}
        </div>
      ),
    })),
    ...history.stateChanges.map((c) => ({
      at: c.createdAt,
      key: c.id,
      node: (
        <div>
          <p className="text-gray-800">
            <b>{c.kind === 'correction' ? <CorrectionHistoryLabel fromState={c.fromState} toState={c.toState} /> : STATE_CHANGE_LABEL(c.fromState, c.toState)}</b> · 판 {c.revision} · {c.actor?.name ?? '알 수 없음'} ·{' '}
            {new Date(c.createdAt).toLocaleString('ko-KR')}
          </p>
          {c.reason && <p className="text-gray-600">사유: {c.reason}</p>}
        </div>
      ),
    })),
  ].sort((a, b) => a.at.localeCompare(b.at));

  return (
    <section className="card p-3 space-y-1.5">
      <h2 className="text-sm font-semibold text-gray-800">이력</h2>
      <ol className="text-xs space-y-1.5" data-testid="amendment-history">
        {items.map((it) => (
          <li key={it.key} className="border-l-2 border-gray-200 pl-2">
            {it.node}
          </li>
        ))}
      </ol>
    </section>
  );
}

/**
 * 승인 결과의 날짜 3종(T-111, 특허 청구항 7) — 발행한 버전의 확정 값. 사내 규정 시행일 · 발행일시 · 법령 시행일 순서로,
 * 버전 카드와 같은 표기다. 발행일시가 곧 승인 시각이다(같은 트랜잭션).
 */
function ResultDates({ data }: { data: AmendmentDetail }) {
  const v = data.resultVersion!;
  const d = versionDates({
    // 승인으로 낸 버전 — 뒤에 다른 개정에 밀려 내려갔어도 "시행 예정"은 시행일로만 가린다
    status: 'published',
    effectiveDate: v.effectiveDate,
    publishedAt: v.publishedAt,
    lawChange: {
      eventId: data.event.id,
      lawId: data.event.lawId,
      lawName: data.event.lawName,
      label: data.event.label,
      lawEffectiveDate: data.event.lawEffectiveDate,
    },
  })!;
  return (
    <span data-testid="amendment-result-dates">
      사내 시행일 {d.effective ?? '기록 없음'}
      {d.upcoming && ' (시행 예정)'} · 발행 {d.published ?? '기록 없음'} · 법령 시행일 {d.law!.date ?? '기록 없음'}
      {d.law!.early && (
        <span className="ml-1 px-1.5 py-0.5 rounded bg-amber-100 text-amber-900 text-xs" data-testid="amendment-result-early">
          법령보다 조기 시행
        </span>
      )}
    </span>
  );
}
