import { useQuery } from '@tanstack/react-query';
import { integrationsApi } from '../api/integrations';
import { useAuthStore } from '../stores/authStore';
import { canUseApiIntegration } from '../lib/planFeatures';
import { useI18n } from '../i18n/useI18n';

export default function IntegrationsPage() {
  const { t } = useI18n();
  const { user, accessToken } = useAuthStore();
  const isEnterprise = canUseApiIntegration(user?.plan);

  const { data, isLoading } = useQuery({
    queryKey: ['api-access'],
    queryFn: integrationsApi.getApiAccess,
    enabled: isEnterprise,
  });

  if (!isEnterprise) {
    return (
      <div className="max-w-2xl bg-white border border-gray-300 shadow-sm p-5 space-y-2">
        <h1 className="text-lg font-bold text-gray-800">{t('integrations.title')}</h1>
        <p className="text-sm text-gray-600">{t('integrations.enterpriseOnly')}</p>
      </div>
    );
  }

  const curl = `curl -X GET "${window.location.origin}/api/policies" \\\n+  -H "Authorization: Bearer ${accessToken || '<ACCESS_TOKEN>'}"`;

  return (
    <div className="max-w-3xl space-y-4">
      <div className="bg-white border border-gray-300 shadow-sm p-5 space-y-2">
        <h1 className="text-lg font-bold text-gray-800">{t('integrations.title')}</h1>
        <p className="text-sm text-gray-600">{t('integrations.subtitle')}</p>
      </div>

      <div className="bg-white border border-gray-300 shadow-sm p-5 space-y-3">
        <h2 className="font-semibold text-gray-800">{t('integrations.status')}</h2>
        {isLoading ? (
          <p className="text-sm text-gray-500">{t('integrations.loading')}</p>
        ) : (
          <div className="text-sm text-gray-700 space-y-1">
            <p>
              <span className="font-medium">{t('integrations.plan')}:</span> {data?.plan || user?.plan}
            </p>
            <p>
              <span className="font-medium">{t('integrations.basePath')}:</span> {data?.api?.basePath || '/api'}
            </p>
            <p className="text-gray-500">{data?.note}</p>
          </div>
        )}
      </div>

      <div className="bg-white border border-gray-300 shadow-sm p-5 space-y-2">
        <h2 className="font-semibold text-gray-800">{t('integrations.example')}</h2>
        <pre className="text-xs bg-gray-900 text-gray-100 p-3 rounded overflow-x-auto">{curl}</pre>
      </div>
    </div>
  );
}
