/**
 * 재파싱 검토 (T-110, 특허 청구항 2·도 6) — 다시 가져온 원문을 기존 규정의 조문과 맞춘 결과.
 *
 * 계층 정보(장·절·조·항·목 번호)와 내용 지문(정규화한 본문) 두 축으로 맞춘다. 같은 조문이면 기존 조문 식별자를 그대로
 * 써서 법령 연결과 버전 이력이 이어진다. 근거가 충분한 옮김과 후보가 없는 새 조문은 결정을 미리 골라 두고, 같은 자리의
 * 본문 변경·후보가 여럿인 조문은 사람이 정한다. 원문에 없는 조문은 지우지 않고 삭제 여부를 확인할 대상으로 남긴다.
 * 비교만으로는 규정 본문이 바뀌지 않는다.
 */
import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { clsx } from 'clsx';
import { AlertTriangle, ArrowRight, ChevronDown, ChevronRight, RefreshCw } from 'lucide-react';
import {
  outcomeLabel,
  reparseApi,
  REPARSE_STATUS_LABEL,
  REPARSE_DECISION_LABEL,
  REPARSE_DECISIONS,
  REPARSE_KIND_LABEL,
  REPARSE_REASON_LABEL,
  type ReparseDecision,
  type ReparseDecisionInput,
  type ReparseItem,
  type ReparseKind,
  type ReparseReview,
} from '../api/reparse';
import { PageHeader } from '../components/ui/PageHeader';
import { LoadingBlock } from '../components/ui/LoadingBlock';
import { toast } from '../stores/toastStore';
import { useAuthStore } from '../stores/authStore';
import { apiErrorMessage } from '../lib/apiError';
import { serviceToday } from '../lib/serviceDate';

const KIND_STYLE: Record<ReparseKind, string> = {
  same: 'bg-gray-50 text-gray-600 border-gray-200',
  moved: 'bg-sky-50 text-sky-800 border-sky-200',
  changed: 'bg-amber-50 text-amber-800 border-amber-200',
  ambiguous: 'bg-violet-50 text-violet-800 border-violet-200',
  new: 'bg-emerald-50 text-emerald-800 border-emerald-200',
  missing: 'bg-rose-50 text-rose-800 border-rose-200',
};

const CHAPTER_CHANGE: Record<string, string> = {
  renumbered: '번호 바뀜',
  renamed: '제목 바뀜',
  renumbered_renamed: '번호·제목 바뀜',
  new: '새 장',
  missing: '원문에 없는 장',
};

const chapterName = (c: { number: number; title: string; hidden: boolean } | null | undefined) =>
  !c ? '—' : c.hidden ? '장 없음' : `제${c.number}장 ${c.title}`;

/** 항목을 화면 묶음으로 — 확인할 것이 먼저 */
function groupOf(item: ReparseItem): 'check' | 'moved' | 'new' | 'missing' | 'same' {
  if (item.kind === 'changed' || item.kind === 'ambiguous' || (item.kind === 'moved' && !item.recommended)) return 'check';
  if (item.kind === 'moved') return 'moved';
  if (item.kind === 'new') return 'new';
  if (item.kind === 'missing') return 'missing';
  return 'same';
}

const GROUPS: { key: ReturnType<typeof groupOf>; title: string; hint: string }[] = [
  {
    key: 'check',
    title: '확인할 것',
    hint: '같은 자리의 본문이 바뀌었거나, 띄어쓰기만 같거나, 같은 본문의 후보가 여럿인 조문입니다. 하나씩 정하세요.',
  },
  { key: 'moved', title: '옮김', hint: '본문이 같고 근거(상위 조·하위 항·앞뒤 조)가 있어 기존 조문을 그대로 이어 씁니다.' },
  { key: 'new', title: '새 조문 후보', hint: '기존 조문과 대응하지 않습니다. 원문에 없는 기존 조문을 고쳐 옮긴 것이면 그 조문에 이으세요.' },
  { key: 'missing', title: '원문에 없음 — 삭제 여부 확인', hint: '다시 가져온 원문에 없는 기존 조문입니다. 지우지 않고 버전 이력을 남깁니다.' },
  { key: 'same', title: '그대로', hint: '번호와 본문이 같습니다(띄어쓰기만 다른 것 포함).' },
];

