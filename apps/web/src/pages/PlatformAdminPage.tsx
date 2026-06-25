import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { platformAdminApi } from '../api/platformAdmin';
import { usePlatformBranding } from '../hooks/usePlatformBranding';

export default function PlatformAdminPage() {
  const qc = useQueryClient();
  const [q, setQ] = useState('');
  const [selectedTenantId, setSelectedTenantId] = useState('');
  const [planForm, setPlanForm] = useState({ plan: 'starter', billingStatus: 'active', planExpiresAt: '' });
  const [msg, setMsg] = useState('');
  const { data: branding, isLoading: brandingLoading } = usePlatformBranding();
  const [bf, setBf] = useState({
    legalName: '',
    registrationNo: '',
    productLabel: '',
    lockupImageSrc: '',
  });
  const [logoFilePreview, setLogoFilePreview] = useState<string | null>(null);
  const [clearLogo, setClearLogo] = useState(false);
  const [brandingMsg, setBrandingMsg] = useState('');
  const [brandingErr, setBrandingErr] = useState('');

  useEffect(() => {
    if (!branding) return;
    setBf({
      legalName: branding.legalName ?? '',
      registrationNo: branding.registrationNo ?? '',
      productLabel: branding.productLabel ?? '',
      lockupImageSrc: branding.lockupImageSrc ?? '',
    });
    setLogoFilePreview(null);
    setClearLogo(false);
  }, [branding]);

  const { data: tenants = [], isLoading } = useQuery({
    queryKey: ['platform-admin-tenants', q],
    queryFn: () => platformAdminApi.listTenants(q.trim()),
  });

  const selectedTenant = useMemo(
    () => tenants.find((row: any) => row.id === selectedTenantId) || null,
    [tenants, selectedTenantId],
  );

  const { data: users = [] } = useQuery({
    queryKey: ['platform-admin-tenant-users', selectedTenantId],
    queryFn: () => platformAdminApi.listTenantUsers(selectedTenantId),
    enabled: !!selectedTenantId,
  });

  const updatePlanMutation = useMutation({
    mutationFn: () =>
      platformAdminApi.updateTenantPlan(selectedTenantId, {
        plan: planForm.plan,
        billingStatus: planForm.billingStatus,
        planExpiresAt: planForm.planExpiresAt || undefined,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['platform-admin-tenants'] });
      setMsg('테넌트 플랜 정보를 저장했습니다.');
    },
  });

  const updateUserRoleMutation = useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: string }) =>
      platformAdminApi.updateTenantUserRole(selectedTenantId, userId, { role }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['platform-admin-tenant-users', selectedTenantId] }),
  });

  const updatePlatformRoleMutation = useMutation({
    mutationFn: ({ userId, platformRole }: { userId: string; platformRole: string }) =>
      platformAdminApi.updatePlatformRole(userId, { platformRole }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['platform-admin-tenant-users', selectedTenantId] }),
  });

  const updateBrandingMutation = useMutation({
    mutationFn: () =>
      platformAdminApi.updateBranding({
        legalName: bf.legalName,
        registrationNo: bf.registrationNo.trim() ? bf.registrationNo.trim() : null,
        productLabel: bf.productLabel.trim() || undefined,
        lockupImageSrc: bf.lockupImageSrc.trim() || undefined,
        logoDataUrl: clearLogo ? null : logoFilePreview != null ? logoFilePreview : undefined,
      }),
    onSuccess: async () => {
      setBrandingErr('');
      setBrandingMsg('서비스 브랜딩을 저장했습니다.');
      setLogoFilePreview(null);
      setClearLogo(false);
      await qc.invalidateQueries({ queryKey: ['platform-branding'] });
    },
    onError: (e: any) => {
      const m = e?.response?.data?.message;
      setBrandingErr(typeof m === 'string' ? m : '저장에 실패했습니다.');
    },
  });

  const summary = useMemo(() => {
    const now = Date.now();
    const dayMs = 24 * 60 * 60 * 1000;
    const tenantCount = tenants.length;
    const userCount = tenants.reduce((acc: number, row: any) => acc + (row._count?.users || 0), 0);
    const policyCount = tenants.reduce((acc: number, row: any) => acc + (row._count?.policies || 0), 0);
    const pastDueCount = tenants.filter((row: any) => row.billingStatus === 'past_due').length;
    const expiredCount = tenants.filter((row: any) => {
      if (!row.planExpiresAt) return false;
      return new Date(row.planExpiresAt).getTime() < now;
    }).length;
    const expiringSoonCount = tenants.filter((row: any) => {
      if (!row.planExpiresAt) return false;
      const end = new Date(row.planExpiresAt).getTime();
      return end >= now && end <= now + 30 * dayMs;
    }).length;
    return { tenantCount, userCount, policyCount, pastDueCount, expiredCount, expiringSoonCount };
  }, [tenants]);

  const licenseRows = useMemo(() => {
    const now = Date.now();
    const rows = tenants
      .map((row: any) => {
        const endTs = row.planExpiresAt ? new Date(row.planExpiresAt).getTime() : null;
        const daysLeft = endTs != null ? Math.ceil((endTs - now) / (24 * 60 * 60 * 1000)) : null;
        return { ...row, daysLeft };
      })
      .filter((row: any) => row.daysLeft != null)
      .sort((a: any, b: any) => (a.daysLeft as number) - (b.daysLeft as number));
    return rows.slice(0, 12);
  }, [tenants]);

  return (
    <div className="space-y-4">
      <div className="page-header">
        <div className="page-header__text">
          <h1 className="page-header__title">통합 관리자 콘솔</h1>
          <p className="page-header__desc">가입 회사/사용자 권한, 플랜, 만료일을 통합 관리합니다.</p>
        </div>
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-6 gap-3">
        <div className="stat-card border-l-navy-600">
          <div className="text-xs text-gray-500">전체 테넌트</div>
          <div className="text-xl font-bold text-gray-800">{summary.tenantCount}</div>
        </div>
        <div className="stat-card border-l-gray-300">
          <div className="text-xs text-gray-500">전체 사용자</div>
          <div className="text-xl font-bold text-gray-800">{summary.userCount}</div>
        </div>
        <div className="stat-card border-l-gray-300">
          <div className="text-xs text-gray-500">전체 규정</div>
          <div className="text-xl font-bold text-gray-800">{summary.policyCount}</div>
        </div>
        <div className="stat-card border-l-gray-300">
          <div className="text-xs text-gray-500">미납(past_due)</div>
          <div className="text-xl font-bold text-red-700">{summary.pastDueCount}</div>
        </div>
        <div className="stat-card border-l-gray-300">
          <div className="text-xs text-gray-500">라이선스 만료</div>
          <div className="text-xl font-bold text-red-700">{summary.expiredCount}</div>
        </div>
        <div className="stat-card border-l-gray-300">
          <div className="text-xs text-gray-500">30일 내 만료</div>
          <div className="text-xl font-bold text-amber-700">{summary.expiringSoonCount}</div>
        </div>
      </div>

      <div className="bg-white border border-gray-300 shadow-sm p-3 space-y-3">
        <div>
          <div className="text-xs font-semibold text-gray-700">서비스 브랜딩 (푸터·헤더)</div>
          <p className="text-[11px] text-gray-500 mt-0.5">
            고객사가 아니라 본 서비스를 제공하는 운영사 법인명·사업자번호·로고입니다. 전역 공개 API로 반영됩니다.
          </p>
        </div>
        {brandingLoading && !branding ? (
          <p className="text-xs text-gray-500">불러오는 중...</p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
            <label className="space-y-1">
              <span className="text-gray-600">법인명</span>
              <input
                className="input text-sm w-full"
                value={bf.legalName}
                onChange={(e) => setBf((b) => ({ ...b, legalName: e.target.value }))}
                placeholder="예: 주식회사 ○○"
              />
            </label>
            <label className="space-y-1">
              <span className="text-gray-600">사업자등록번호</span>
              <input
                className="input text-sm w-full"
                value={bf.registrationNo}
                onChange={(e) => setBf((b) => ({ ...b, registrationNo: e.target.value }))}
                placeholder="000-00-00000"
              />
            </label>
            <label className="space-y-1 md:col-span-2">
              <span className="text-gray-600">서비스·제품명 (법인명이 비어 있을 때 표시)</span>
              <input
                className="input text-sm w-full"
                value={bf.productLabel}
                onChange={(e) => setBf((b) => ({ ...b, productLabel: e.target.value }))}
              />
            </label>
            <label className="space-y-1 md:col-span-2">
              <span className="text-gray-600">락업 이미지 경로 (웹 public 기준, 예: /branding/lockup.png)</span>
              <input
                className="input text-sm w-full font-mono"
                value={bf.lockupImageSrc}
                onChange={(e) => setBf((b) => ({ ...b, lockupImageSrc: e.target.value }))}
              />
            </label>
            <div className="md:col-span-2 space-y-1">
              <span className="text-gray-600 block">로고 이미지 (PNG/JPG, 업로드 시 data URL 저장)</span>
              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/svg+xml"
                  className="text-[11px]"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (!f) return;
                    setClearLogo(false);
                    const r = new FileReader();
                    r.onload = () => {
                      const url = typeof r.result === 'string' ? r.result : null;
                      setLogoFilePreview(url);
                    };
                    r.readAsDataURL(f);
                    e.target.value = '';
                  }}
                />
                <button
                  type="button"
                  className="px-2 py-1 border border-gray-300 rounded text-[11px] hover:bg-gray-50"
                  onClick={() => {
                    setClearLogo(true);
                    setLogoFilePreview(null);
                  }}
                >
                  로고 제거
                </button>
              </div>
              <div className="flex items-center gap-3 mt-2">
                {(logoFilePreview || (!clearLogo && branding?.logoUrl)) && (
                  <img
                    src={logoFilePreview || branding?.logoUrl || ''}
                    alt=""
                    className="h-10 w-auto max-w-[160px] object-contain border border-gray-200 rounded bg-white p-1"
                  />
                )}
                {clearLogo && <span className="text-amber-700">저장 시 로고가 제거됩니다.</span>}
              </div>
              <p className="text-[10px] text-gray-400 mt-1">용량이 매우 크면 저장이 거절될 수 있습니다. 가급적 200KB 이하를 권장합니다.</p>
            </div>
            <div className="md:col-span-2 flex items-center gap-2">
              <button
                type="button"
                className="btn-primary text-xs py-1.5"
                disabled={updateBrandingMutation.isPending}
                onClick={() => {
                  setBrandingMsg('');
                  setBrandingErr('');
                  updateBrandingMutation.mutate();
                }}
              >
                {updateBrandingMutation.isPending ? '저장 중...' : '브랜딩 저장'}
              </button>
              {brandingMsg ? <span className="text-emerald-700">{brandingMsg}</span> : null}
              {brandingErr ? <span className="text-red-700">{brandingErr}</span> : null}
            </div>
          </div>
        )}
      </div>

      <div className="bg-white border border-gray-300 shadow-sm p-3">
        <div className="text-xs font-semibold text-gray-700 mb-2">라이선스 만료 예정(가까운 순)</div>
        {licenseRows.length === 0 ? (
          <p className="text-xs text-gray-500">만료일이 설정된 테넌트가 없습니다.</p>
        ) : (
          <div className="space-y-1.5 max-h-44 overflow-auto">
            {licenseRows.map((row: any) => (
              <div key={row.id} className="text-xs border border-gray-200 rounded px-2 py-1.5 flex items-center justify-between gap-2">
                <div>
                  <div className="font-semibold text-gray-800">{row.name}</div>
                  <div className="text-gray-500">{row.slug} · {row.plan} · {String(row.planExpiresAt).slice(0, 10)}</div>
                </div>
                <span className={`px-2 py-0.5 rounded border ${
                  row.daysLeft < 0
                    ? 'bg-red-50 text-red-700 border-red-200'
                    : row.daysLeft <= 30
                    ? 'bg-amber-50 text-amber-700 border-amber-200'
                    : 'bg-gray-50 text-gray-700 border-gray-200'
                }`}>
                  {row.daysLeft < 0 ? `${Math.abs(row.daysLeft)}일 경과` : `${row.daysLeft}일 남음`}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        <section className="lg:col-span-4 bg-white border border-gray-300 shadow-sm p-3 space-y-2">
          <input
            className="input text-sm"
            placeholder="회사명/slug 검색"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <div className="max-h-[62vh] overflow-auto space-y-1">
            {isLoading && <p className="text-xs text-gray-500">불러오는 중...</p>}
            {tenants.map((tenant: any) => (
              <button
                key={tenant.id}
                type="button"
                onClick={() => {
                  setSelectedTenantId(tenant.id);
                  setPlanForm({
                    plan: tenant.plan || 'starter',
                    billingStatus: tenant.billingStatus || 'active',
                    planExpiresAt: tenant.planExpiresAt ? String(tenant.planExpiresAt).slice(0, 10) : '',
                  });
                }}
                className={`w-full text-left border rounded px-2 py-2 text-xs ${
                  selectedTenantId === tenant.id ? 'border-navy-500 bg-navy-50' : 'border-gray-200 hover:bg-gray-50'
                }`}
              >
                <div className="font-semibold text-gray-800">{tenant.name}</div>
                <div className="text-gray-500 mt-0.5">
                  {tenant.slug} · {tenant.plan} · users {tenant._count?.users || 0} · policies {tenant._count?.policies || 0}
                </div>
              </button>
            ))}
          </div>
        </section>

        <section className="lg:col-span-8 space-y-3">
          <div className="bg-white border border-gray-300 shadow-sm p-3 space-y-3">
            <div className="text-xs font-semibold text-gray-700">테넌트 플랜/만료 관리</div>
            {!selectedTenant && <p className="text-xs text-gray-500">왼쪽에서 테넌트를 선택하세요.</p>}
            {selectedTenant && (
              <>
                <div className="text-[11px] text-gray-500">
                  선택된 테넌트: <span className="font-semibold text-gray-700">{selectedTenant.name}</span> ({selectedTenant.slug})
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  <select className="input text-sm" value={planForm.plan} onChange={(e) => setPlanForm((p) => ({ ...p, plan: e.target.value }))}>
                    <option value="starter">starter</option>
                    <option value="pro">pro</option>
                    <option value="enterprise">enterprise</option>
                  </select>
                  <select className="input text-sm" value={planForm.billingStatus} onChange={(e) => setPlanForm((p) => ({ ...p, billingStatus: e.target.value }))}>
                    <option value="active">active</option>
                    <option value="trial">trial</option>
                    <option value="past_due">past_due</option>
                    <option value="canceled">canceled</option>
                  </select>
                  <input type="date" className="input text-sm" value={planForm.planExpiresAt} onChange={(e) => setPlanForm((p) => ({ ...p, planExpiresAt: e.target.value }))} />
                </div>
                <button type="button" className="btn-primary text-xs py-1.5" onClick={() => updatePlanMutation.mutate()} disabled={updatePlanMutation.isPending}>
                  {updatePlanMutation.isPending ? '저장 중...' : '플랜 저장'}
                </button>
                {msg && <p className="text-xs text-emerald-700">{msg}</p>}
              </>
            )}
          </div>

          <div className="bg-white border border-gray-300 shadow-sm p-3">
            <div className="text-xs font-semibold text-gray-700 mb-2">가입 계정 권한 관리</div>
            {!selectedTenant ? (
              <p className="text-xs text-gray-500">테넌트를 선택하면 계정 목록이 표시됩니다.</p>
            ) : (
              <div className="space-y-2">
                {users.map((u: any) => (
                  <div key={u.id} className="border border-gray-200 rounded p-2 text-xs flex flex-wrap items-center gap-2">
                    <div className="min-w-[180px]">
                      <div className="font-semibold text-gray-800">{u.name}</div>
                      <div className="text-gray-500">{u.email}</div>
                    </div>
                    <select
                      className="input text-xs w-32"
                      value={u.role}
                      onChange={(e) => updateUserRoleMutation.mutate({ userId: u.id, role: e.target.value })}
                      disabled={updateUserRoleMutation.isPending}
                    >
                      <option value="admin">admin</option>
                      <option value="editor">editor</option>
                      <option value="viewer">viewer</option>
                    </select>
                    <select
                      className="input text-xs w-36"
                      value={u.platformRole || 'none'}
                      onChange={(e) => updatePlatformRoleMutation.mutate({ userId: u.id, platformRole: e.target.value })}
                      disabled={updatePlatformRoleMutation.isPending}
                    >
                      <option value="none">platform:none</option>
                      <option value="global_admin">platform:global_admin</option>
                    </select>
                  </div>
                ))}
                {users.length === 0 && <p className="text-xs text-gray-500">등록된 계정이 없습니다.</p>}
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

