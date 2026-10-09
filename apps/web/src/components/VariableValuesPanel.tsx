import { useState } from 'react';
import { apiErrorMessage } from '../lib/apiError';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  BINDING_REVIEW_REASON_LABEL,
  VARIABLE_PICK_REASON_LABEL,
  variablesApi,
  type VariableValueRow,
} from '../api/policies';

type ValueForm = { value: string; validFrom: string; validTo: string; note: string };
const EMPTY: ValueForm = { value: '', validFrom: '', validTo: '', note: '' };

/**
 * 변수 하나의 값·유효기간과 연결된 조문 (T-109, 특허 도 9).
 *
 * 유효기간은 [시작, 종료) — 종료일 당일에는 다음 값이 쓰인다. 기간이 겹치는 값은 저장되지만 그 기간에는 이 변수를
 * 쓰지 않는다(어느 값인지 정할 수 없다). 옛 기본값을 옮긴 값은 "기간 미확정"이라 기간을 정하기 전에는 쓰지 않는다.
 */
export default function VariableValuesPanel({ variableId, canEdit }: { variableId: string; canEdit: boolean }) {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ['variable', variableId], queryFn: () => variablesApi.get(variableId) });
  const [adding, setAdding] = useState<ValueForm>(EMPTY);
  const [editing, setEditing] = useState<{ id: string; form: ValueForm } | null>(null);
  const [notice, setNotice] = useState<{ kind: 'warn' | 'error'; text: string } | null>(null);

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['variable', variableId] });
    qc.invalidateQueries({ queryKey: ['variables'] });
  };
  const onError = (err: unknown) => setNotice({ kind: 'error', text: apiErrorMessage(err, '저장하지 못했습니다.') });
  const afterSave = (r: { changedOverlaps?: boolean }) => {
    refresh();
    setNotice(r?.changedOverlaps ? { kind: 'warn', text: '다른 값과 기간이 겹칩니다 — 겹치는 기간에는 이 변수를 쓰지 않습니다. 기간을 고쳐 주세요.' } : null);
  };

  const add = useMutation({
    mutationFn: () =>
      variablesApi.addValue(variableId, {
        value: adding.value,
        validFrom: adding.validFrom || null,
        validTo: adding.validTo || null,
        note: adding.note || undefined,
      }),
    onSuccess: (r) => {
      setAdding(EMPTY);
      afterSave(r);
    },
    onError,
  });
  const save = useMutation({
    mutationFn: (e: { id: string; form: ValueForm }) =>
      variablesApi.updateValue(variableId, e.id, {
        value: e.form.value,
        validFrom: e.form.validFrom || null,
        validTo: e.form.validTo || null,
        note: e.form.note,
      }),
    onSuccess: (r) => {
      setEditing(null);
      afterSave(r);
    },
    onError,
  });
  const confirmPeriod = useMutation({
    mutationFn: (valueId: string) => variablesApi.updateValue(variableId, valueId, { confirmPeriod: true }),
    onSuccess: afterSave,
    onError,
  });
  const remove = useMutation({
    mutationFn: (valueId: string) => variablesApi.deleteValue(variableId, valueId),
    onSuccess: afterSave,
    onError,
  });

  if (!data) return <p className="px-4 py-3 text-xs text-gray-400">불러오는 중…</p>;

  const period = (v: VariableValueRow) => `${v.validFrom ?? '처음부터'} ~ ${v.validTo ? `${v.validTo} 전날` : '끝 없음'}`;
  const formRow = (f: ValueForm, set: (f: ValueForm) => void, idPrefix: string) => (
    <>
      <input id={`${idPrefix}-value`} aria-label="값" className="input py-1 text-sm" placeholder="값 (예: 관리팀)" value={f.value}
        onChange={(e) => set({ ...f, value: e.target.value })} />
      <input id={`${idPrefix}-from`} aria-label="시작일" type="date" className="input py-1 text-sm" value={f.validFrom}
        onChange={(e) => set({ ...f, validFrom: e.target.value })} />
      <input id={`${idPrefix}-to`} aria-label="종료일" type="date" className="input py-1 text-sm" value={f.validTo}
        onChange={(e) => set({ ...f, validTo: e.target.value })} />
      <input id={`${idPrefix}-note`} aria-label="메모" className="input py-1 text-sm" placeholder="메모 (선택)" value={f.note}
        onChange={(e) => set({ ...f, note: e.target.value })} />
    </>
  );

  return (
    <div className="px-4 py-3 space-y-4 text-sm" data-testid="variable-values-panel">
      <section className="space-y-2">
        <h3 className="text-xs font-semibold text-gray-700">
          값과 유효기간{' '}
          <span className="font-normal text-gray-500">— 시작일부터 종료일 전날까지. 종료일 당일에는 다음 값이 쓰입니다.</span>
        </h3>
        {notice && (
          <p role={notice.kind === 'error' ? 'alert' : 'status'}
            className={notice.kind === 'error' ? 'text-xs text-red-700 bg-red-50 border border-red-200 rounded px-2 py-1' : 'text-xs text-amber-800 bg-amber-50 border border-amber-300 rounded px-2 py-1'}>
            {notice.text}
          </p>
        )}
        {data.values.length === 0 ? (
          <p className="text-xs text-gray-500">값이 없습니다 — 값을 넣어야 검토 요청 때 표식을 바꾸고 개정 후보에 쓸 수 있습니다.</p>
        ) : (
          <ul className="divide-y divide-gray-200 border border-gray-200 rounded bg-white">
            {data.values.map((v) => (
              <li key={v.id} className="px-3 py-2" data-testid="variable-value">
                {editing?.id === v.id ? (
                  <div className="grid grid-cols-1 sm:grid-cols-4 gap-2">
                    {formRow(editing.form, (form) => setEditing({ id: v.id, form }), `edit-${v.id}`)}
                    <div className="sm:col-span-4 flex gap-2">
                      <button type="button" className="btn-primary text-xs" disabled={!editing.form.value.trim() || save.isPending}
                        onClick={() => save.mutate(editing)}>
                        저장
                      </button>
                      <button type="button" className="btn-secondary text-xs" onClick={() => setEditing(null)}>취소</button>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <span className="font-medium text-gray-900">{v.value}</span>
                    <span className="text-xs text-gray-600">{period(v)}</span>
                    {data.current?.id === v.id && (
                      <span className="text-[11px] px-1.5 py-0.5 rounded bg-emerald-50 border border-emerald-300 text-emerald-800">오늘 값</span>
                    )}
                    {v.overlapping && (
                      <span className="text-[11px] px-1.5 py-0.5 rounded bg-amber-50 border border-amber-300 text-amber-800">기간 겹침</span>
                    )}
                    {!v.periodConfirmed && (
                      <span className="text-[11px] px-1.5 py-0.5 rounded bg-amber-50 border border-amber-300 text-amber-800">
                        기간 미확정(옛 기본값)
                      </span>
                    )}
                    {v.note && <span className="text-xs text-gray-500">— {v.note}</span>}
                    {canEdit && (
                      <span className="ml-auto flex gap-2">
                        {!v.periodConfirmed && (
                          <button type="button" className="text-xs text-navy-700 hover:underline" onClick={() => confirmPeriod.mutate(v.id)}>
                            이 기간으로 확정
                          </button>
                        )}
                        <button type="button" className="text-xs text-navy-700 hover:underline"
                          onClick={() => setEditing({ id: v.id, form: { value: v.value, validFrom: v.validFrom ?? '', validTo: v.validTo ?? '', note: v.note ?? '' } })}>
                          고치기
                        </button>
                        <button type="button" className="text-xs text-red-700 hover:underline"
                          onClick={() => confirm(`"${v.value}" 값을 지울까요?`) && remove.mutate(v.id)}>
                          지우기
                        </button>
                      </span>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
        {!data.current && data.currentReason && (
          <p className="text-xs text-amber-700">오늘 쓸 값: {VARIABLE_PICK_REASON_LABEL[data.currentReason]}</p>
        )}
        {canEdit && (
          <div className="grid grid-cols-1 sm:grid-cols-5 gap-2 items-center" data-testid="variable-value-add">
            {formRow(adding, setAdding, 'add')}
            <button type="button" className="btn-secondary text-xs" disabled={!adding.value.trim() || add.isPending} onClick={() => add.mutate()}>
              값 추가
            </button>
          </div>
        )}
      </section>

      <section className="space-y-2">
        <h3 className="text-xs font-semibold text-gray-700">
          연결된 조문 <span className="font-normal text-gray-500">— 지금 시행 중인 본문에서 이 변수의 값인 자리</span>
        </h3>
        {data.bindings.length === 0 ? (
          <p className="text-xs text-gray-500">
            연결된 조문이 없습니다. 규정 화면의 버전 카드에서 "변수 연결"로 문구를 골라 잇거나, 초안에 표식을 넣고 검토를 요청하세요.
          </p>
        ) : (
          <ul className="space-y-1">
            {data.bindings.map((b) => (
              <li key={b.id} className="text-xs text-gray-700 flex flex-wrap gap-x-2" data-testid="variable-binding">
                <Link to={`/policies/${b.policy.id}#${b.article.label}`} className="text-navy-700 hover:underline">
                  {b.policy.title} {b.article.label}
                </Link>
                <span className="text-gray-500">
                  …{b.contextBefore}
                  <mark className="bg-amber-100 text-gray-900 px-0.5">{b.text}</mark>
                  {b.contextAfter}…
                </span>
                {b.state === 'needs_review' && (
                  <span className="text-amber-800">
                    다시 이어야 함{b.reviewReason ? ` — ${BINDING_REVIEW_REASON_LABEL[b.reviewReason] ?? b.reviewReason}` : ''}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
