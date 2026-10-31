import { useState } from 'react';
import type { AiQaNotice } from '../api/ask';
import { useI18n } from '../i18n/useI18n';

/**
 * 규정 질문의 외부 전송 고지 (T-146, D-09 재결정 2026-10-14, ADR-0025).
 *
 * 고지 본문은 서버가 내려 준 그대로 그린다 — 관리자가 켤 때 보낸 판 번호와 화면에 보인 내용이 어긋나지 않게.
 */

/**
 * 받는 곳·국가·보내는 항목·보관 기간 — 켜기 확인 창과 질문 화면의 "자세히"가 함께 쓴다.
 * `languageNote` — 영어 화면의 "한국어로만" 안내. 꼬리말은 맨 위에 이미 내므로 펼친 본문에서는 끈다
 */
export function AskNoticeBody({ notice, languageNote = true }: { notice: AiQaNotice; languageNote?: boolean }) {
  const { t, isEn } = useI18n();
  const row = 'grid grid-cols-[5.5rem_1fr] gap-2 py-1.5';
  return (
    <div className="text-xs text-gray-700 divide-y divide-gray-100" data-testid="ask-notice-body">
      {/* 고지는 계약 언어인 한국어로만 낸다 — 영어 화면에서는 그 사실을 밝힌다 */}
      {isEn && languageNote && <p className="py-1.5 text-gray-500">{t('ask.notice.koreanOnly')}</p>}
      <div className={row}>
        <span className="text-gray-500">{t('ask.notice.recipient')}</span>
        <span className="font-medium">{notice.recipient}</span>
      </div>
      <div className={row}>
        <span className="text-gray-500">{t('ask.notice.country')}</span>
        <span>{notice.country}</span>
      </div>
      <div className={row}>
        <span className="text-gray-500">{t('ask.notice.sent')}</span>
        <div>
          <ul className="list-disc pl-4 space-y-0.5">
            {notice.sent.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ul>
          <p className="mt-1 text-gray-500">{notice.notSent}</p>
        </div>
      </div>
      <div className={row}>
        <span className="text-gray-500">{t('ask.notice.retention')}</span>
        <ul className="list-disc pl-4 space-y-0.5">
          {notice.retention.map((s) => (
            <li key={s}>{s}</li>
          ))}
          <li>{notice.training}</li>
        </ul>
      </div>
      <p className="py-1.5">{notice.control}</p>
    </div>
  );
}

/** 관리자가 켜기 전에 고지를 확인하는 창 — 확인란을 체크해야 켤 수 있다 */
export function AskConsentDialog({
  notice,
  pending,
  onConfirm,
  onCancel,
}: {
  notice: AiQaNotice;
  pending: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const { t } = useI18n();
  const [agreed, setAgreed] = useState(false);
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div
        className="bg-white border border-gray-300 shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto"
        role="dialog"
        aria-modal="true"
        aria-labelledby="ask-consent-title"
      >
        <div id="ask-consent-title" className="bg-navy-800 text-white px-5 py-3 font-medium text-sm">
          {t('ask.consent.title')}
        </div>
        <div className="p-5 space-y-4">
          <p className="text-xs text-gray-600 leading-relaxed">{t('ask.consent.intro')}</p>
          <AskNoticeBody notice={notice} />
          <label className="flex items-start gap-2 text-xs text-gray-800">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={agreed}
              onChange={(e) => setAgreed(e.target.checked)}
              data-testid="ask-consent-agree"
            />
            <span>{notice.consentStatement}</span>
          </label>
          <div className="flex justify-end gap-2">
            <button type="button" className="btn-secondary text-sm" onClick={onCancel} disabled={pending}>
              {t('ask.consent.cancel')}
            </button>
            <button type="button" className="btn-primary text-sm" onClick={onConfirm} disabled={!agreed || pending}>
              {pending ? t('ask.consent.pending') : t('ask.consent.confirm')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/** 꺼져 있을 때의 안내 — 처음부터 꺼져 있는 경우와 고지가 바뀌어 다시 확인해야 하는 경우를 가른다 */
export function AskOffNotice({ needsConsent, isAdmin }: { needsConsent: boolean; isAdmin: boolean }) {
  const { t } = useI18n();
  return (
    <div className="card p-4 border-amber-200 bg-amber-50 text-sm text-amber-900" data-testid="ask-off-notice">
      <p>{needsConsent ? t('ask.off.stale') : t('ask.off.disabled')}</p>
      <p className="text-xs mt-1">
        {isAdmin ? (needsConsent ? t('ask.off.staleAdminHint') : t('ask.off.adminHint')) : t('ask.off.staffHint')}
      </p>
    </div>
  );
}

/** 질문 폼 아래 고지 — 한 줄 요약과 민감정보 주의, "자세히"로 전체 고지. 요약도 서버 고지에서 온다(판에 묶임) */
export function AskNoticeFooter({ notice }: { notice: AiQaNotice }) {
  const { t, isEn } = useI18n();
  const [open, setOpen] = useState(false);
  return (
    <div className="text-[11px] text-gray-500 space-y-1" data-testid="ask-notice-footer">
      {isEn && <p>{t('ask.notice.koreanOnly')}</p>}
      <p>
        {notice.summary}{' '}
        <button type="button" className="underline hover:text-gray-700" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
          {open ? t('ask.notice.less') : t('ask.notice.more')}
        </button>
      </p>
      <p className="text-amber-800">{notice.caution}</p>
      {open && (
        <div className="border border-gray-200 rounded px-3 py-1 bg-gray-50">
          <AskNoticeBody notice={notice} languageNote={false} />
        </div>
      )}
    </div>
  );
}
