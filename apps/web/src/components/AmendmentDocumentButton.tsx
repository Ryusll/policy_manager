import { useState } from 'react';
import { FileDown } from 'lucide-react';
import { amendmentDocumentError, downloadAmendmentDocument } from '../api/amendmentDocument';
import { useI18n } from '../i18n/useI18n';
import { toast } from '../stores/toastStore';

/** 서버 오류 코드 → 화면 문구 키. 서버 문구는 그대로 띄우지 않는다 — 언어가 다르고, 5xx 에는 렌더러 내부 메시지가 섞인다 */
const ERROR_KEYS: Record<string, string> = {
  AMENDMENT_DOC_REJECTED: 'amendmentDoc.rejected',
  AMENDMENT_DOC_MIXED_POLICY: 'amendmentDoc.mixedPolicy',
  AMENDMENT_DOC_DUPLICATE_ARTICLE: 'amendmentDoc.duplicateArticle',
  AMENDMENT_DOC_STALE: 'amendmentDoc.stale',
  AMENDMENT_DOC_STALE_ANY: 'amendmentDoc.staleAny',
};

/** 목록 버튼이 넣을 후보를 고르다 막힐 때 — 문구 키를 실어 던진다 */
export class AmendmentDocumentPick extends Error {
  constructor(readonly key: string, readonly vars?: Record<string, string | number>) {
    super(key);
  }
}

type Props = {
  /** 넣을 후보 — 정해져 있으면 이것, 누를 때 서버에서 고르면 `pickIds` */
  candidateIds?: string[];
  pickIds?: () => Promise<string[]>;
  /** 버튼 문구 — 없으면 '개정안 문서(PDF)' */
  label?: string;
  /** 반려된 후보 — 문서에 넣을 수 없어 버튼을 끄고 까닭을 곁에 보인다(서버도 400) */
  rejected?: boolean;
  /** 기준 본문이 지금과 달라진 후보 — 같은 방식으로 끈다(서버도 400) */
  stale?: boolean;
};

/**
 * 개정안 문서 PDF 버튼(T-162) — 이사회·노사협의회 안건 자료, 취업규칙 변경 신고의 변경 전후 비교 서류.
 * 승인 전 후보도 낼 수 있고, 문서 꼬리말이 확정이 아니라고 밝힌다. 만드는 동안에는 다시 누를 수 없다.
 */
export default function AmendmentDocumentButton({ candidateIds, pickIds, label, rejected, stale }: Props) {
  const { t } = useI18n();
  const disabledReason = rejected ? t('amendmentDoc.rejected') : stale ? t('amendmentDoc.staleHere') : '';
  const [busy, setBusy] = useState(false);

  const run = async () => {
    setBusy(true);
    try {
      const ids = pickIds ? await pickIds() : (candidateIds ?? []);
      if (!ids.length) throw new AmendmentDocumentPick('amendmentDoc.listNone');
      const { blob, filename } = await downloadAmendmentDocument(ids);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.rel = 'noopener';
      a.click();
      // 바로 해제하면 일부 브라우저에서 내려받기가 끊긴다(PolicyDetailPage 와 같이 늦춰 해제)
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
      toast(t('amendmentDoc.done'), 'success');
    } catch (err) {
      if (err instanceof AmendmentDocumentPick) {
        toast(t(err.key, err.vars), 'error');
        return;
      }
      const e = await amendmentDocumentError(err);
      // 낡은 후보는 어느 조문인지 함께 — 본문에 조문 표기가 없으면 조문 없는 문구로
      const code = e.code === 'AMENDMENT_DOC_STALE' && !e.article ? 'AMENDMENT_DOC_STALE_ANY' : e.code;
      const key = (code && ERROR_KEYS[code]) || (e.status === 404 ? 'amendmentDoc.notFound' : 'amendmentDoc.failed');
      toast(t(key, { article: e.article ?? '' }), 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <button
        type="button"
        className="btn-secondary text-xs inline-flex items-center gap-1"
        disabled={busy || (!pickIds && !candidateIds?.length) || Boolean(disabledReason)}
        aria-busy={busy}
        onClick={run}
      >
        <FileDown size={13} aria-hidden />
        {busy ? t('amendmentDoc.busy') : (label ?? t('amendmentDoc.button'))}
      </button>
      {disabledReason && <span className="text-xs text-gray-500">{disabledReason}</span>}
    </span>
  );
}
