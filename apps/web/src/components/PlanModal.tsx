import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { X, Check, Zap, Building2, Rocket, Info } from 'lucide-react';
import { useAuthStore } from '../stores/authStore';
import { useI18n } from '../i18n/useI18n';
import { billingApi } from '../api/billing';

interface Props {
  onClose: () => void;
}

type PlanId = 'starter' | 'pro' | 'enterprise';

/**
 * 요금제 안내 (T-125).
 *
 * 가격 정책(D-02)이 정해지기 전까지 이 창은 **비교만** 한다. 가격 자리에는 "아스트룸에 문의",
 * 결제 버튼 자리에는 문의 안내를 보이고, 어떤 버튼도 서버를 부르지 않는다. 요금제는 통합
 * 관리에서 플랫폼 관리자만 바꾼다 — 예전에는 여기 버튼이 결제 없이 요금제를 바로 올렸다(mock).
 */
export default function PlanModal({ onClose }: Props) {
  const { t, locale } = useI18n();
  const { user } = useAuthStore();
  const currentPlan = user?.plan || 'starter';
  const isAdmin = user?.role === 'admin';
  const [inquiryPlan, setInquiryPlan] = useState<PlanId | null>(null);

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
        id: 'starter' as const,
        name: t('plan.name.starter'),
        icon: Zap,
        color: 'border-gray-300',
        headerColor: 'bg-gray-100',
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
        id: 'pro' as const,
        name: t('plan.name.pro'),
        icon: Rocket,
        color: 'border-navy-600',
        headerColor: 'bg-navy-800',
        textColor: 'text-white',
        badge: t('plan.badge.popular'),
        features: [
          { text: t('plan.f1u'), available: true },
          { text: t('plan.f2u'), available: true },
          { text: t('plan.f3'), available: true },
          { text: t('plan.f4'), available: true },
          { text: t('plan.f5'), available: true },
          { text: t('plan.ft1'), available: true },
          { text: t('plan.ft2'), available: false },
          { text: t('plan.f8'), available: false },
        ],
      },
      {
        id: 'enterprise' as const,
        name: t('plan.name.enterprise'),
        icon: Building2,
        color: 'border-gold-500',
        headerColor: 'bg-navy-900',
        textColor: 'text-white',
        features: [
          { text: t('plan.f1u'), available: true },
          { text: t('plan.f2e'), available: true },
          { text: t('plan.f3'), available: true },
          { text: t('plan.f4'), available: true },
          { text: t('plan.f5'), available: true },
          { text: t('plan.ft1'), available: true },
          { text: t('plan.ft2'), available: true },
          { text: t('plan.f8'), available: true },
        ],
      },
    ],
    [t, locale],
  );

  const inquiryName = plans.find((p) => p.id === inquiryPlan)?.name;

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
                    {/* 가격 정책(D-02) 확정 전 — 정해지지 않은 금액을 보이지 않는다 */}
                    <div className={`text-lg font-bold ${plan.textColor || 'text-gray-900'}`}>
                      {t('plan.price.inquiry')}
                    </div>
                    <div className={`text-xs ${plan.textColor ? 'text-gray-300' : 'text-gray-500'} mt-0.5`}>
                      {t('plan.price.inquiryDetail')}
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

                    {/* 안내만 보인다 — 서버를 부르지 않으므로 이 버튼으로 요금제가 바뀌는 일은 없다 */}
                    <button
                      type="button"
                      data-testid={`plan-inquiry-${plan.id}`}
                      onClick={() => setInquiryPlan(plan.id)}
                      disabled={isCurrent}
                      className={`w-full py-2 text-sm font-medium rounded transition-colors ${
                        isCurrent
                          ? 'bg-gray-200 text-gray-600 cursor-default opacity-70'
                          : 'border border-navy-600 text-navy-800 bg-white hover:bg-navy-50'
                      }`}
                    >
                      {isCurrent ? t('plan.btn.current') : t('plan.btn.inquiry')}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          {inquiryName && (
            <div
              role="status"
              data-testid="plan-inquiry-notice"
              className="mt-5 flex gap-2 border border-navy-200 bg-navy-50 rounded px-4 py-3"
            >
              <Info size={16} className="text-navy-700 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-medium text-navy-900">
                  {t('plan.inquiry.title', { plan: inquiryName })}
                </p>
                <p className="text-xs text-gray-600 mt-1">{t('plan.inquiry.body')}</p>
              </div>
            </div>
          )}

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
          </div>
        </div>
      </div>
    </div>
  );
}
