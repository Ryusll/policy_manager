import { useMemo } from 'react';
import type { QueryClient, QueryKey } from '@tanstack/react-query';
import { versionsApi } from '../../api/policies';
import { isRunning, runningNow, type RunKind, type ShownPolicy, type ToolStatus } from '../../lib/policyResult';
import { koreanReason, runWrite, type WriteSpec } from '../../lib/policyWrite';
import { reviewFailure, sameDraftText, StepError, type ReviewTarget, type ReviewVersion } from './reviewRequest';
import { sameDialog } from '../../lib/writeDialogs';
import { serviceToday } from '../../lib/serviceDate';
import { useLatest } from '../../lib/useLatest';

/*
 * 판 전환 다섯 — 시행 승인·반려·폐지·폐지 예정 취소·시행 예정 철회(T-224 단계 B, 설계 E1·E2·E4·E11·E13). 페이지의 useMutation 을 옮겼다:
 * 누를 때의 규정·조문·판을 잡아 끝까지 쓰고(쓰는 사이 다른 조문을 골라도 그 조문의 목록·배너에 결과가 가지 않게), 진행은 규정별
 * 저장소('version' — 한 규정에서 판 쓰기는 한 번에 하나, 초안 일괄 시행과도 서로 막는다), 결과는 lib/policyWrite 규칙(조문 배너 →
 * 도구 줄 → '코드 제목 — 문구' 알림)으로 간다. 결과 글에는 조문 표기와 판 번호를 붙인다(E2). 조문은 창을 연 때의 것을 대상에 실어
 * 받는다 — 창이 열린 사이 고른 조문이 바뀌거나 풀려도 그 판의 조문으로 보내고 알린다(B1 검토).
 */

type T = (key: string, vars?: Record<string, string | number>) => string;
type Version = { id: string; status?: string; repealedOn?: string | null };
export { reviewFailure, sameDraftText, StepError, type ReviewTarget } from './reviewRequest';
/** 판 쓰기 — 전환 다섯, 목록·카드의 검토 요청(submit), 편집기의 검토 요청(review — 초안 저장 뒤 제출, T-224 단계 B2) */
export type VersionAction = 'approve' | 'reject' | 'archive' | 'cancelRepeal' | 'withdraw' | 'submit' | 'review';

/** 대상 — 판 id·번호, 그 판의 조문(id·표기, 창을 연 때의 것), 열려 있던 창의 번호(창 없이 시작하면 token 없음) */
export type VersionTarget = { versionId: string; versionNum: number | string; articleId: string; articleLabel: string; token?: number | null };

/** 판 창이 드는 대상 — 창을 연 때의 판과 그 조문 */
export type VersionDialogTarget = { id: string; versionNum: number; articleId: string; articleLabel: string };

/** 창 대상을 쓰기의 대상으로 */
export const versionTargetArgs = (d: VersionDialogTarget) => ({ versionId: d.id, versionNum: d.versionNum, articleId: d.articleId, articleLabel: d.articleLabel });

/** 다시 받은 판이 그 쓰기의 기대 상태인가(E4) — 응답 없음·5xx 뒤 반영됐는지 본다 */
export const landedState: Record<VersionAction, (v: Version) => boolean> = {
  approve: (v) => v.status === 'published' || v.status === 'archived',
  reject: (v) => v.status === 'draft',
  archive: (v) => v.status === 'archived',
  // 폐지일만 본다 — 다른 판이 시행 중이면 서버는 상태를 archived 그대로 두고 폐지일만 지운다(versions.service cancelRepeal)
  cancelRepeal: (v) => !v.repealedOn,
  withdraw: (v) => v.status === 'draft',
  submit: (v) => v.status === 'review',
  review: (v) => v.status === 'review',
};

/** 판 쓰기를 막는가 — 같은 규정의 판 쓰기 또는 초안 일괄 시행이 도는 중(E11). 여는 단추·창의 확인 단추가 같이 본다 */
export function versionLocked(running: readonly string[], policyId: string | undefined): boolean {
  return isRunning(running, 'version', policyId) || isRunning(running, 'publish', policyId);
}

/** 폐지의 완료 문구 — 미래 날짜면 폐지 예정, 아니면 폐지(그날부터 빠짐), 게시본이 남지 않았으면 덧붙임 */
export function archivedText(res: { repealedOn?: string | null; remainingPublished?: number } | undefined, t: T): string {
  const day = res?.repealedOn ? String(res.repealedOn).slice(0, 10) : '';
  if (day && day > serviceToday()) return t('policyWrites.version.archiveScheduled', { date: day });
  const base = day ? t('policyWrites.version.archivedFrom', { date: day }) : t('policyWrites.version.archived');
  return res?.remainingPublished === 0 ? `${base} ${t('policyWrites.version.archivedLast')}` : base;
}

