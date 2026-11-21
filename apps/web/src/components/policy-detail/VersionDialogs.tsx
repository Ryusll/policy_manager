import type { ReactNode } from 'react';
import clsx from 'clsx';
import { useI18n } from '../../i18n/useI18n';
import { LengthCap } from './LengthCap';

/*
 * 판(버전) 확인 창 넷 — 시행 승인·검토 반려·시행 예정 철회·게시본 폐지(T-224 단계 B). 페이지에서 떼어 문구를 키로 옮겼다
 * (ActiveToggleDialog 와 같은 꼴). 입력값은 페이지가 들고, 진행(busy — 이 창의 쓰기가 도는 중)·막힘(locked — 이 규정의 다른 판
 * 쓰기·초안 일괄 시행이 도는 중)·실패(error — 이 창을 연 뒤 이 창에서 보낸 쓰기의 거절)는 페이지가 이 규정의 것만 넘긴다. 진행 중에도
 * 취소로 닫을 수 있다 — 그 뒤 결과는 조문 배너·도구 줄·이름 붙은 알림으로 간다(lib/policyWrite).
 */

type Common = { busy: boolean; locked: boolean; error: string | null; onConfirm: () => void; onCancel: () => void };

/** 사유 길이 상한 — 서버 DTO(RejectVersionDto·WithdrawVersionDto MaxLength)와 같다. 넘기면 서버의 영문 검증 문구로 거절돼 까닭을 알 수 없었다(B1 검토) */
export const REJECT_REASON_MAX = 2000;
export const WITHDRAW_REASON_MAX = 500;

/**
 * 쓰기 확인 창의 틀 — 이름 붙은 창(role=dialog). 판 창 넷과 부칙·별표·서식 창(wide — 표를 평문으로 쓰는 본문 칸이 넓어야 한다)이 같이
 * 쓴다. 낮은 화면·확대·늘린 본문 칸에서도 단추에 닿게 창 안에서 스크롤한다(단계 C 검토)
 */
export function Frame(p: { id: string; title: string; wide?: boolean; children: ReactNode }) {
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div
        className={clsx('bg-white border border-gray-300 shadow-xl w-full max-h-[90vh] overflow-y-auto', p.wide ? 'max-w-2xl' : 'max-w-md')}
        role="dialog"
        aria-labelledby={p.id}
      >
        <div id={p.id} className="bg-navy-800 text-white px-5 py-3 font-medium text-sm">
          {p.title}
        </div>
        <div className="p-5 space-y-4">{p.children}</div>
      </div>
    </div>
  );
}

/** 창 안 실패 줄(role=alert) — 넘겨받은 것만 */
export function Failure({ error }: { error: string | null }) {
  if (!error) return null;
  return (
    <p role="alert" className="text-xs text-red-700 bg-red-50 border border-red-200 rounded px-2 py-1.5">
      {error}
    </p>
  );
}

function Buttons(p: Common & { label: string; ready: boolean }) {
  const { t } = useI18n();
  return (
    <div className="flex gap-2">
      <button type="button" onClick={p.onConfirm} disabled={!p.ready || p.busy || p.locked} className="btn-primary">
        {p.busy ? t('versionDialog.busy') : p.label}
      </button>
      <button type="button" onClick={p.onCancel} className="btn-secondary">
        {t('versionDialog.cancel')}
      </button>
    </div>
  );
}

const VersionTag = ({ n }: { n: number | string }) => (
  <span className="font-mono text-xs bg-gray-100 border border-gray-200 px-1.5 py-0.5 rounded">v{n}</span>
);

/** 시행 승인 — 사유(필수)와 시행일(비우면 오늘). 이 조문에 더 늦게 시행될 판이 있으면 그보다 이른 날은 막는다 */
export function ApproveDialog(
  p: Common & { note: string; onNote: (v: string) => void; date: string; onDate: (v: string) => void; minDate: string | null; tooEarly: boolean; today: string },
) {
  const { t } = useI18n();
  return (
    <Frame id="version-approve-title" title={t('versionDialog.approve.title')}>
      <div>
        <label className="block text-xs font-medium text-gray-600 mb-1.5" htmlFor="approve-note">
          {t('versionDialog.approve.note')}
        </label>
        <textarea
          id="approve-note"
          className="input resize-none w-full"
          rows={4}
          placeholder={t('versionDialog.approve.notePlaceholder')}
          value={p.note}
          onChange={(e) => p.onNote(e.target.value)}
          autoFocus
        />
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-600 mb-1.5" htmlFor="approve-effective-date">
          {t('versionDialog.approve.date')}
        </label>
        <input
          id="approve-effective-date"
          type="date"
          className="input w-full"
          min={p.minDate ?? undefined}
          value={p.date}
          onChange={(e) => p.onDate(e.target.value)}
        />
        <p className="text-[11px] text-gray-500 mt-1">
          {t('versionDialog.approve.dateHintBefore')}
          <strong>{t('versionDialog.approve.dateHintStrong')}</strong>
          {t('versionDialog.approve.dateHintAfter')}
        </p>
        {p.date && p.date > p.today && <p className="text-[11px] text-amber-800 mt-1">{t('versionDialog.approve.future')}</p>}
        {p.minDate && (
          <p className={clsx('text-[11px] mt-1', p.tooEarly ? 'text-red-700' : 'text-gray-500')} data-testid="approve-min-date">
            {t(p.tooEarly ? 'versionDialog.approve.minDateTooEarly' : 'versionDialog.approve.minDate', { date: p.minDate })}
          </p>
        )}
      </div>
      <Failure error={p.error} />
      <Buttons {...p} label={t('versionDialog.approve.confirm')} ready={!!p.note.trim() && !p.tooEarly} />
    </Frame>
  );
}

