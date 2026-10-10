import { useMemo, useRef, useState, type ReactNode } from 'react';
import { apiErrorMessage } from '../lib/apiError';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BINDING_REVIEW_REASON_LABEL, variablesApi, type VariableBindingRow } from '../api/policies';

/**
 * 변수 연결 창 (T-109, 특허 도 9) — 오늘 시행 중인 버전이나 시행 예정 버전의 문구를 골라 변수에 잇는다(버전마다 따로, T-132 ⑥).
 *
 * 저장된 본문을 그대로 보여 주는 읽기 전용 입력칸에서 고른다 — 화면의 본문은 `**굵게**` 표시를 빼고 그려서
 * 위치가 저장된 문자열과 어긋난다. 입력칸의 선택 위치는 저장된 문자열의 UTF-16 위치와 같다.
 */
export default function VariableBindingDialog({
  version,
  phase,
  articleId,
  canEdit,
  onClose,
}: {
  version: { id: string; versionNum: number; content: string; effectiveDate?: string | null };
  /** 오늘 시행 중 / 시행 예정 — 이 버전에만 잇고 푼다(다른 버전의 연결은 그대로) */
  phase?: 'in_force' | 'scheduled';
  articleId: string;
  canEdit: boolean;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const area = useRef<HTMLTextAreaElement>(null);
  const [sel, setSel] = useState<{ start: number; end: number } | null>(null);
  const [variableId, setVariableId] = useState('');
  const [error, setError] = useState('');
  const { data: variables = [] } = useQuery({ queryKey: ['variables'], queryFn: variablesApi.list });
  const { data: bindings = [] } = useQuery({
    queryKey: ['versionBindings', version.id],
    queryFn: () => variablesApi.versionBindings(version.id),
  });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['versionBindings', version.id] });
    qc.invalidateQueries({ queryKey: ['versions', articleId] });
    qc.invalidateQueries({ queryKey: ['variables'] });
  };
  const bind = useMutation({
    mutationFn: () => {
      const s = sel!;
      return variablesApi.bind(version.id, { variableId, start: s.start, end: s.end, text: version.content.slice(s.start, s.end) });
    },
    onSuccess: () => {
      setSel(null);
      setError('');
      refresh();
    },
    onError: (err) => setError(apiErrorMessage(err, '잇지 못했습니다.')),
  });
  const release = useMutation({
    mutationFn: (id: string) => variablesApi.release(id),
    onSuccess: refresh,
    onError: (err) => setError(apiErrorMessage(err, '풀지 못했습니다.')),
  });

  /** 고른 구간에서 앞뒤 공백을 뺀다 */
  const onSelect = () => {
    const el = area.current;
    if (!el) return;
    let start = el.selectionStart;
    let end = el.selectionEnd;
    while (start < end && /\s/.test(version.content[start])) start++;
    while (end > start && /\s/.test(version.content[end - 1])) end--;
    setSel(end > start ? { start, end } : null);
  };

  const active = useMemo(
    () => bindings.filter((b) => b.state === 'active').sort((a, b) => a.start - b.start),
    [bindings],
  );
  const overlapsExisting = !!sel && active.some((b) => b.start < sel.end && sel.start < b.end);

  /** 이은 자리를 표시한 본문 */
  const preview = useMemo(() => {
    const out: ReactNode[] = [];
    let at = 0;
    for (const b of active) {
      if (b.start < at) continue;
      out.push(version.content.slice(at, b.start));
      out.push(
        <mark key={b.id} className="bg-amber-100 text-gray-900 px-0.5 rounded" title={b.variable?.label}>
          {version.content.slice(b.start, b.end)}
        </mark>,
      );
      at = b.end;
    }
    out.push(version.content.slice(at));
    return out;
  }, [active, version.content]);

  const label = (b: VariableBindingRow) => b.variable?.label ?? '변수';

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" role="dialog" aria-labelledby="var-bind-title">
      <div className="bg-white border border-gray-300 shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div id="var-bind-title" className="bg-navy-800 text-white px-5 py-3 font-medium text-sm">
          변수 연결 — v{version.versionNum}
          {phase === 'scheduled' ? ` · ${String(version.effectiveDate ?? '').slice(0, 10)}부터 시행 예정` : phase === 'in_force' ? ' · 오늘 시행 중' : ''}
        </div>
        <div className="p-5 space-y-4 text-sm">
          {phase === 'scheduled' && (
            <p className="text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded px-2 py-1.5" data-testid="binding-phase-note">
              시행 예정 본문입니다. 여기서 잇고 푸는 것은 이 버전에만 적용되고, 오늘 시행 중인 본문의 연결은 그대로입니다.
            </p>
          )}
          <div>
            <p className="text-xs text-gray-600 mb-1">이은 자리</p>
            <p className="whitespace-pre-wrap leading-relaxed bg-gray-50 border border-gray-200 rounded p-3" data-testid="binding-preview">
              {preview}
            </p>
          </div>

          {bindings.length > 0 && (
            <ul className="space-y-1" data-testid="binding-list">
              {bindings.map((b) => (
                <li key={b.id} className="flex flex-wrap items-center gap-x-2 text-xs">
                  <span className="font-medium text-gray-800">{label(b)}</span>
                  <span className="text-gray-600">"{b.text}"{b.occurrence > 0 ? ` (${b.occurrence + 1}번째)` : ''}</span>
                  {b.state === 'needs_review' && (
                    <span className="text-amber-800">
                      다시 이어야 함{b.reviewReason ? ` — ${BINDING_REVIEW_REASON_LABEL[b.reviewReason] ?? b.reviewReason}` : ''}
                    </span>
                  )}
                  {canEdit && (
                    <button type="button" className="text-red-700 hover:underline" disabled={release.isPending}
                      onClick={() => release.mutate(b.id)}>
                      연결 풀기
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}

          {canEdit && (
            <div className="space-y-2 border-t border-gray-200 pt-3">
              <label htmlFor="var-bind-text" className="block text-xs text-gray-600">
                변수 값인 문구를 마우스로 고르세요(같은 문구가 여러 번 나오면 고른 그 자리만 이어집니다)
              </label>
              <textarea
                id="var-bind-text"
                ref={area}
                readOnly
                rows={5}
                className="input w-full resize-y font-normal"
                value={version.content}
                onSelect={onSelect}
                onMouseUp={onSelect}
                onKeyUp={onSelect}
              />
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs text-gray-700" data-testid="binding-selection">
                  {sel ? <>고른 문구: <b>"{version.content.slice(sel.start, sel.end)}"</b></> : '고른 문구 없음'}
                </span>
                <select
                  aria-label="이을 변수"
                  className="input py-1 text-sm w-auto"
                  value={variableId}
                  onChange={(e) => setVariableId(e.target.value)}
                >
                  <option value="">변수 고르기…</option>
                  {variables.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.label} ({`{{${v.key}}}`})
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className="btn-primary text-xs"
                  disabled={!sel || !variableId || overlapsExisting || bind.isPending}
                  onClick={() => bind.mutate()}
                >
                  {bind.isPending ? '잇는 중…' : '연결'}
                </button>
              </div>
              {overlapsExisting && <p className="text-xs text-amber-700">이미 이은 자리와 겹칩니다.</p>}
            </div>
          )}

          {error && (
            <p role="alert" className="text-xs text-red-700 bg-red-50 border border-red-200 rounded px-2 py-1.5">
              {error}
            </p>
          )}
          <div className="flex justify-end">
            <button type="button" className="btn-secondary" onClick={onClose}>
              닫기
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
