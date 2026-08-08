/**
 * 제정·개정 이유(개정문) — 국가법령정보센터의 "제정·개정이유"에 해당하는 문서 단위 기록.
 *
 * 조문 단위 개정 사유는 시행 승인 시 `ArticleVersion.changeNote`로 이미 남는다.
 * 이 화면은 그 조문별 사유를 함께 보여줘서, 문서 차수와 실제 바뀐 조문이 한자리에서 대조된다.
 */

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { X, Plus, Pencil, Trash2 } from 'lucide-react';
import { clsx } from 'clsx';
import {
  policiesApi,
  type PolicyRevisionKind,
  type PolicyRevisionReason,
} from '../api/policies';
import { formatKoDate } from '../lib/legalArticleLabel';
import { LoadingBlock } from './ui/LoadingBlock';
import { EmptyState } from './ui/EmptyState';

const KIND_LABEL: Record<PolicyRevisionKind, string> = {
  enactment: '제정',
  amendment: '일부개정',
  full_amendment: '전부개정',
  repeal: '폐지',
};

const KIND_CLASS: Record<PolicyRevisionKind, string> = {
  enactment: 'bg-emerald-50 border-emerald-300 text-emerald-800',
  amendment: 'bg-sky-50 border-sky-300 text-sky-800',
  full_amendment: 'bg-amber-50 border-amber-300 text-amber-800',
  repeal: 'bg-rose-50 border-rose-300 text-rose-800',
};

type DraftState = {
  id: string | null;
  kind: PolicyRevisionKind;
  label: string;
  reason: string;
  summary: string;
  promulgatedDate: string;
  effectiveDate: string;
};

const emptyDraft = (): DraftState => ({
  id: null,
  kind: 'amendment',
  label: '',
  reason: '',
  summary: '',
  promulgatedDate: '',
  effectiveDate: '',
});

/** 조문별 개정 사유(승인 시 기록된 changeNote)를 시행일 기준으로 모은다 */
function collectArticleChangeNotes(policy: any) {
  const rows: { key: string; label: string; note: string; effectiveDate: string | null }[] = [];
  for (const chapter of policy?.chapters || []) {
    for (const article of chapter.articles || []) {
      const version = article.versions?.[0];
      const note = String(version?.changeNote ?? '').trim();
      if (!note) continue;
      rows.push({
        key: version.id,
        label: `제${article.number}조${article.title ? ` (${article.title})` : ''}`,
        note,
        effectiveDate: version.effectiveDate ?? null,
      });
    }
  }
  return rows.sort((a, b) => String(b.effectiveDate ?? '').localeCompare(String(a.effectiveDate ?? '')));
}