export function useVersionActions(o: {
  policyId: string | undefined;
  /** 이름 붙은 알림의 규정 이름(코드 제목) */
  label: string;
  qc: QueryClient;
  shown: Readonly<ShownPolicy>;
  toolbar: ToolStatus;
  t: T;
  start: (kind: RunKind, policyId: string, target?: string) => boolean;
  end: (kind: RunKind, policyId: string) => void;
}) {
  const latest = useLatest(o);
  return useMemo(() => {
    const run = <R,>(
      action: VersionAction,
      v: VersionTarget,
      call: () => Promise<R>,
      done: (res: R, t: T) => string,
      extraSide?: (res: R | undefined) => QueryKey[],
      extra?: (t: T) => Partial<WriteSpec<R>>,
    ): Promise<boolean> => {
      // 누를 때의 값을 모두 여기서 잡는다 — 끝날 때 읽으면 그 사이 고른 다른 조문의 표기가 붙는다
      const { policyId, label, t, qc, shown, toolbar, start, end } = latest.current;
      const { articleId, articleLabel } = v;
      if (!policyId) return Promise.resolve(false);
      // 다시 보내면 창 안의 앞 거절 문구를 걷는다(useMutation 은 다시 보내면 isError 가 꺼졌다 — B1 재검토 #5). 시작하지 못하면(다른 판
      // 쓰기·초안 일괄 시행이 도는 중) 창 안에 까닭을 보인다 — 아무 말 없이 무시되지 않게(B1 검토)
      const dialog = () => sameDialog(policyId, action, v.token);
      dialog()?.setError(null);
      const refuse = (key: string) => {
        dialog()?.setError(t(key));
        return false;
      };
      // 초안 일괄 시행이 도는 동안은 시작하지 않는다(E11 — 반대쪽은 초안 일괄 시행의 시작이 본다)
      if (runningNow('publish', policyId)) return Promise.resolve(refuse('policyWrites.lockedPublish'));
      const spec: WriteSpec<R> = {
        kind: 'version',
        policyId,
        label,
        target: `${action}:${v.versionId}`,
        articleId,
        dialog: v.token === undefined ? undefined : { kind: action, token: v.token },
        source: `version:${v.versionId}`,
        action: t(`policyWrites.version.${action}`),
        call,
        waitKeys: [['versions', articleId]],
        // 시행 예정·폐지 예정은 대시보드·규정 목록에도 보인다(E13) — 기다리지 않고 무효화만
        sideKeys: (res) => [['policies'], ...(extraSide?.(res) ?? [])],
        subject: (m) => t('policyWrites.subject', { article: articleLabel, version: v.versionNum, message: m }),
        done: (res) => done(res, t),
        refusedText: (err) => koreanReason(err) ?? t(`policyWrites.version.${action}Failed`),
        // 그 조문의 판 목록을 새로 읽어 본다 — 캐시를 거치지 않는다(보는 화면이 없으면 다시 받기는 무효 표시만 하고, 캐시 받기는 재시도를
        // 앞두고 오프라인·탭 가림이면 멈춰 진행이 풀리지 않는다 — B1 재검토 #3). 읽지 못하면 모른다(확인하지 못했다고 알린다)
        landed: () =>
          (versionsApi.list(articleId) as Promise<Version[]>)
            .then((list) => {
              const found = list.find((x) => x.id === v.versionId);
              return found ? landedState[action](found) : undefined;
            })
            .catch(() => undefined),
        ...extra?.(t),
      };
      return runWrite({ qc, shown, toolbar, t, start, end }, spec).then((started) => started || refuse('policyWrites.locked'));
    };
    return {
      approve: (v: VersionTarget & { changeNote: string; effectiveDate?: string }) =>
        run('approve', v, () => versionsApi.approve(v.versionId, { changeNote: v.changeNote, effectiveDate: v.effectiveDate }), (_res, t) =>
          v.effectiveDate && v.effectiveDate > serviceToday()
            ? t('policyWrites.version.approvedScheduled', { date: v.effectiveDate })
            : t('policyWrites.version.approved'),
        ),
      reject: (v: VersionTarget & { reason: string }) =>
        run('reject', v, () => versionsApi.reject(v.versionId, v.reason), (_res, t) => t('policyWrites.version.rejected')),
      archive: (v: VersionTarget & { repealedOn?: string }) =>
        run('archive', v, () => versionsApi.archive(v.versionId, v.repealedOn), (res, t) => archivedText(res, t)),
      cancelRepeal: (v: VersionTarget) =>
        run('cancelRepeal', v, () => versionsApi.cancelRepeal(v.versionId), (_res, t) => t('policyWrites.version.repealCancelled')),
      // 목록·카드의 검토 요청 — 반영되면 그 조문의 편집기 검토 요청 줄(review:조문 id)도 걷는다(같은 일의 결과다 — B2 검토)
      submit: (v: VersionTarget) =>
        run('submit', v, () => versionsApi.submit(v.versionId), (_res, t) => t('policyWrites.version.submitted'), undefined, () => ({
          settleAlso: [`review:${v.articleId}` as const],
        })),
      // 편집기 — 초안을 고치거나 만든 뒤 제출한다. 진행 대상·작업 이름은 조문마다(새 초안은 누를 때 id 가 없다), 결과 글의 판 번호는 초안을
      // 만들거나 찾은 뒤에 안다(holder). 실패는 단계마다의 계획(reviewFailure)
      requestReview: (r: ReviewTarget) => {
        const holder: { versionNum?: number | string; draftId?: string | null } = { versionNum: r.draftNum, draftId: r.draftId };
        const payload = { content: r.content, changeNote: r.changeNote };
        return run(
          'review',
          { versionId: r.draftId ?? '', versionNum: r.draftNum ?? '', articleId: r.articleId, articleLabel: r.articleLabel, token: r.token },
          async () => {
            let draftId = r.draftId;
            // 새 초안이면 내가 만든 같은 글의 초안이 이미 있는지 먼저 본다 — 앞 요청이 응답 없이 끝났지만 저장됐으면 그것을 이어 쓴다(다시 눌러
            // 초안이 둘이 되지 않게, B2 검토). 목록을 읽지 못하면 보내지 않는다(같은 장애로 앞 초안을 못 찾고 또 만들지 않게, B2 재검토)
            if (!draftId) {
              let list: ReviewVersion[];
              try {
                list = (await versionsApi.list(r.articleId)) as ReviewVersion[];
              } catch (err) {
                throw new StepError('lookup', err, null);
              }
              const same = list.find((x) => sameDraftText(x, r));
              if (same) {
                draftId = same.id;
                holder.versionNum = same.versionNum;
              }
            }
            try {
              if (draftId) await versionsApi.update(draftId, payload);
              else {
                const created = (await versionsApi.create(r.articleId, payload)) as { id: string; versionNum?: number };
                draftId = created.id;
                holder.versionNum = created.versionNum;
              }
              holder.draftId = draftId;
            } catch (err) {
              throw new StepError('draft', err, draftId);
            }
            try {
              return (await versionsApi.submit(draftId)) as unknown;
            } catch (err) {
              throw new StepError('submit', err, draftId);
            }
          },
          (_res, t) => t('policyWrites.version.submitted'),
          undefined,
          (t) => ({
            target: `review:${r.articleId}`,
            // 판 id 를 알면 그 판의 이름으로(목록·카드의 검토 요청·판 전환과 같은 줄), 모르면 조문의 이름으로 — 반영되면 조문 줄도 걷는다
            source: () => (holder.draftId ? (`version:${holder.draftId}` as const) : (`review:${r.articleId}` as const)),
            settleAlso: [`review:${r.articleId}` as const],
            subject: (m) =>
              holder.versionNum
                ? t('policyWrites.subject', { article: r.articleLabel, version: holder.versionNum, message: m })
                : t('policyWrites.subjectArticle', { article: r.articleLabel, message: m }),
            failed: (err) => reviewFailure(err, r, holder, t),
          }),
        );
      },
      // 개정 후보로 승인한 판이면 후보가 작성 상태로 돌아간다(T-178) — 후보 화면·목록도 새로 받는다. 응답이 없어도 목록은 무효화
      withdraw: (v: VersionTarget & { reason: string }) =>
        run(
          'withdraw',
          v,
          () => versionsApi.withdraw(v.versionId, v.reason),
          (res, t) =>
            t('policyWrites.version.withdrawn', { date: res.withdrawnEffectiveDate }) + (res.candidateId ? ` ${t('versionWithdraw.candidateReopened')}` : ''),
          (res) => [['amendments'], ...(res?.candidateId ? [['amendment', res.candidateId]] : [])],
        ),
    };
  }, [latest]);
}
