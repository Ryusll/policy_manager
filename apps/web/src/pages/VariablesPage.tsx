import { Fragment, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { variablesApi, VARIABLE_PICK_REASON_LABEL, type VariableRow } from '../api/policies';
import { Plus, Trash2, Edit, X, Check, ChevronDown, ChevronRight } from 'lucide-react';
import { useI18n } from '../i18n/useI18n';
import { useAuthStore } from '../stores/authStore';
import VariableValuesPanel from '../components/VariableValuesPanel';

/**
 * 변수 관리 — 여러 조문에 함께 쓰는 가변 항목(담당 부서·직위·기준값 등)과 그 값의 유효기간 (T-109, 특허 도 9).
 * 행을 펼치면 값별 유효기간과 이 변수가 걸린 조문(지금 시행 중인 본문의 위치)이 보인다.
 */
export default function VariablesPage() {
  const { t } = useI18n();
  const qc = useQueryClient();
  const role = useAuthStore((s) => s.user?.role);
  const canEdit = role === 'admin' || role === 'editor';
  const [showCreate, setShowCreate] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const emptyForm = { key: '', label: '', description: '', value: '', validFrom: '' };
  const [form, setForm] = useState(emptyForm);
  const [editForm, setEditForm] = useState({ label: '', description: '' });

  const { data: variables = [], isLoading } = useQuery({
    queryKey: ['variables'],
    queryFn: variablesApi.list,
  });

  const createMutation = useMutation({
    mutationFn: () =>
      variablesApi.create({
        key: form.key,
        label: form.label,
        description: form.description || undefined,
        value: form.value.trim() || undefined,
        validFrom: form.value.trim() && form.validFrom ? form.validFrom : undefined,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['variables'] });
      setShowCreate(false);
      setForm(emptyForm);
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: { label: string; description: string } }) => variablesApi.update(id, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['variables'] });
      setEditingId(null);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: variablesApi.delete,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['variables'] }),
  });

  const startEdit = (variable: VariableRow) => {
    setEditingId(variable.id);
    setEditForm({ label: variable.label, description: variable.description || '' });
  };

  return (
    <div className="space-y-4">
      {/* 페이지 헤더 */}
      <div className="bg-white border border-gray-300 px-5 py-3 flex items-center justify-between shadow-sm">
        <div>
          <h1 className="text-base font-bold text-gray-800">{t('variables.title')}</h1>
          <p className="text-xs text-gray-500 mt-0.5">{t('variables.subtitle')}</p>
        </div>
        {canEdit && (
          <button type="button" onClick={() => setShowCreate(true)} className="btn-primary text-sm py-1.5">
            <Plus size={15} /> {t('variables.add')}
          </button>
        )}
      </div>

      {/* 등록 폼 */}
      {showCreate && (
        <div className="bg-white border border-gray-300 shadow-sm">
          <div className="bg-navy-800 text-white px-5 py-2.5 text-sm font-medium">{t('variables.createTitle')}</div>
          <div className="p-5">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1.5" htmlFor="var-key">
                  {t('variables.key')} <span className="text-red-500">*</span>
                </label>
                <input
                  id="var-key"
                  className="input font-mono"
                  placeholder={t('variables.placeholderKey')}
                  value={form.key}
                  onChange={(e) => setForm({ ...form, key: e.target.value.toUpperCase().replace(/\s/g, '_') })}
                />
                <p className="text-xs text-gray-400 mt-1">
                  {t('variables.hintKey', { COMPANY_NAME: '{{COMPANY_NAME}}' })}
                </p>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1.5" htmlFor="var-label">
                  {t('variables.label')} <span className="text-red-500">*</span>
                </label>
                <input
                  id="var-label"
                  className="input"
                  placeholder={t('variables.placeholderLabel')}
                  value={form.label}
                  onChange={(e) => setForm({ ...form, label: e.target.value })}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1.5" htmlFor="var-first-value">
                  {t('variables.firstValue')}
                </label>
                <input
                  id="var-first-value"
                  className="input"
                  placeholder={t('variables.placeholderFirstValue')}
                  value={form.value}
                  onChange={(e) => setForm({ ...form, value: e.target.value })}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1.5" htmlFor="var-first-from">
                  {t('variables.validFrom')}
                </label>
                <input
                  id="var-first-from"
                  type="date"
                  className="input"
                  value={form.validFrom}
                  disabled={!form.value.trim()}
                  onChange={(e) => setForm({ ...form, validFrom: e.target.value })}
                />
                <p className="text-xs text-gray-400 mt-1">{t('variables.hintValidFrom')}</p>
              </div>
              <div className="md:col-span-2">
                <label className="block text-xs font-medium text-gray-700 mb-1.5" htmlFor="var-desc">
                  {t('variables.description')}
                </label>
                <input
                  id="var-desc"
                  className="input"
                  placeholder={t('variables.placeholderDesc')}
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                />
              </div>
            </div>
            {createMutation.error && (
              <div className="mt-3 text-sm text-red-600 bg-red-50 border border-red-200 p-2 rounded">
                {(createMutation.error as any)?.response?.data?.message || t('variables.error')}
              </div>
            )}
            <div className="flex gap-2 mt-4">
              <button
                type="button"
                onClick={() => createMutation.mutate()}
                disabled={!form.key || !form.label || createMutation.isPending}
                className="btn-primary"
              >
                {createMutation.isPending ? t('variables.submitting') : t('variables.submit')}
              </button>
              <button type="button" onClick={() => setShowCreate(false)} className="btn-secondary">
                {t('variables.cancel')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 변수 목록 */}
      <div className="bg-white border border-gray-300 shadow-sm overflow-x-auto">
        <table className="w-full gov-table">
          <thead>
            <tr>
              <th className="w-12 text-center whitespace-nowrap">{t('variables.colNo')}</th>
              <th className="w-44">{t('variables.colKey')}</th>
              <th>{t('variables.colLabel')}</th>
              <th className="hidden md:table-cell">{t('variables.colCurrent')}</th>
              <th className="hidden lg:table-cell w-20 text-center whitespace-nowrap">{t('variables.colBindings')}</th>
              <th className="w-28 text-center whitespace-nowrap">{t('variables.colActions')}</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr><td colSpan={6} className="py-10 text-center text-gray-400 text-sm">{t('variables.loading')}</td></tr>
            )}
            {!isLoading && variables.length === 0 && (
              <tr>
                <td colSpan={6} className="py-10 text-center text-gray-500 text-sm">
                  {t('variables.empty')}
                </td>
              </tr>
            )}
            {variables.map((variable, idx) => (
              <Fragment key={variable.id}>
                <tr data-testid={`variable-row-${variable.key}`}>
                  <td className="text-center text-xs text-gray-400">{idx + 1}</td>
                  <td>
                    <span className="font-mono text-xs bg-gray-100 border border-gray-200 text-gray-700 px-2 py-1 rounded">
                      {'{{'}{variable.key}{'}}'}
                    </span>
                  </td>
                  <td>
                    {editingId === variable.id ? (
                      <div className="space-y-1">
                        <input className="input py-1 text-sm" aria-label={t('variables.label')} value={editForm.label}
                          onChange={(e) => setEditForm({ ...editForm, label: e.target.value })} />
                        <input className="input py-1 text-xs" aria-label={t('variables.description')} value={editForm.description}
                          placeholder={t('variables.placeholderDesc')}
                          onChange={(e) => setEditForm({ ...editForm, description: e.target.value })} />
                      </div>
                    ) : (
                      <div>
                        <span className="font-medium text-gray-800 text-sm">{variable.label}</span>
                        {variable.needsReview && (
                          <span className="ml-2 text-[11px] px-1.5 py-0.5 rounded bg-amber-50 border border-amber-300 text-amber-800">
                            {t('variables.needsReview')}
                          </span>
                        )}
                        {variable.description && <p className="text-xs text-gray-500 mt-0.5">{variable.description}</p>}
                      </div>
                    )}
                  </td>
                  <td className="hidden md:table-cell text-sm">
                    {variable.current ? (
                      <span className="text-gray-800">{variable.current.value}</span>
                    ) : (
                      <span className="text-xs text-amber-700">
                        {variable.currentReason ? VARIABLE_PICK_REASON_LABEL[variable.currentReason] : '—'}
                      </span>
                    )}
                  </td>
                  <td className="hidden lg:table-cell text-center text-sm text-gray-500">{variable.bindingCount ?? 0}</td>
                  <td>
                    <div className="flex items-center gap-1 justify-center">
                      {editingId === variable.id ? (
                        <>
                          <button
                            onClick={() => updateMutation.mutate({ id: variable.id, data: editForm })}
                            className="p-1.5 text-green-600 hover:bg-green-50 rounded"
                            title={t('variables.save')}
                          >
                            <Check size={14} />
                          </button>
                          <button onClick={() => setEditingId(null)} className="p-1.5 text-gray-400 hover:bg-gray-100 rounded" title={t('variables.cancel')}>
                            <X size={14} />
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            type="button"
                            onClick={() => setOpenId(openId === variable.id ? null : variable.id)}
                            className="p-1.5 text-gray-500 hover:text-navy-700 hover:bg-navy-50 rounded"
                            title={t('variables.valuesAndLinks')}
                            aria-label={`${variable.label} ${t('variables.valuesAndLinks')}`}
                            aria-expanded={openId === variable.id}
                          >
                            {openId === variable.id ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                          </button>
                          {canEdit && (
                            <button onClick={() => startEdit(variable)} className="p-1.5 text-gray-400 hover:text-navy-700 hover:bg-navy-50 rounded" title={t('variables.edit')}>
                              <Edit size={14} />
                            </button>
                          )}
                          {role === 'admin' && (
                            <button
                              onClick={() => {
                                if (confirm(t('variables.deleteConfirm'))) deleteMutation.mutate(variable.id);
                              }}
                              className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded"
                              title={t('variables.delete')}
                            >
                              <Trash2 size={14} />
                            </button>
                          )}
                        </>
                      )}
                    </div>
                  </td>
                </tr>
                {openId === variable.id && (
                  <tr>
                    <td colSpan={6} className="bg-gray-50/70 p-0">
                      <VariableValuesPanel variableId={variable.id} canEdit={canEdit} />
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>

      {/* 사용 안내 */}
      <div className="bg-navy-50 border border-navy-200 rounded p-4 text-sm space-y-1.5">
        <div className="font-semibold text-navy-800">{t('variables.helpTitle')}</div>
        <p className="text-navy-700 text-xs leading-relaxed">
          {t('variables.helpBody')}{' '}
          <code className="bg-navy-100 px-1.5 py-0.5 rounded font-mono text-navy-800">{'{{COMPANY_NAME}}'}</code>
        </p>
        <p className="text-navy-700 text-xs leading-relaxed">{t('variables.helpPeriod')}</p>
      </div>
    </div>
  );
}
