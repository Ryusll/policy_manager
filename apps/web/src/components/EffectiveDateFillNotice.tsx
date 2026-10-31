/**
 * 시행일 없이 시행된 조문 안내 + 시행일 보정 (PAT-02).
 *
 * 예전 PDF·법제처 가져오기와 JSON 일괄 등록은 첫 버전을 시행일 없이 시행했다. 시점 조회는
 * 시행일이 있어야 버전을 고르므로 그런 조문은 시점 조회·법령 개정 분석에서 기준 본문이 되지 못한다.
 * 날짜를 지어내 채우지 않고 관리자가 확인한 날짜를 넣게 한다(승인일·생성일은 실제 시행일이 아니다).
 */
import { useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { versionsApi } from '../api/policies';
import { toast } from '../stores/toastStore';

type Conflict = { label: string; detail: string };

export function EffectiveDateFillNotice({
  policyId,
  chapters,
  isAdmin,
}: {
  policyId: string;
  chapters: { articles?: { versions?: { effectiveDate?: string | null }[] }[] }[];
  isAdmin: boolean;
}) {
  const qc = useQueryClient();
  // 상세 응답에는 조문마다 지금 시행 중인 버전 하나(versions[0])가 실린다
  const missing = useMemo(
    () =>
      chapters.reduce(
        (n, c) => n + (c.articles ?? []).filter((a) => a.versions?.[0] && !a.versions[0].effectiveDate).length,
        0,
      ),
    [chapters],
  );
  const [form, setForm] = useState<{ effectiveDate: string; reason: string } | null>(null);
  const mutation = useMutation({
    mutationFn: (f: { effectiveDate: string; reason: string }) =>
      versionsApi.fillEffectiveDate(policyId, { effectiveDate: f.effectiveDate, reason: f.reason.trim() }),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['policy', policyId] });
      setForm(null);
      toast(`조문 ${res.updated}건에 시행일을 넣었습니다.`, 'success');
    },
  });

  if (missing === 0) return null;
  const err = (mutation.error as any)?.response?.data;
  const conflicts: Conflict[] = Array.isArray(err?.conflicts) ? err.conflicts : [];

  return (
    <>
      <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2.5 text-xs text-amber-900 flex flex-col sm:flex-row sm:items-center gap-2">
        <p className="flex-1 leading-relaxed">
          <strong>시행일이 기록되지 않은 조문 {missing}건</strong> — 시행 중이지만 시행일이 없어 시점 조회와 법령 개정
          분석에서 기준 본문으로 쓰이지 않습니다. 예전 가져오기로 들어온 규정입니다.
          {!isAdmin && ' 관리자가 시행일을 넣으면 해결됩니다.'}
        </p>
        {isAdmin && (
          <button
            type="button"
            onClick={() => {
              mutation.reset();
              setForm({ effectiveDate: '', reason: '' });
            }}
            className="shrink-0 rounded bg-amber-600 px-3 py-1.5 font-medium text-white hover:bg-amber-700"
          >
            시행일 넣기
          </button>
        )}
      </div>

      {form && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white border border-gray-300 shadow-xl w-full max-w-md" role="dialog" aria-labelledby="fill-effective-title">
            <div id="fill-effective-title" className="bg-navy-800 text-white px-5 py-3 font-medium text-sm">
              시행일 넣기
            </div>
            <div className="p-5 space-y-4">
              <p className="text-xs text-gray-600 leading-relaxed">
                시행일이 비어 있는 조문 <strong>{missing}건</strong>에 같은 시행일을 넣습니다. <b>최초 제정일이 아니라
                지금 이 본문이 실제로 시행된 날</b>을 넣으세요 — 제정일을 넣으면 그 뒤 개정 전 기간에도 지금 본문이 있던
                것처럼 조회됩니다.
              </p>
              <label className="block text-xs font-medium text-gray-600">
                시행일
                <input
                  type="date"
                  className="input mt-1.5"
                  value={form.effectiveDate}
                  onChange={(e) => setForm({ ...form, effectiveDate: e.target.value })}
                />
              </label>
              <label className="block text-xs font-medium text-gray-600">
                근거
                <input
                  className="input mt-1.5"
                  value={form.reason}
                  onChange={(e) => setForm({ ...form, reason: e.target.value })}
                  placeholder="예) 이사회 의결록 — 2024-03-01 시행"
                />
                <span className="block mt-1 text-[11px] font-normal text-gray-500">감사 로그에 함께 남습니다.</span>
              </label>
              {mutation.isError && (
                <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded px-2 py-1.5 space-y-1">
                  <p>{err?.message ?? '시행일을 넣지 못했습니다. 잠시 후 다시 시도하세요.'}</p>
                  {conflicts.length > 0 && (
                    <ul className="list-disc pl-4">
                      {conflicts.slice(0, 10).map((c, i) => (
                        <li key={i}>
                          {c.label} — {c.detail}
                        </li>
                      ))}
                      {conflicts.length > 10 && <li>외 {conflicts.length - 10}건</li>}
                    </ul>
                  )}
                </div>
              )}
              <div className="flex gap-2">
                <button
                  type="button"
                  className="btn-primary"
                  disabled={!/^\d{4}-\d{2}-\d{2}$/.test(form.effectiveDate) || !form.reason.trim() || mutation.isPending}
                  onClick={() => mutation.mutate(form)}
                >
                  {mutation.isPending ? '넣는 중…' : `${missing}건에 넣기`}
                </button>
                <button type="button" className="btn-secondary" onClick={() => setForm(null)}>
                  취소
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
