import { versionsApi } from '../../api/policies';
import { serverMessage } from '../../lib/apiError';
import { koreanReason, refusedWrite, type FailurePlan } from '../../lib/policyWrite';

/*
 * 편집기의 검토 요청(T-224 단계 B2, 설계 E5) — 초안을 고치거나 만든 뒤 제출하는 두 단계라, 실패한 단계에 따라 편집기를 어떻게 둘지 다르다.
 * useVersionActions.requestReview 가 쓴다. 이어받는 초안은 이 요청이 보낸 글과 같은 초안뿐이다 — 남이(다른 사람·다른 탭·재파싱 묶음)
 * 만든 초안을 '저장됐다'며 이어받아 다음 요청이 덮어쓰지 않게(B2 검토). 저장됐는지 모르면 편집기와 쓰던 글을 그대로 둔다 — 다시 누르면
 * 내가 만든 같은 글의 초안을 먼저 찾아 이어 쓴다(requestReview — 그 사이 글을 고쳤거나, 앞 요청이 찾은 뒤에야 저장되면 초안이 둘이 될 수
 * 있다. 목록을 읽지 못하면 보내지 않는다).
 */

type T = (key: string, vars?: Record<string, string | number>) => string;
export type ReviewVersion = { id: string; status?: string; versionNum?: number; content?: string | null; changeNote?: string | null; reparseItem?: unknown; createdBy?: string | null };

/** 편집기의 검토 요청 — 고치는 초안(없으면 새로 만든다)과 그 번호, 보내는 글 */
export type ReviewTarget = {
  articleId: string;
  articleLabel: string;
  draftId: string | null;
  draftNum?: number | string;
  content: string;
  changeNote?: string;
  token: number | null;
  /** 보내는 사람 — 같은 글의 초안을 이어 쓸 때 내가 만든 것만(남의 초안을 덮어쓰지 않게) */
  userId?: string;
};

/** 이 요청이 보낸 글의 초안인가 — 상태 초안, 재파싱 묶음 초안이 아님, 내가 만든 것(작성자를 알 때), 글과 변경 사유가 같다 */
export function sameDraftText(x: ReviewVersion, r: Pick<ReviewTarget, 'content' | 'changeNote' | 'userId'>): boolean {
  if (x.status !== 'draft' || x.reparseItem) return false;
  if (r.userId && x.createdBy && x.createdBy !== r.userId) return false;
  return (x.content ?? '') === r.content && (x.changeNote ?? '') === (r.changeNote ?? '');
}

/** 어디서 실패했는가 — 같은 글 초안 찾기(lookup, 아무것도 보내지 않았다)·초안 저장(draft)·제출(submit), 저장한 초안 id */
export class StepError extends Error {
  constructor(
    readonly step: 'lookup' | 'draft' | 'submit',
    readonly cause: unknown,
    readonly draftId: string | null,
  ) {
    super(`review ${step} failed`);
  }
}

/**
 * 실패 계획 — 초안 저장 거절은 편집기 안에. 초안 저장이 응답 없이 끝나면 새 초안일 때 다시 읽은 목록에 보낸 글의 초안이 생겼으면 그 초안을
 * 이어받아 '저장됐습니다', 아니면(고치던 초안이거나 못 찾음) 편집기·글을 두고 '저장됐는지 확인하지 못했습니다'. 제출 거절은 저장한 초안을
 * 이어받아 '초안은 저장했지만 …'. 제출이 응답 없이 끝나면 다시 읽은 상태가 검토 중이면 반영됨(닫음), 아니면 저장한 초안을 이어받아 확인
 * 못 함(글은 그대로)
 */
export async function reviewFailure(err: unknown, r: ReviewTarget, holder: { versionNum?: number | string; draftId?: string | null }, t: T): Promise<FailurePlan | undefined> {
  if (!(err instanceof StepError)) return undefined;
  const action = t('policyWrites.version.review');
  const read = () => (versionsApi.list(r.articleId) as Promise<ReviewVersion[]>).catch(() => null);
  if (err.step === 'lookup') return { dialog: 'error', message: t('policyWrites.version.lookupFailed') };
  if (err.step === 'draft') {
    if (refusedWrite(err.cause)) return { dialog: 'error', message: koreanReason(err.cause) ?? t('policyWrites.version.draftFailed') };
    if (!r.draftId) {
      const created = (await read())?.find((x) => sameDraftText(x, r));
      if (created) {
        holder.versionNum = created.versionNum;
        holder.draftId = created.id;
        return { dialog: 'error', adopt: created.id, message: t('policyWrites.version.draftMaybeSaved') };
      }
    }
    // '쓰던 글은 그대로'는 편집기가 열려 있을 때만 맞는 말 — 닫혔으면 결과 자리에 다른 글(B2 재검토)
    return { dialog: 'error', message: t('policyWrites.version.draftUnknown'), reportMessage: t('policyWrites.version.draftUnknownClosed') };
  }
  const adopt = err.draftId ?? undefined;
  if (refusedWrite(err.cause)) {
    const reason = koreanReason(err.cause) ?? t('policyWrites.version.submitRefused');
    return { dialog: 'error', adopt, message: t('policyWrites.version.draftSavedSubmitFailed', { reason }) };
  }
  const now = (await read())?.find((x) => x.id === err.draftId);
  if (now?.status === 'review') return { dialog: 'close', message: t('policyWrites.landed', { action }), applied: true };
  const why = serverMessage(err.cause);
  return { dialog: 'error', adopt, message: why ? t('policyWrites.unknownWhy', { action, reason: why }) : t('policyWrites.unknown', { action }) };
}
