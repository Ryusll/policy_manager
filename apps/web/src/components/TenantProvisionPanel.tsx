import { useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Building2, Copy } from 'lucide-react';
import { platformAdminApi, type CreateTenantPayload, type CreateTenantResult } from '../api/platformAdmin';
import { apiErrorMessage } from '../lib/apiError';
import { toast } from '../stores/toastStore';

const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,39}$/;
const EMPTY: CreateTenantPayload = { name: '', slug: '', plan: 'starter', masterEmail: '', masterName: '' };

/**
 * 통합 관리자 콘솔 — 고객사 개설 + 마스터 계정 발급 (T-122).
 * 고객사는 아스트룸이 계약 후 여기서 연다(공개 회원가입은 운영에서 닫혀 있다).
 * 임시 비밀번호는 이 화면에 한 번만 나오고, 마스터는 처음 로그인할 때 바꿔야 한다.
 */
export default function TenantProvisionPanel() {
  const qc = useQueryClient();
  const [form, setForm] = useState<CreateTenantPayload>(EMPTY);
  const [result, setResult] = useState<CreateTenantResult | null>(null);
  const [error, setError] = useState('');

  const slug = form.slug.trim().toLowerCase();
  const slugOk = SLUG_RE.test(slug);
  const ready = form.name.trim() && slugOk && form.masterEmail.trim() && form.masterName.trim();

  const mutation = useMutation({
    mutationFn: () =>
      platformAdminApi.createTenant({
        name: form.name.trim(),
        slug,
        plan: form.plan,
        masterEmail: form.masterEmail.trim(),
        masterName: form.masterName.trim(),
      }),
    onSuccess: (data) => {
      setResult(data);
      setForm(EMPTY);
      setError('');
      void qc.invalidateQueries({ queryKey: ['platform-admin-tenants'] });
    },
    onError: (err) => setError(apiErrorMessage(err, '고객사를 개설하지 못했습니다.')),
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (ready && !mutation.isPending) mutation.mutate();
  };

  const loginUrl = `${window.location.origin}/login`;
  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast('복사했습니다.', 'success');
    } catch {
      toast('복사하지 못했습니다. 직접 선택해 복사하세요.', 'error');
    }
  };

  return (
    <div className="bg-white border border-gray-300 shadow-sm p-3 space-y-3">
      <div>
        <div className="text-xs font-semibold text-gray-700 flex items-center gap-1.5">
          <Building2 size={13} /> 고객사 개설
        </div>
        <p className="text-[11px] text-gray-500 mt-0.5">
          계약한 고객사의 조직과 <b>마스터(첫 관리자)</b> 계정을 만듭니다. 임시 비밀번호는 한 번만 보여 주며, 마스터는
          처음 로그인할 때 바꿔야 합니다. 직원 계정은 마스터가 <b>설정 › 팀원 초대</b>에서 발급합니다.
        </p>
      </div>

      {result && (
        <div role="status" className="rounded border border-green-200 bg-green-50 p-3 space-y-2 text-xs">
          <div className="font-semibold text-green-900">개설 완료 — {result.tenant.name}</div>
          <dl className="grid grid-cols-[6.5rem_1fr] gap-x-2 gap-y-1 text-gray-800">
            <dt className="text-gray-500">로그인 주소</dt>
            <dd className="break-all">{loginUrl}</dd>
            <dt className="text-gray-500">기관 코드</dt>
            <dd className="font-mono">{result.tenant.slug}</dd>
            <dt className="text-gray-500">마스터</dt>
            <dd>
              {result.master.name} · {result.master.email}
            </dd>
            <dt className="text-gray-500">임시 비밀번호</dt>
            <dd className="flex items-center gap-2">
              <code data-testid="temporary-password" className="font-mono text-sm bg-white border border-green-200 rounded px-1.5 py-0.5 select-all">
                {result.temporaryPassword}
              </code>
              <button
                type="button"
                className="inline-flex items-center gap-1 text-[11px] px-1.5 py-0.5 border border-gray-300 rounded bg-white hover:bg-gray-50"
                onClick={() =>
                  copy(
                    `로그인 주소: ${loginUrl}\n기관 코드: ${result.tenant.slug}\n아이디(이메일): ${result.master.email}\n임시 비밀번호: ${result.temporaryPassword}\n(처음 로그인할 때 비밀번호를 바꿔야 합니다)`,
                  )
                }
              >
                <Copy size={11} /> 전달용 내용 복사
              </button>
            </dd>
          </dl>
          <p className="text-amber-800">
            ⚠ 이 화면을 벗어나면 임시 비밀번호를 다시 볼 수 없습니다. 마스터에게 안전한 경로로 전달하세요. 잃어버렸다면
            그 회사 사용자 목록에서 비밀번호를 재설정합니다.
          </p>
          <button type="button" className="text-[11px] text-gray-500 underline" onClick={() => setResult(null)}>
            닫기
          </button>
        </div>
      )}

      <form onSubmit={submit} className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5 items-end text-xs">
        <label className="space-y-1">
          <span className="text-gray-600">회사명</span>
          <input className="input text-sm" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </label>
        <label className="space-y-1">
          <span className="text-gray-600">기관 코드</span>
          <input
            className="input text-sm font-mono"
            placeholder="acme"
            value={form.slug}
            onChange={(e) => setForm({ ...form, slug: e.target.value })}
            aria-invalid={form.slug.length > 0 && !slugOk}
          />
        </label>
        <label className="space-y-1">
          <span className="text-gray-600">플랜</span>
          <select
            className="input text-sm"
            value={form.plan}
            onChange={(e) => setForm({ ...form, plan: e.target.value as CreateTenantPayload['plan'] })}
          >
            <option value="starter">starter</option>
            <option value="pro">pro</option>
            <option value="enterprise">enterprise</option>
          </select>
        </label>
        <label className="space-y-1">
          <span className="text-gray-600">마스터 이메일</span>
          <input
            type="email"
            className="input text-sm"
            value={form.masterEmail}
            onChange={(e) => setForm({ ...form, masterEmail: e.target.value })}
          />
        </label>
        <label className="space-y-1">
          <span className="text-gray-600">마스터 이름</span>
          <input
            className="input text-sm"
            value={form.masterName}
            onChange={(e) => setForm({ ...form, masterName: e.target.value })}
          />
        </label>
        <div className="sm:col-span-2 lg:col-span-5 flex items-center gap-3">
          <button type="submit" className="btn-primary text-xs py-1.5" disabled={!ready || mutation.isPending}>
            {mutation.isPending ? '개설 중…' : '고객사 개설'}
          </button>
          {form.slug.length > 0 && !slugOk && (
            <span className="text-[11px] text-red-700">기관 코드는 영문 소문자·숫자·하이픈 2~40자이고 하이픈으로 시작할 수 없습니다.</span>
          )}
          {error && (
            <span role="alert" className="text-[11px] text-red-700">
              {error}
            </span>
          )}
        </div>
      </form>
    </div>
  );
}
