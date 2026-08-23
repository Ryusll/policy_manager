import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { X, Check, Zap, Building2, Rocket } from 'lucide-react';
import { useAuthStore } from '../stores/authStore';
import { useI18n } from '../i18n/useI18n';
import { billingApi } from '../api/billing';

interface Props {
  onClose: () => void;
}

export default function PlanModal({ onClose }: Props) {
  const { t, locale } = useI18n();
  const { user, updateUserPlan } = useAuthStore();
  const currentPlan = user?.plan || 'starter';
  const [loadingPlan, setLoadingPlan] = useState<string | null>(null);
  const [pendingPlan, setPendingPlan] = useState<'pro' | 'enterprise' | null>(null);
  const isAdmin = user?.role === 'admin';

  /**
   * 결제·구독 이력 (T-17). 기록을 남기기 시작했으니 볼 수 있어야 한다 —
   * 보이지 않으면 남기는 의미가 없다. 관리자만 조회할 수 있는 API 다.
   */
  const { data: history } = useQuery({
    queryKey: ['billing-history'],
    queryFn: billingApi.history,
    enabled: isAdmin,
  });

  const plans = useMemo(
    () => [
      {
        id: 'starter',
        name: t('plan.name.starter'),
        price: t('plan.price.free'),
        priceDetail: t('plan.price.freeDetail'),
        icon: Zap,
        color: 'border-gray-300',
        headerColor: 'bg-gray-100',
        btnColor: 'bg-gray-200 text-gray-600 cursor-default',
        btnLabel: t('plan.btn.current'),
        features: [
          { text: t('plan.f1'), available: true },
          { text: t('plan.f2'), available: true },
          { text: t('plan.f3'), available: true },
          { text: t('plan.f4'), available: true },
          { text: t('plan.f5'), available: true },
          { text: t('plan.ft1'), available: false },
          { text: t('plan.ft2'), available: false },
          { text: t('plan.f8'), available: false },
        ],
      },
      {
        id: 'pro',
        name: t('plan.name.pro'),
        price: t('plan.price.pro'),
        priceDetail: t('plan.price.proDetail'),
        icon: Rocket,
        color: 'border-navy-600',
        headerColor: 'bg-navy-800',
        textColor: 'text-white',
        btnColor: 'bg-navy-800 text-white hover:bg-navy-700',
        btnLabel: t('plan.btn.upgrade'),
        badge: t('plan.badge.popular'),
        features: [
          { text: t('plan.f1u'), available: true },
          { text: t('plan.f2u'), available: true },
          { text: t('plan.f3'), available: true },
          { text: t('plan.f4p'), available: true },
          { text: t('plan.f5'), available: true },
          { text: t('plan.ft1'), available: true },
          { text: t('plan.ft2'), available: false },
          { text: t('plan.f8'), available: false },
        ],
      },
      {
        id: 'enterprise',
        name: t('plan.name.enterprise'),
        price: t('plan.price.contact'),
        priceDetail: t('plan.price.contactDetail'),
        icon: Building2,
        color: 'border-gold-500',
        headerColor: 'bg-navy-900',
        textColor: 'text-white',
        btnColor: 'bg-gold-500 text-white hover:bg-gold-400',
        btnLabel: t('plan.btn.sales'),
        features: [
          { text: t('plan.f1u'), available: true },
          { text: t('plan.f2e'), available: true },
          { text: t('plan.f3'), available: true },
          { text: t('plan.f4e'), available: true },
          { text: t('plan.f5'), available: true },
          { text: t('plan.ft1'), available: true },
          { text: t('plan.ft2'), available: true },
          { text: t('plan.f8'), available: true },
        ],
      },
    ],
    [t, locale],
  );

  const runCheckout = async (planId: 'pro' | 'enterprise') => {
    setLoadingPlan(planId);
    try {
      const res = await billingApi.checkout(planId);
      if (res?.upgraded) {
        updateUserPlan(res.targetPlan);
        alert(t('plan.checkoutSuccess', { plan: res.targetPlan }));
        setPendingPlan(null);
        onClose();
        return;
      }
      if (res?.checkoutUrl) {
        window.location.href = res.checkoutUrl;
        return;
      }
      alert(t('plan.checkoutPending'));
    } catch (e: any) {
      alert(e?.response?.data?.message || t('plan.checkoutFailed'));
    } finally {
      setLoadingPlan(null);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-white w-full max-w-4xl max-h-[90vh] overflow-y-auto border border-gray-300 shadow-2xl">
        <div className="bg-navy-900 text-white px-6 py-4 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold">{t('plan.modalTitle')}</h2>
            <p className="text-navy-300 text-xs mt-0.5">
              {t('plan.current')} <span className="font-semibold text-white capitalize">{currentPlan}</span>
            </p>
          </div>
          <button type="button" onClick={onClose} className="p-1.5 hover:bg-navy-700 rounded transition-colors">
            <X size={18} />
          </button>
        </div>

        <div className="p-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {plans.map((plan) => {
              const Icon = plan.icon;
              const isCurrent = plan.id === currentPlan;
              return (
                <div
                  key={plan.id}
                  className={`border-2 ${plan.color} ${isCurrent ? 'ring-2 ring-navy-400 ring-offset-2' : ''} overflow-hidden`}
                >
                  <div className={`${plan.headerColor} px-4 py-3 relative`}>
                    {plan.badge && (
                      <span className="absolute top-2 right-2 text-xs bg-gold-500 text-white px-2 py-0.5 rounded font-medium">
                        {plan.badge}
                      </span>
                    )}
                    <div className="flex items-center gap-2 mb-2">
                      <Icon size={18} className={plan.textColor || 'text-gray-700'} />
                      <span className={`font-bold text-base ${plan.textColor || 'text-gray-800'}`}>{plan.name}</span>
                    </div>
                    <div className={`text-2xl font-bold ${plan.textColor || 'text-gray-900'}`}>{plan.price}</div>
                    <div className={`text-xs ${plan.textColor ? 'text-gray-300' : 'text-gray-500'} mt-0.5`}>
                      {plan.priceDetail}
                    </div>
                  </div>

                  <div className="p-4">
                    <ul className="space-y-2 mb-4">
                      {plan.features.map((feature, i) => (
                        <li key={i} className="flex items-center gap-2 text-sm">
                          <Check
                            size={14}
                            className={feature.available ? 'text-green-600 flex-shrink-0' : 'text-gray-300 flex-shrink-0'}
                          />
                          <span className={feature.available ? 'text-gray-700' : 'text-gray-400 line-through'}>
                            {feature.text}
                          </span>
                        </li>
                      ))}
                    </ul>

                    <button
                      type="button"
                      onClick={async () => {
                        if (plan.id === 'starter') return;
                        if (plan.id === 'pro') {
                          setPendingPlan('pro');
                          return;
                        }
                        await runCheckout(plan.id as 'pro' | 'enterprise');
                      }}
                      disabled={isCurrent || loadingPlan === plan.id}
                      className={`w-full py-2 text-sm font-medium rounded transition-colors ${plan.btnColor} ${isCurrent ? 'opacity-70' : ''}`}
                    >
                      {loadingPlan === plan.id
                        ? t('plan.checkoutProcessing')
                        : isCurrent
                        ? t('plan.btn.current')
                        : plan.btnLabel}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          {isAdmin && history && (
            <div className="mt-5 border border-gray-200 rounded overflow-hidden">
              <div className="bg-gray-50 border-b border-gray-200 px-3 py-2 text-xs font-medium text-gray-700">
                결제·구독 이력
              </div>
              <div className="p-3 space-y-3 text-xs">
                {history.currentSubscription ? (
                  <p className="text-gray-700">
                    현재 구독:{' '}
                    <span className="font-semibold capitalize">{history.currentSubscription.plan}</span>
                    {history.currentSubscription.currentPeriodEnd && (
                      <>
                        {' '}· 유효기간{' '}
                        {new Date(history.currentSubscription.currentPeriodEnd).toLocaleDateString('ko-KR')}
                        까지
                      </>
                    )}
                  </p>
                ) : (
                  <p className="text-gray-500">아직 결제 기록이 없습니다.</p>
                )}

                {history.payments.length > 0 && (
                  <ul className="divide-y divide-gray-100 max-h-40 overflow-y-auto">
                    {history.payments.map((pay) => (
                      <li key={pay.id} className="flex items-center gap-2 py-1.5">
                        <span className="text-gray-600">
                          {new Date(pay.paidAt ?? pay.createdAt).toLocaleDateString('ko-KR')}
                        </span>
                        <span className="capitalize text-gray-800">{pay.metadata?.targetPlan ?? '-'}</span>
                        <span className="ml-auto tabular-nums text-gray-700">
                          {pay.amount.toLocaleString('ko-KR')}원
                        </span>
                        {/* 요금표를 지어내지 않는다 — mock 결제는 실제로 돈이 오가지 않았다 */}
                        {pay.metadata?.mock && (
                          <span className="text-[10px] text-amber-800 bg-amber-50 border border-amber-200 rounded px-1.5 py-0.5">
                            테스트 결제
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          )}

          <div className="mt-5 bg-gray-50 border border-gray-200 rounded p-3 text-xs text-gray-500">
            <p>{t('plan.footer1')}</p>
            <p>{t('plan.footer2')}</p>
            <p>{t('plan.footer3')}</p>
          </div>
        </div>
      </div>

      {pendingPlan === 'pro' && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60] p-4">
          <div className="bg-white w-full max-w-md border border-gray-300 shadow-2xl">
            <div className="bg-navy-900 text-white px-5 py-3 font-medium text-sm">
              {t('plan.confirmTitle')}
            </div>
            <div className="p-5 space-y-4">
              <p className="text-sm text-gray-700">{t('plan.proConfirmMessage')}</p>
              <div className="bg-navy-50 border border-navy-100 rounded px-3 py-2 text-xs text-gray-600">
                {t('plan.proConfirmPrice')}
              </div>
              <div className="flex items-center justify-end gap-2">
                <button
                  type="button"
                  className="btn-secondary text-sm"
                  onClick={() => setPendingPlan(null)}
                >
                  {t('policies.cancel')}
                </button>
                <button
                  type="button"
                  className="btn-primary text-sm"
                  onClick={() => runCheckout('pro')}
                  disabled={loadingPlan === 'pro'}
                >
                  {loadingPlan === 'pro' ? t('plan.checkoutProcessing') : t('plan.confirmPayButton')}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