export default function ReparseReviewPage() {
  const { id: policyId, reviewId } = useParams<{ id: string; reviewId: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const role = useAuthStore((s) => s.user?.role);
  const [openSame, setOpenSame] = useState(false);

  const { data: review, isLoading, error } = useQuery<ReparseReview>({
    queryKey: ['reparse-review', reviewId],
    queryFn: () => reparseApi.get(reviewId!),
    enabled: !!reviewId,
  });

  const decide = useMutation({
    mutationFn: (items: ReparseDecisionInput[]) => reparseApi.decide(reviewId!, items),
    onSuccess: (next) => qc.setQueryData(['reparse-review', reviewId], next),
    onError: (err) => toast(apiErrorMessage(err, '결정을 저장하지 못했습니다.'), 'error'),
  });

  const recompare = useMutation({
    mutationFn: () => reparseApi.compare(review!.sessionId!, review!.policyId),
    onSuccess: (next) => {
      qc.setQueryData(['reparse-review', next.id], next);
      toast('다시 비교했습니다. 정해 둔 결정은 같은 항목이면 옮겨 왔습니다.', 'success');
      navigate(`/policies/${next.policyId}/reparse/${next.id}`);
    },
    onError: (err) => toast(apiErrorMessage(err, '다시 비교하지 못했습니다.'), 'error'),
  });

  // 반영·묶음 검토 요청·승인·반려(T-110 ②) — 응답이 곧 새 검토 상태다
  const step = useMutation({
    mutationFn: (run: () => Promise<ReparseReview>) => run(),
    onSuccess: (next) => {
      qc.setQueryData(['reparse-review', reviewId], next);
      qc.invalidateQueries({ queryKey: ['reparse-reviews', policyId] });
      qc.invalidateQueries({ queryKey: ['policy', policyId] });
    },
    onError: (err) => toast(apiErrorMessage(err, '처리하지 못했습니다.'), 'error'),
  });

  const grouped = useMemo(() => {
    const out: Record<string, ReparseItem[]> = { check: [], moved: [], new: [], missing: [], same: [] };
    for (const item of review?.items ?? []) out[groupOf(item)].push(item);
    return out;
  }, [review?.items]);

  /** 원문에 없는 조문 중 아직 다른 항목이 고르거나 잇지 않은 것 — 새 조문 후보를 이을 대상 */
  const missingById = useMemo(() => new Map((review?.items ?? []).filter((i) => i.kind === 'missing').map((i) => [i.articleId!, i])), [review?.items]);
  const claimedBy = useMemo(() => {
    const m = new Map<string, ReparseItem>();
    for (const i of review?.items ?? []) {
      if ((i.decision === 'pick' || i.decision === 'link') && i.targetArticleId) m.set(i.targetArticleId, i);
    }
    return m;
  }, [review?.items]);

  if (isLoading) return <LoadingBlock label="비교 결과를 불러오는 중…" />;
  if (error || !review) {
    return (
      <div className="page-shell">
        <p className="text-sm text-red-700">{apiErrorMessage(error, '재파싱 검토를 찾을 수 없습니다.')}</p>
      </div>
    );
  }

  const open = review.status === 'open';
  const counts = review.summary.counts;
  const changedUndecided = grouped.check.filter((i) => i.kind === 'changed' && !i.decision);
  const chapterChanges = review.summary.chapters.filter((c) => c.change !== 'same');
  const deletionUndecided = grouped.missing.filter((i) => !i.decision && !claimedBy.has(i.articleId!)).length;

  return (
    <div className="page-shell space-y-4">
      <PageHeader
        title="재파싱 검토"
        description={`${review.policy.title} · 원문 ${review.sourceName} · ${new Date(review.createdAt).toLocaleString('ko-KR')} 비교`}
        actions={
          <div className="flex flex-wrap gap-2">
            {open && review.sessionId && (
              <button type="button" className="btn-secondary text-sm" disabled={recompare.isPending} onClick={() => recompare.mutate()}>
                <RefreshCw size={14} /> {recompare.isPending ? '비교 중…' : '다시 비교'}
              </button>
            )}
            <Link to={`/policies/${policyId}`} className="btn-secondary text-sm">
              규정으로
            </Link>
          </div>
        }
      />

      {review.status === 'superseded' && (
        <p className="text-sm bg-gray-50 border border-gray-200 rounded px-3 py-2 text-gray-700" role="status">
          같은 원문을 다시 비교해 지나간 검토입니다 — 결정은 최근 검토에서 합니다.
        </p>
      )}
      {(review.status === 'applied' || review.status === 'submitted') && review.stale && (
        <div className="flex flex-wrap items-center gap-2 text-sm bg-amber-50 border border-amber-200 rounded px-3 py-2 text-amber-900" role="alert">
          <AlertTriangle size={15} className="shrink-0" />
          <span className="flex-1 min-w-[12rem]">
            {review.status === 'applied' ? '반영한 뒤' : '검토 요청한 뒤'} 이 규정이 바뀌었습니다(다른 초안·개정·순서 변경 등) — 이 묶음은 더 진행할 수 없습니다.
            관리자가 묶음을 반려하면 같은 원문으로 다시 비교할 수 있습니다.
          </span>
        </div>
      )}
      {open && (review.stale || review.sourceChanged) && (
        <div className="flex flex-wrap items-center gap-2 text-sm bg-amber-50 border border-amber-200 rounded px-3 py-2 text-amber-900" role="alert">
          <AlertTriangle size={15} className="shrink-0" />
          <span className="flex-1 min-w-[12rem]">
            {review.stale
              ? '비교한 뒤 이 규정이 바뀌었습니다(개정·초안·순서 변경 등). 다시 비교해야 반영할 수 있습니다.'
              : '비교한 뒤 원문 미리보기를 고쳤습니다. 다시 비교해야 반영할 수 있습니다.'}
          </span>
          {review.sessionId && (
            <button type="button" className="btn-secondary text-xs py-1" disabled={recompare.isPending} onClick={() => recompare.mutate()}>
              다시 비교
            </button>
          )}
        </div>
      )}

      <section className="bg-white border border-gray-300 shadow-sm p-4 space-y-2" aria-label="비교 요약">
        <div className="flex flex-wrap gap-1.5">
          {(Object.keys(REPARSE_KIND_LABEL) as ReparseKind[]).map((k) => (
            <span key={k} className={clsx('text-xs px-2 py-0.5 rounded border tabular-nums', KIND_STYLE[k])} data-testid={`reparse-count-${k}`}>
              {REPARSE_KIND_LABEL[k]} {counts[k] ?? 0}
            </span>
          ))}
        </div>
        <p className="text-xs text-gray-600 leading-relaxed">
          결정 남음 <b className="tabular-nums">{review.undecided}</b>건 · 삭제 여부 미결 <b className="tabular-nums">{deletionUndecided}</b>건
          {review.summary.pendingConflicts > 0 && <> · 초안·검토 중 버전이 있는 조문 {review.summary.pendingConflicts}건</>}
          {review.summary.appendixCount > 0 && <> · 부칙·별표 {review.summary.appendixCount}건은 이번 비교에서 뺐습니다</>}
        </p>
        <p className="text-[11px] text-gray-500">
          번호(장·절·조·항·목)와 본문 지문 두 가지로 맞춥니다. 같은 조문이면 기존 조문을 그대로 이어 써서 법령 연결과 버전 이력이 남습니다.
          결정은 바로 저장되고, 비교만으로는 규정 본문이 바뀌지 않습니다. 판정 규칙 {review.algorithm} · 정규화 {review.normalizer}
        </p>
      </section>

      <BundlePanel review={review} isAdmin={role === 'admin'} canEdit={role === 'admin' || role === 'editor'} busy={step.isPending} run={(fn) => step.mutate(fn)} onRecompare={() => recompare.mutate()} />

      {chapterChanges.length > 0 && (
        <section className="bg-white border border-gray-300 shadow-sm p-4 space-y-1.5" aria-label="장 변경">
          <h2 className="text-sm font-semibold text-gray-900">장 단위 변경</h2>
          <ul className="space-y-1 text-xs text-gray-700">
            {chapterChanges.map((c, i) => (
              <li key={i} className="flex flex-wrap items-center gap-1.5">
                <span className="px-1.5 py-0.5 rounded border border-gray-200 bg-gray-50 text-[11px]">{CHAPTER_CHANGE[c.change]}</span>
                {c.stored && c.parsed ? (
                  <>
                    {chapterName(c.stored)} <ArrowRight size={12} className="text-gray-400" /> {chapterName(c.parsed)}
                  </>
                ) : (
                  chapterName(c.parsed ?? c.stored)
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {GROUPS.map((g) => {
        const items = grouped[g.key];
        if (!items.length) return null;
        const collapsed = g.key === 'same' && !openSame;
        return (
          <section key={g.key} className="bg-white border border-gray-300 shadow-sm" aria-label={g.title} data-testid={`reparse-group-${g.key}`}>
            <header className="px-4 py-2 border-b border-gray-200 bg-gray-50 flex flex-wrap items-center gap-2">
              {g.key === 'same' ? (
                <button type="button" className="inline-flex items-center gap-1 text-sm font-semibold text-gray-900" onClick={() => setOpenSame((v) => !v)} aria-expanded={openSame}>
                  {openSame ? <ChevronDown size={14} /> : <ChevronRight size={14} />} {g.title} {items.length}
                </button>
              ) : (
                <h2 className="text-sm font-semibold text-gray-900">
                  {g.title} <span className="tabular-nums text-gray-500 font-normal">{items.length}</span>
                </h2>
              )}
              {g.key === 'check' && open && changedUndecided.length > 1 && (
                <button
                  type="button"
                  className="ml-auto btn-secondary text-xs py-1"
                  disabled={decide.isPending}
                  onClick={() => decide.mutate(changedUndecided.map((i) => ({ id: i.id, decision: 'amend' })))}
                >
                  본문 바뀐 {changedUndecided.length}건 모두 개정으로
                </button>
              )}
              <p className="basis-full text-[11px] text-gray-500">{g.hint}</p>
            </header>
            {!collapsed && (
              <ul className="divide-y divide-gray-100">
                {items.map((item) => (
                  <ItemRow
                    key={item.id}
                    item={item}
                    open={open}
                    isAdmin={role === 'admin'}
                    busy={decide.isPending}
                    missingById={missingById}
                    claimedBy={claimedBy}
                    onDecide={(decision, targetArticleId) => decide.mutate([{ id: item.id, decision, targetArticleId: targetArticleId ?? null }])}
                    canResolve={(review.status === 'approved' || review.status === 'rejected') && (role === 'admin' || role === 'editor')}
                    onResolve={(decision) => step.mutate(() => reparseApi.resolve(review.id, item.id, decision))}
                  />
                ))}
              </ul>
            )}
          </section>
        );
      })}
    </div>
  );
}

function Diff({ item }: { item: ReparseItem }) {
  if (!item.diff) return null;
  return (
    <p className="text-[12px] leading-relaxed text-gray-800 whitespace-pre-wrap break-words" data-testid="reparse-diff">
      {item.diff.map((part, i) => (
        <span
          key={i}
          className={clsx(
            part.removed && 'bg-rose-100 text-rose-900 line-through decoration-rose-400',
            part.added && 'bg-emerald-100 text-emerald-900 font-medium',
          )}
        >
          {part.value}
        </span>
      ))}
    </p>
  );
}

function Body({ text }: { text: string }) {
  return text ? (
    <p className="text-[12px] leading-relaxed text-gray-700 whitespace-pre-wrap break-words line-clamp-4">{text}</p>
  ) : (
    <p className="text-[11px] text-gray-400">(본문 없음 — 조 제목만)</p>
  );
}

function ItemRow({
  item,
  open,
  isAdmin,
  busy,
  missingById,
  claimedBy,
  onDecide,
  canResolve,
  onResolve,
}: {
  item: ReparseItem;
  open: boolean;
  isAdmin: boolean;
  busy: boolean;
  missingById: Map<string, ReparseItem>;
  claimedBy: Map<string, ReparseItem>;
  onDecide: (decision: ReparseDecision | null, targetArticleId?: string | null) => void;
  canResolve: boolean;
  onResolve: (decision: 'keep' | 'repeal') => void;
}) {
  const result = outcomeLabel(item);
  const resolved = item.outcome?.action === 'keep' || (item.outcome?.action === 'repeal' && item.outcome.status === 'done');
  const p = item.parsed;
  const s = item.stored;
  const ch = item.changes;
  const linkedTo = item.kind === 'missing' && s ? claimedBy.get(s.articleId) : undefined;
  const options = REPARSE_DECISIONS[item.kind];
  const placeChanged = ch && (ch.position || ch.chapter || ch.section);
  return (
    <li className="px-4 py-3 space-y-2" data-testid="reparse-item" data-kind={item.kind}>
      <div className="flex flex-wrap items-center gap-1.5">
        <span className={clsx('text-[11px] px-1.5 py-0.5 rounded border', KIND_STYLE[item.kind])}>{REPARSE_KIND_LABEL[item.kind]}</span>
        <span className="text-sm font-semibold text-navy-800">
          {item.kind === 'missing' ? s?.label : p?.label}
          {(p?.title || s?.title) && <span className="ml-1 font-normal text-gray-800">{p?.title || s?.title}</span>}
        </span>
        {s && p && placeChanged && (
          <span className="text-xs text-gray-600 inline-flex items-center gap-1">
            ← 기존 {s.label}
            {ch?.chapter && <> · {chapterName(s.chapter)}에서</>}
          </span>
        )}
        {ch?.title && s && <span className="text-xs text-gray-600">· 조 제목 「{s.title || '없음'}」에서 바뀜</span>}
        {item.reasons.map((r) => (
          <span key={r} className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-600">
            {REPARSE_REASON_LABEL[r] ?? r}
          </span>
        ))}
        {s?.pending && (
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-900">
            {s.pending.status === 'review' ? '검토 중 버전 있음' : '초안 있음'}
          </span>
        )}
        {result && (
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-sky-100 text-sky-900" data-testid="reparse-outcome">
            {result}
          </span>
        )}
      </div>

      {item.kind === 'changed' && <Diff item={item} />}
      {(item.kind === 'new' || item.kind === 'ambiguous' || item.kind === 'moved' || item.kind === 'same') && p && <Body text={p.content} />}
      {item.kind === 'missing' && s && (
        <>
          <Body text={s.base?.content ?? ''} />
          {s.base && (
            <p className="text-[11px] text-gray-500">
              v{s.base.versionNum} · {s.base.status === 'published' ? '발행본' : s.base.status === 'archived' ? '지난 버전' : '작업본'}
              {s.base.effectiveDate ? ` · 시행 ${s.base.effectiveDate}` : ''}
            </p>
          )}
        </>
      )}
      {item.kind === 'changed' && s?.base && (
        <p className="text-[11px] text-gray-500">
          비교 대상: 기존 {s.label} v{s.base.versionNum}
          {s.base.effectiveDate ? ` (시행 ${s.base.effectiveDate})` : ''} — 지운 낱말은 취소선, 더한 낱말은 초록
        </p>
      )}
      {item.kind === 'moved' && ch?.spacingOnly && (
        <p className="text-[11px] text-amber-800">띄어쓰기만 같고 번호가 달라 같은 조문인지 확인하세요(PDF 줄바꿈 위치가 바뀐 경우가 많습니다).</p>
      )}

      {item.kind === 'ambiguous' && item.candidates && (
        <fieldset className="space-y-1" disabled={!open || busy}>
          <legend className="text-[11px] text-gray-600">같은 본문의 기존 조문 — 이은 조문을 고르세요</legend>
          {item.candidates.map((c) => (
            <label key={c.articleId} className="flex items-start gap-2 text-xs text-gray-800">
              <input
                type="radio"
                name={`pick-${item.id}`}
                checked={item.decision === 'pick' && item.targetArticleId === c.articleId}
                onChange={() => onDecide('pick', c.articleId)}
              />
              <span className="min-w-0 break-words">
                <b>{c.label}</b> {c.title}
                {c.repealed && <span className="ml-1 text-rose-700">(폐지된 조문)</span>}
              </span>
            </label>
          ))}
        </fieldset>
      )}

      {item.kind === 'new' && open && (
        <label className="flex flex-wrap items-center gap-2 text-xs text-gray-700">
          원문에 없는 기존 조문에 잇기
          <select
            className="input text-xs py-1 w-auto max-w-full"
            value={item.decision === 'link' ? item.targetArticleId ?? '' : ''}
            disabled={busy}
            onChange={(e) => (e.target.value ? onDecide('link', e.target.value) : onDecide('new'))}
          >
            <option value="">잇지 않음</option>
            {[...missingById.values()]
              .filter((m) => !claimedBy.has(m.articleId!) || claimedBy.get(m.articleId!)?.id === item.id)
              .map((m) => (
                <option key={m.articleId} value={m.articleId!}>
                  {m.stored?.label} {m.stored?.title}
                </option>
              ))}
          </select>
        </label>
      )}

      {item.kind === 'missing' && canResolve && !resolved && !linkedTo && (
        <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label={`${s?.label} 삭제 여부`}>
          <span className="text-[11px] text-gray-600">승인 뒤 삭제 여부:</span>
          <button type="button" className="text-xs px-2.5 py-1 rounded border bg-white border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-50" disabled={busy} onClick={() => onResolve('keep')}>
            유지로 닫기
          </button>
          <button
            type="button"
            className="text-xs px-2.5 py-1 rounded border bg-white border-red-300 text-red-700 hover:bg-red-50 disabled:opacity-50"
            disabled={busy || !isAdmin}
            title={!isAdmin ? '폐지는 관리자만 할 수 있습니다.' : '오늘부터 이 조문을 시행에서 뺍니다(버전 이력은 남습니다)'}
            onClick={() => onResolve('repeal')}
          >
            오늘 폐지
          </button>
        </div>
      )}
      {linkedTo ? (
        <p className="text-[11px] text-sky-800">이 조문은 {linkedTo.parsed?.label}에 이어졌습니다.</p>
      ) : (
        options.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label={`${p?.label ?? s?.label} 결정`}>
            {options
              .filter((d) => d !== 'pick' && d !== 'link')
              .map((d) => {
                const disabled = !open || busy || (d === 'repeal' && !isAdmin);
                const active = item.decision === d;
                return (
                  <button
                    key={d}
                    type="button"
                    disabled={disabled}
                    title={d === 'repeal' && !isAdmin ? '폐지는 관리자만 정할 수 있습니다.' : undefined}
                    aria-pressed={active}
                    onClick={() => onDecide(active && item.kind === 'missing' ? null : d)}
                    className={clsx(
                      'text-xs px-2.5 py-1 rounded border disabled:opacity-50',
                      active ? 'bg-navy-700 border-navy-700 text-white' : 'bg-white border-gray-300 text-gray-700 hover:bg-gray-50',
                    )}
                  >
                    {REPARSE_DECISION_LABEL[d]}
                  </button>
                );
              })}
            {!item.decision && item.kind !== 'missing' && <span className="text-[11px] text-amber-700">결정이 필요합니다</span>}
            {!item.decision && item.kind === 'missing' && <span className="text-[11px] text-gray-500">삭제 여부 미결</span>}
            {item.decidedAt && (
              <span className="text-[10px] text-gray-400">정함 {new Date(item.decidedAt).toLocaleString('ko-KR')}</span>
            )}
            {!item.decidedAt && item.decision && item.recommended && <span className="text-[10px] text-gray-400">미리 골라 둠</span>}
          </div>
        )
      )}
    </li>
  );
}

/**
 * 반영·묶음 검토 요청·승인·반려 (T-110 ②) — 반영은 기존 조문의 초안만 만들고(지금 규정은 그대로), 새 조문·장은 승인 때 만든다.
 * 묶음 승인은 같은 시행일로 전부 되거나 전부 안 된다.
 */
function BundlePanel({
  review,
  isAdmin,
  canEdit,
  busy,
  run,
  onRecompare,
}: {
  review: ReparseReview;
  isAdmin: boolean;
  canEdit: boolean;
  busy: boolean;
  run: (fn: () => Promise<ReparseReview>) => void;
  onRecompare: () => void;
}) {
  const [effectiveDate, setEffectiveDate] = useState(serviceToday());
  const [changeNote, setChangeNote] = useState('');
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  const drafts = review.items.filter((i) => i.version);
  const plan = review.plan;
  const status = review.status;
  if (status === 'superseded') return null;
  const parts = plan
    ? [
        drafts.length ? `묶음 초안 ${drafts.length}건` : null,
        plan.newArticles.length ? `새 조문 ${plan.newArticles.length}건(승인 때 만듦)` : null,
        plan.chapters.create.length ? `새 장 ${plan.chapters.create.length}개` : null,
        plan.chapters.update.length ? `장 번호·제목 변경 ${plan.chapters.update.length}개` : null,
        plan.repeals.length ? `폐지 ${plan.repeals.length}건` : null,
      ].filter(Boolean)
    : [];
  const blocked = review.stale || review.sourceChanged;
  return (
    <section className="bg-white border border-gray-300 shadow-sm p-4 space-y-3" aria-label="반영과 묶음 승인" data-testid="bundle-panel">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-semibold text-gray-900">반영과 묶음 승인</h2>
        <span className="text-[11px] px-1.5 py-0.5 rounded border border-gray-200 bg-gray-50 text-gray-700" data-testid="bundle-status">
          {REPARSE_STATUS_LABEL[status]}
        </span>
      </div>
      {status === 'open' && (
        <>
          <p className="text-xs text-gray-600 leading-relaxed">
            결정대로 <b>기존 조문의 묶음 초안</b>(개정 본문·옮길 자리)을 만듭니다. 지금 규정의 본문·번호는 그대로이고, 새 조문·새 장은 묶음을 승인할 때
            만듭니다. 초안은 규정 화면에서 고친 뒤 묶음으로 검토 요청·승인합니다.
          </p>
          <button
            type="button"
            className="btn-primary text-sm"
            disabled={busy || !canEdit || review.undecided > 0 || blocked}
            onClick={() => run(() => reparseApi.apply(review.id))}
          >
            반영 — 묶음 초안 만들기
          </button>
          {review.undecided > 0 && <span className="ml-2 text-[11px] text-amber-700">결정이 남은 항목 {review.undecided}건을 먼저 정하세요.</span>}
        </>
      )}
      {(status === 'applied' || status === 'submitted' || status === 'approved') && parts.length > 0 && (
        <p className="text-xs text-gray-700" data-testid="bundle-summary">
          {parts.join(' · ')}
        </p>
      )}
      {status === 'applied' && (
        <div className="flex flex-wrap items-center gap-2">
          <p className="basis-full text-[11px] text-gray-500">
            묶음 초안은 규정 화면에서 고칠 수 있습니다. 검토 요청하면 더 고칠 수 없고, 본문의 변수 표식은 오늘 값으로 바뀝니다.
          </p>
          <button type="button" className="btn-primary text-sm" disabled={busy || !canEdit || review.stale} onClick={() => run(() => reparseApi.submit(review.id))}>
            묶음 검토 요청
          </button>
          {isAdmin && (
            <button type="button" className="btn-secondary text-sm" disabled={busy} onClick={() => setRejecting((v) => !v)}>
              묶음 반려
            </button>
          )}
        </div>
      )}
      {status === 'submitted' && (
        <div className="space-y-2">
          {isAdmin ? (
            <>
              <div className="grid grid-cols-1 md:grid-cols-[14rem_1fr] gap-2">
                <label className="text-xs text-gray-700">
                  사내 규정 시행일
                  <input type="date" className="input mt-1" value={effectiveDate} onChange={(e) => setEffectiveDate(e.target.value)} />
                </label>
                <label className="text-xs text-gray-700">
                  개정 사유
                  <input className="input mt-1" value={changeNote} onChange={(e) => setChangeNote(e.target.value)} placeholder="예: 취업규칙 개정 반영" />
                </label>
              </div>
              <p className="text-[11px] text-gray-500 leading-relaxed">
                묶음의 모든 조문이 이 날부터 시행됩니다(전부 되거나 전부 안 됨). 자리가 바뀌는 조문은 그 전 날짜의 시점 조회에서 옛 번호로 남습니다.
                시행일이 미래면 폐지로 정한 조문은 미결로 남고, 승인 뒤 그날이 지나 따로 폐지합니다.
              </p>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className="btn-primary text-sm"
                  disabled={busy || !changeNote.trim() || !/^\d{4}-\d{2}-\d{2}$/.test(effectiveDate) || review.stale}
                  onClick={() => run(() => reparseApi.approve(review.id, { effectiveDate, changeNote: changeNote.trim() }))}
                >
                  묶음 승인 — 후속 버전 발행
                </button>
                <button type="button" className="btn-secondary text-sm" disabled={busy} onClick={() => setRejecting((v) => !v)}>
                  묶음 반려
                </button>
              </div>
            </>
          ) : (
            <p className="text-xs text-gray-600">관리자가 시행일·사유를 정해 묶음으로 승인합니다.</p>
          )}
        </div>
      )}
      {rejecting && (status === 'applied' || status === 'submitted') && isAdmin && (
        <div className="flex flex-wrap items-end gap-2 border-t border-gray-100 pt-2">
          <label className="text-xs text-gray-700 flex-1 min-w-[14rem]">
            반려 사유
            <input className="input mt-1" value={reason} onChange={(e) => setReason(e.target.value)} />
          </label>
          <button
            type="button"
            className="btn-secondary text-sm border-red-300 text-red-700"
            disabled={busy || !reason.trim()}
            onClick={() => run(() => reparseApi.reject(review.id, reason.trim()))}
          >
            반려 — 묶음 초안 거두기
          </button>
        </div>
      )}
      {status === 'approved' && (
        <p className="text-xs text-emerald-800" data-testid="bundle-approved">
          {review.effectiveDate?.slice(0, 10)}부터 시행 · 사유: {review.changeNote}
        </p>
      )}
      {status === 'rejected' && (
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-xs text-gray-700">반려함 — {review.rejectReason}. 묶음 초안은 거뒀습니다.</p>
          {review.sessionId && canEdit && (
            <button type="button" className="btn-secondary text-xs py-1" disabled={busy} onClick={onRecompare}>
              같은 원문으로 다시 비교
            </button>
          )}
        </div>
      )}
    </section>
  );
}