/** 검토 반려 — 초안으로 되돌린다. 사유(필수)는 되돌린 초안에 함께 보인다 */
export function RejectDialog(p: Common & { reason: string; onReason: (v: string) => void }) {
  const { t } = useI18n();
  return (
    <Frame id="version-reject-title" title={t('versionDialog.reject.title')}>
      <p className="text-xs text-gray-600">
        {t('versionDialog.reject.introBefore')}
        <strong>{t('versionDialog.reject.introStrong')}</strong>
        {t('versionDialog.reject.introAfter')}
      </p>
      <div>
        <label className="block text-xs font-medium text-gray-600 mb-1.5" htmlFor="reject-reason">
          {t('versionDialog.reject.reason')}
        </label>
        <textarea
          id="reject-reason"
          className="input resize-none w-full"
          rows={4}
          placeholder={t('versionDialog.reject.reasonPlaceholder')}
          maxLength={REJECT_REASON_MAX}
          value={p.reason}
          onChange={(e) => p.onReason(e.target.value)}
          autoFocus
        />
        <LengthCap value={p.reason} max={REJECT_REASON_MAX} />
        <p className="text-[11px] text-gray-500 mt-1">{t('versionDialog.reject.reasonHint')}</p>
      </div>
      <Failure error={p.error} />
      <Buttons {...p} label={t('versionDialog.reject.confirm')} ready={!!p.reason.trim()} />
    </Frame>
  );
}

/** 시행 예정 철회 — 그 판은 초안으로 돌아가고 지금 본문이 그대로 시행된다. 사유(필수) */
export function WithdrawDialog(p: Common & { versionNum: number | string; effectiveDate: string; reason: string; onReason: (v: string) => void }) {
  const { t } = useI18n();
  return (
    <Frame id="version-withdraw-title" title={t('versionDialog.withdraw.title')}>
      <p className="text-sm text-gray-700">
        <VersionTag n={p.versionNum} /> {t('versionDialog.withdraw.ask', { date: p.effectiveDate })}
      </p>
      <div className="bg-amber-50 border border-amber-200 rounded px-3 py-2 text-xs text-amber-900 space-y-1">
        <p>
          {t('versionDialog.withdraw.effectBefore')}
          <strong>{t('versionDialog.withdraw.effectStrong')}</strong>
          {t('versionDialog.withdraw.effectAfter')}
        </p>
        <p>{t('versionWithdraw.dialogNotify')}</p>
      </div>
      <label className="block">
        <span className="text-xs font-medium text-gray-600">{t('versionDialog.withdraw.reason')}</span>
        <textarea
          className="input resize-none w-full mt-1"
          rows={3}
          value={p.reason}
          maxLength={WITHDRAW_REASON_MAX}
          onChange={(e) => p.onReason(e.target.value)}
          placeholder={t('versionDialog.withdraw.reasonPlaceholder')}
          autoFocus
        />
        <LengthCap value={p.reason} max={WITHDRAW_REASON_MAX} />
      </label>
      <Failure error={p.error} />
      <Buttons {...p} label={t('versionDialog.withdraw.confirm')} ready={!!p.reason.trim()} />
    </Frame>
  );
}

/** 게시본 폐지 — 폐지 시행일(비우면 오늘, 한국 날짜). 미래면 그날부터 빠지고 그때까지는 시행 중(T-132 ③). 소급은 없다(T-126) */
export function ArchiveDialog(p: Common & { versionNum: number | string; date: string; onDate: (v: string) => void; today: string }) {
  const { t } = useI18n();
  const future = !!p.date && p.date > p.today;
  return (
    <Frame id="version-archive-title" title={t('versionDialog.archive.title')}>
      <p className="text-sm text-gray-700">
        <VersionTag n={p.versionNum} />
        {t('versionDialog.archive.ask')}
      </p>
      <div>
        <label className="block text-xs font-medium text-gray-600 mb-1.5" htmlFor="archive-date">
          {t('versionDialog.archive.date')}
        </label>
        <input id="archive-date" type="date" className="input w-full" min={p.today} value={p.date} onChange={(e) => p.onDate(e.target.value)} />
        <p className="text-[11px] text-gray-500 mt-1">{t('versionDialog.archive.dateHint', { today: p.today })}</p>
      </div>
      {future ? (
        <div className="bg-amber-50 border border-amber-200 rounded px-3 py-2 text-xs text-amber-900 space-y-1" data-testid="archive-future-note">
          <p>
            <strong>{t('versionDialog.archive.futureStrong', { date: p.date })}</strong>
            {t('versionDialog.archive.futureAfter')}
          </p>
          <p>{t('versionDialog.archive.futureCancel')}</p>
        </div>
      ) : (
        <div className="bg-amber-50 border border-amber-200 rounded px-3 py-2 text-xs text-amber-900 space-y-1">
          <p>
            <strong>{t('versionDialog.archive.todayStrong', { today: p.today })}</strong>
            {t('versionDialog.archive.todayAfter')}
          </p>
          <p>{t('versionDialog.archive.todayKeep')}</p>
          <p>
            {t('versionDialog.archive.todayLastBefore')}
            <strong>{t('versionDialog.archive.todayLastStrong')}</strong>
          </p>
        </div>
      )}
      <Failure error={p.error} />
      <Buttons {...p} label={t(future ? 'versionDialog.archive.confirmScheduled' : 'versionDialog.archive.confirm')} ready />
    </Frame>
  );
}