export default function RevisionReasonsModal({
  policyId,
  policy,
  canEdit,
  onClose,
}: {
  policyId: string;
  policy: any;
  canEdit: boolean;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [draft, setDraft] = useState<DraftState | null>(null);
  const [error, setError] = useState('');

  const { data: reasons = [], isLoading } = useQuery<PolicyRevisionReason[]>({
    queryKey: ['policy', policyId, 'revision-reasons'],
    queryFn: () => policiesApi.listRevisionReasons(policyId),
  });

  const articleNotes = useMemo(() => collectArticleChangeNotes(policy), [policy]);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['policy', policyId, 'revision-reasons'] });
    qc.invalidateQueries({ queryKey: ['policy', policyId] });
  };

  const saveMutation = useMutation({
    mutationFn: (d: DraftState) => {
      const payload = {
        kind: d.kind,
        label: d.label.trim(),
        reason: d.reason,
        summary: d.summary || null,
        promulgatedDate: d.promulgatedDate || null,
        effectiveDate: d.effectiveDate || null,
      };
      return d.id
        ? policiesApi.updateRevisionReason(policyId, d.id, payload)
        : policiesApi.createRevisionReason(policyId, payload);
    },
    onSuccess: () => {
      invalidate();
      setDraft(null);
      setError('');
    },
    onError: (err: any) => {
      setError(err?.response?.data?.message?.toString() || '저장에 실패했습니다.');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (reasonId: string) => policiesApi.deleteRevisionReason(policyId, reasonId),
    onSuccess: invalidate,
  });

  const startEdit = (row: PolicyRevisionReason) => {
    setError('');
    setDraft({
      id: row.id,
      kind: row.kind,
      label: row.label,
      reason: row.reason,
      summary: row.summary ?? '',
      promulgatedDate: row.promulgatedDate ? String(row.promulgatedDate).slice(0, 10) : '',
      effectiveDate: row.effectiveDate ? String(row.effectiveDate).slice(0, 10) : '',
    });
  };

  const canSubmit = !!draft?.label.trim() && !!draft?.reason.trim();

  return (
    <div className="fixed inset-0 z-50 bg-black/55 flex items-center justify-center p-3 sm:p-4">
      <div className="bg-white w-full max-w-3xl max-h-[90vh] border border-gray-300 shadow-2xl flex flex-col">
        <div className="bg-navy-900 text-white px-4 py-3 flex items-center justify-between gap-2">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold">제정·개정 이유</h2>
            <p className="text-[11px] text-navy-200 mt-0.5">
              문서 차수별 제·개정 이유와, 승인 시 기록된 조문별 개정 사유
            </p>
          </div>
          <button type="button" onClick={onClose} className="text-navy-200 hover:text-white p-1" aria-label="닫기">
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {canEdit && !draft && (
            <button
              type="button"
              onClick={() => {
                setError('');
                setDraft(emptyDraft());
              }}
              className="btn-primary text-xs py-1.5 inline-flex items-center gap-1"
            >
              <Plus size={14} />
              제·개정 이유 추가
            </button>
          )}

          {draft && (
            <section className="border border-navy-200 rounded bg-navy-50/40 p-3 space-y-2.5">
              <div className="flex flex-wrap gap-2">
                <div className="w-32">
                  <label className="block text-[11px] text-gray-600 mb-1">구분</label>
                  <select
                    className="input text-xs py-1.5"
                    value={draft.kind}
                    onChange={(e) => setDraft({ ...draft, kind: e.target.value as PolicyRevisionKind })}
                  >
                    {(Object.keys(KIND_LABEL) as PolicyRevisionKind[]).map((k) => (
                      <option key={k} value={k}>
                        {KIND_LABEL[k]}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="flex-1 min-w-[12rem]">
                  <label className="block text-[11px] text-gray-600 mb-1">차수 라벨</label>
                  <input
                    className="input text-xs py-1.5"
                    placeholder="예) 제3차 일부개정"
                    value={draft.label}
                    onChange={(e) => setDraft({ ...draft, label: e.target.value })}
                  />
                </div>
                <div className="w-36">
                  <label className="block text-[11px] text-gray-600 mb-1">공포일</label>
                  <input
                    type="date"
                    className="input text-xs py-1.5"
                    value={draft.promulgatedDate}
                    onChange={(e) => setDraft({ ...draft, promulgatedDate: e.target.value })}
                  />
                </div>
                <div className="w-36">
                  <label className="block text-[11px] text-gray-600 mb-1">시행일</label>
                  <input
                    type="date"
                    className="input text-xs py-1.5"
                    value={draft.effectiveDate}
                    onChange={(e) => setDraft({ ...draft, effectiveDate: e.target.value })}
                  />
                </div>
              </div>
              <div>
                <label className="block text-[11px] text-gray-600 mb-1">개정 이유</label>
                <textarea
                  className="input text-xs py-1.5 min-h-[7rem]"
                  placeholder="왜 개정했는지를 서술합니다."
                  value={draft.reason}
                  onChange={(e) => setDraft({ ...draft, reason: e.target.value })}
                />
              </div>
              <div>
                <label className="block text-[11px] text-gray-600 mb-1">주요 변경사항 (선택)</label>
                <textarea
                  className="input text-xs py-1.5 min-h-[4.5rem]"
                  placeholder="가. …&#10;나. …"
                  value={draft.summary}
                  onChange={(e) => setDraft({ ...draft, summary: e.target.value })}
                />
              </div>
              {error && (
                <p className="text-[11px] text-red-600 bg-red-50 border border-red-200 rounded px-2 py-1">{error}</p>
              )}
              <div className="flex gap-2">
                <button
                  type="button"
                  className="btn-primary text-xs py-1.5"
                  disabled={!canSubmit || saveMutation.isPending}
                  onClick={() => draft && saveMutation.mutate(draft)}
                >
                  {saveMutation.isPending ? '저장 중…' : '저장'}
                </button>
                <button type="button" className="btn-secondary text-xs py-1.5" onClick={() => setDraft(null)}>
                  취소
                </button>
              </div>
            </section>
          )}

          <section className="space-y-2">
            <h3 className="text-xs font-semibold text-gray-700">문서 차수별 제·개정 이유</h3>
            {isLoading ? (
              <LoadingBlock />
            ) : reasons.length === 0 ? (
              <EmptyState
                title="등록된 제·개정 이유가 없습니다."
                description={canEdit ? '위 버튼으로 차수별 개정 이유를 남겨두면 열람자가 개정 배경을 확인할 수 있습니다.' : undefined}
              />
            ) : (
              <ul className="space-y-2">
                {reasons.map((row) => (
                  <li key={row.id} className="border border-gray-200 rounded p-3 bg-white">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span
                            className={clsx(
                              'inline-flex items-center rounded border px-1.5 py-0.5 text-[11px] font-semibold',
                              KIND_CLASS[row.kind],
                            )}
                          >
                            {KIND_LABEL[row.kind]}
                          </span>
                          <span className="text-sm font-medium text-gray-900">{row.label}</span>
                        </div>
                        <p className="text-[11px] text-gray-500 mt-1">
                          {row.promulgatedDate ? `공포 ${formatKoDate(row.promulgatedDate)}` : '공포일 미기재'}
                          {' · '}
                          {row.effectiveDate ? `시행 ${formatKoDate(row.effectiveDate)}` : '시행일 미기재'}
                        </p>
                      </div>
                      {canEdit && (
                        <div className="flex gap-1 shrink-0">
                          <button
                            type="button"
                            onClick={() => startEdit(row)}
                            className="p-1 text-gray-400 hover:text-navy-700"
                            aria-label="수정"
                          >
                            <Pencil size={14} />
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              if (window.confirm(`"${row.label}" 항목을 삭제할까요?`)) {
                                deleteMutation.mutate(row.id);
                              }
                            }}
                            className="p-1 text-gray-400 hover:text-red-600"
                            aria-label="삭제"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      )}
                    </div>
                    <p className="text-sm text-gray-700 whitespace-pre-wrap mt-2 leading-relaxed">{row.reason}</p>
                    {row.summary ? (
                      <div className="mt-2 border-t border-gray-100 pt-2">
                        <p className="text-[11px] font-semibold text-gray-600 mb-1">주요 변경사항</p>
                        <p className="text-xs text-gray-700 whitespace-pre-wrap leading-relaxed">{row.summary}</p>
                      </div>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="space-y-2">
            <h3 className="text-xs font-semibold text-gray-700">
              조문별 개정 사유 <span className="font-normal text-gray-500">(시행 승인 시 기록)</span>
            </h3>
            {articleNotes.length === 0 ? (
              <p className="text-xs text-gray-400 border border-dashed border-gray-200 rounded px-3 py-4 text-center">
                시행 중인 버전에 기록된 개정 사유가 없습니다.
              </p>
            ) : (
              <ul className="space-y-1.5">
                {articleNotes.map((row) => (
                  <li key={row.key} className="border border-gray-200 rounded px-3 py-2 bg-gray-50/60">
                    <div className="flex flex-wrap items-baseline gap-2">
                      <span className="text-xs font-semibold text-navy-800">{row.label}</span>
                      <span className="text-[11px] text-gray-500">
                        {row.effectiveDate ? `${formatKoDate(row.effectiveDate)} 시행` : '시행일 미기재'}
                      </span>
                    </div>
                    <p className="text-xs text-gray-700 whitespace-pre-wrap mt-1">{row.note}</p>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <div className="border-t border-gray-200 px-4 py-2.5 flex justify-end">
          <button type="button" className="btn-secondary text-xs py-1.5" onClick={onClose}>
            닫기
          </button>
        </div>
      </div>
    </div>
  );
}
