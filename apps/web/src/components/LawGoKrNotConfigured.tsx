import { useAuthStore } from '../stores/authStore';
import { useI18n } from '../i18n/useI18n';

/**
 * 법제처 연동이 없는 서버의 안내 — 법령 등록 창과 규정 가져오기의 '법제처에서 가져오기' 탭이 함께 쓴다(T-212, SRS NFR-9).
 * 환경변수 이름·발급처·등록 IP 같은 설정 안내는 그것을 고칠 수 있는 통합 관리자에게만 보인다.
 * 고객사 관리자·편집자에게는 아스트룸에 문의하라고만 한다.
 */
export default function LawGoKrNotConfigured() {
  const { t } = useI18n();
  const isPlatformAdmin = useAuthStore((s) => s.user?.platformRole === 'global_admin');
  return (
    <div className="border border-amber-200 bg-amber-50 rounded-lg p-4 space-y-2" data-testid="lawgokr-not-configured">
      <p className="text-sm font-medium text-amber-900">{t('lawGoKr.notConfigured.title')}</p>
      {isPlatformAdmin ? (
        <>
          <p className="text-xs text-amber-800 leading-relaxed">
            {t('lawGoKr.notConfigured.opKey')} <code className="font-mono">LAW_GO_KR_OC</code>
            {' · '}
            <a href="https://open.law.go.kr" target="_blank" rel="noreferrer noopener" className="underline font-medium">
              open.law.go.kr
            </a>
          </p>
          <p className="text-xs text-amber-800 leading-relaxed">{t('lawGoKr.notConfigured.opAuth')}</p>
        </>
      ) : (
        <p className="text-xs text-amber-800 leading-relaxed">{t('lawGoKr.notConfigured.customer')}</p>
      )}
    </div>
  );
}
