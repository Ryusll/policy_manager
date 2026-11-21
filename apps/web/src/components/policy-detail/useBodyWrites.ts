import { useMemo } from 'react';
import type { QueryClient } from '@tanstack/react-query';
import { commentsApi, policiesApi } from '../../api/policies';
import type { RunKind, ShownPolicy, ToolStatus } from '../../lib/policyResult';
import { goneWrite, koreanReason, runWrite, type WriteSpec } from '../../lib/policyWrite';
import { useLatest } from '../../lib/useLatest';
import { sameDialog } from '../../lib/writeDialogs';
import { appendixPayload, type AppendixDraft } from './appendixDraft';
import { ArticleStepError, addArticleFailure, appearedRow, articleIdsOf, positionKey } from './articleAddPlan';

/*
 * 본문 안 쓰기 셋 — 부칙·별표·서식(추가·수정·삭제), 의견(등록·처리 표시), 조문 추가(T-224 단계 C, 설계 E3·E6·E7·E12·E14). 페이지의
 * useMutation 을 옮겼다: 누를 때의 규정·조문·대상을 잡아 끝까지 쓰고, 진행은 규정별 저장소(종류마다 한 규정에서 한 번에 하나), 결과는
 * lib/policyWrite 규칙(조문 배너 → 도구 줄 → '코드 제목 — 문구' 알림). 부칙·별표·서식은 규정에 딸려 조문 배너 없이 도구 줄·알림으로 간다.
 * 결과 줄의 이름(작업 이름)은 대상마다 다르다 — 다른 항목의 결과가 앞 항목의 '확인하지 못했습니다' 줄을 걷거나 바꾸지 않게(단계 C 검토).
 * 아직 id 가 없는 새 항목은 보낸 내용(부칙은 구분·제목, 조문은 장·자리)으로 부른다. 의견 등록은 조문마다 하나다 — 거절된 글을 고쳐 다시
 * 보내면 앞 거절 줄이 걷히게(반영 여부는 입력칸 바로 위의 의견 목록에 보인다)
 */

type T = (key: string, vars?: Record<string, string | number>) => string;

/** 의견 길이 상한 — 서버 DTO(comments.dto MaxLength)와 같다 */
export const COMMENT_MAX = 2000;
type Appendix = { id: string; kind?: string; title?: string; body?: string | null; sortOrder?: number | null };
type Comment = { id: string; content?: string; isResolved?: boolean; user?: { id?: string } | null };

export function useBodyWrites(o: {
  policyId: string | undefined;
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
    const run = <R,>(build: (t: T, policyId: string, qc: QueryClient) => Omit<WriteSpec<R>, 'policyId' | 'label'>): Promise<boolean> => {
      const { policyId, label, t, qc, shown, toolbar, start, end } = latest.current;
      if (!policyId) return Promise.resolve(false);
      const spec = build(t, policyId, qc);
      // 다시 보내면 창 안의 앞 거절 문구를 걷는다(판 쓰기와 같은 규칙 — B1 재검토 #5)
      if (spec.dialog) sameDialog(policyId, spec.dialog.kind, spec.dialog.token)?.setError(null);
      return runWrite({ qc, shown, toolbar, t, start, end }, { policyId, label, ...spec });
    };
    const appendicesOf = (qc: QueryClient, policyId: string) => qc.getQueryData<{ appendices?: Appendix[] }>(['policy', policyId])?.appendices ?? [];
    return {
      /** 부칙·별표·서식 추가·수정 — 창 안 저장(창 번호), 결과 글은 '제목 — 문구', 행위 이름은 그 종류 이름(설계 E12) */
      saveAppendix: (v: { mode: 'create' | 'edit'; appendixId?: string; draft: AppendixDraft; kindLabel: string; idsBefore: readonly string[]; token: number | null }) => {
        const payload = appendixPayload(v.draft);
        const create = v.mode === 'create' || !v.appendixId;
        // 보낸 그대로인가 — 정렬 순서는 보냈을 때만 본다(비우면 서버가 정하거나 그대로 둔다)
        const same = (a: Appendix) =>
          a.kind === payload.kind &&
          a.title === payload.title &&
          (a.body ?? '') === payload.body &&
          (payload.sortOrder === undefined || (a.sortOrder ?? 0) === payload.sortOrder);
        return run<unknown>((t, policyId) => ({
          kind: 'appendix',
          target: create ? 'appendix:new' : `appendix:${v.appendixId}`,
          dialog: { kind: 'appendix', token: v.token },
          source: create ? `appendix:new:${payload.kind}:${payload.title}` : `appendix:${v.appendixId}`,
          action: t(create ? 'bodyWrites.appendix.create' : 'bodyWrites.appendix.update', { kind: v.kindLabel }),
          call: () => (create ? policiesApi.createAppendix(policyId, payload) : policiesApi.updateAppendix(policyId, v.appendixId!, payload)),
          // 제목이 곧 '별표 1'·'부칙'이라 구분을 또 붙이지 않는다 — 제목이 비었을 때만 구분
          subject: (m) => t('bodyWrites.appendix.subject', { title: payload.title || v.kindLabel, message: m }),
          done: () => t(create ? 'bodyWrites.appendix.created' : 'bodyWrites.appendix.updated'),
          // 이미 지워진 항목(404)이면 입력값이 아니라 그 까닭을 — 창은 둬서 쓰던 내용을 복사할 수 있게
          refusedText: (err) => koreanReason(err) ?? t(goneWrite(err) ? 'bodyWrites.appendix.gone' : 'bodyWrites.appendix.failed'),
          // 응답 없음·5xx — 다시 받은 규정에 그 항목이 보낸 대로 있으면 반영됨(추가는 누르기 전에 없던 항목이어야)
          landed: (qc) => {
            const list = appendicesOf(qc, policyId);
            if (create) return list.some((a) => !v.idsBefore.includes(a.id) && same(a));
            const a = list.find((x) => x.id === v.appendixId);
            return a ? same(a) : undefined;
          },
        }));
      },
      /** 부칙·별표·서식 삭제 — 이미 지워졌으면(404) 성공 쪽으로 '이미 지워진 항목입니다' */
      deleteAppendix: (v: { appendixId: string; title: string; kindLabel: string; onApplied?: () => void }) =>
        run<unknown>((t, policyId) => ({
          kind: 'appendix',
          target: `delete:${v.appendixId}`,
          source: `appendix:${v.appendixId}`,
          action: t('bodyWrites.appendix.delete', { kind: v.kindLabel }),
          call: () => policiesApi.deleteAppendix(policyId, v.appendixId),
          subject: (m) => t('bodyWrites.appendix.subject', { title: v.title || v.kindLabel, message: m }),
          done: () => t('bodyWrites.appendix.deleted'),
          refusedText: (err) => koreanReason(err) ?? t('bodyWrites.appendix.deleteFailed'),
          failed: (err) => (goneWrite(err) ? { dialog: 'close', message: t('bodyWrites.appendix.alreadyDeleted'), applied: true, kind: 'success' } : undefined),
          landed: (qc) => !appendicesOf(qc, policyId).some((a) => a.id === v.appendixId),
          onApplied: v.onApplied,
        })),
      /**
       * 의견 등록 — 그 조문의 의견 목록을 다시 받는다. 반영됐거나 반영됐는지 모르면(응답 없음 — 그대로 다시 보내 겹치지 않게, 설계 E3)
       * 입력칸을 비울지 페이지가 정한다(clearInput, 설계 E7). 거절이면 부르지 않는다. idsBefore 는 누를 때의 의견 목록(받지 못했으면 null)
       */
      postComment: (v: { articleId: string; articleLabel: string; content: string; idsBefore: readonly string[] | null; userId?: string; clearInput?: () => void }) =>
        run<unknown>((t) => ({
          kind: 'comment',
          target: `comment:new:${v.articleId}`,
          articleId: v.articleId,
          source: `comment:${v.articleId}`,
          action: t('bodyWrites.comment.create'),
          call: () => commentsApi.create(v.articleId, { content: v.content }),
          waitKeys: [['comments', v.articleId]],
          subject: (m) => t('policyWrites.subjectArticle', { article: v.articleLabel, message: m }),
          done: () => t('bodyWrites.comment.created'),
          refusedText: (err) => koreanReason(err) ?? t(goneWrite(err) ? 'bodyWrites.comment.gone' : 'bodyWrites.comment.failed'),
          // 누르기 전 목록에 없던 내 글이 같은 내용으로 생겼는가 — 누를 때 목록을 받지 못했으면 가릴 수 없어 모른다
          landed: () => {
            const before = v.idsBefore;
            if (!before || !v.userId) return undefined;
            return (commentsApi.list(v.articleId) as Promise<Comment[]>)
              .then((list) => list.some((c) => !before.includes(c.id) && c.content === v.content && c.user?.id === v.userId))
              .catch(() => undefined);
          },
          onApplied: v.clearInput,
          onUnknown: v.clearInput,
        })),
      /** 의견 처리 표시(처리완료·미처리) — 의견마다, 행위 이름은 누른 단추 글 */
      resolveComment: (v: { articleId: string; articleLabel: string; commentId: string; resolve: boolean }) =>
        run<unknown>((t) => ({
          kind: 'comment',
          target: `resolve:${v.commentId}`,
          articleId: v.articleId,
          source: `comment:${v.commentId}`,
          action: t(v.resolve ? 'bodyWrites.comment.resolveAction' : 'bodyWrites.comment.reopenAction'),
          call: () => commentsApi.update(v.commentId, { isResolved: v.resolve }),
          waitKeys: [['comments', v.articleId]],
          subject: (m) => t('policyWrites.subjectArticle', { article: v.articleLabel, message: m }),
          done: () => t(v.resolve ? 'bodyWrites.comment.resolved' : 'bodyWrites.comment.reopened'),
          refusedText: (err) => koreanReason(err) ?? t('bodyWrites.comment.resolveFailed'),
          landed: () =>
            (commentsApi.list(v.articleId) as Promise<Comment[]>)
              .then((list) => {
                const c = list.find((x) => x.id === v.commentId);
                return c ? c.isResolved === v.resolve : undefined;
              })
              .catch(() => undefined),
        })),
      /** 조문 추가 — 조 머리·항·목을 차례로(하나 또는 둘). 실패는 몇 번째 요청인지에 따라(articleAddPlan addArticleFailure) */
      addArticle: (v: { chapterId: string; payloads: readonly Record<string, unknown>[]; articleLabel: string; token: number | null }) =>
        run<unknown>((t, policyId, qcNow) => {
          // 누르기 전에 화면이 든 조문 행 — 응답 없이 끝나면 그 자리의 새 행이 생겼는지로 반영을 본다(설계 E6)
          const idsBefore = articleIdsOf(qcNow, policyId);
          const first = v.payloads[0] ?? {};
          // 결과 줄의 이름은 추가하는 행의 자리(마지막 요청) — 조 머리를 먼저 만드는 두 요청도, 조 머리가 생긴 뒤의 한 요청 다시 보내기도 같은 이름
          const row = v.payloads[v.payloads.length - 1] ?? first;
          return {
            kind: 'addArticle',
            target: 'addArticle',
            dialog: { kind: 'addArticle', token: v.token },
            source: `addArticle:${v.chapterId}:${positionKey(row)}`,
            action: t('bodyWrites.article.add'),
            call: async () => {
              let last: unknown;
              for (const [index, body] of v.payloads.entries()) {
                try {
                  last = await policiesApi.createArticle(policyId, v.chapterId, body);
                } catch (err) {
                  throw new ArticleStepError(index, err);
                }
              }
              return last;
            },
            subject: (m) => t('policyWrites.subjectArticle', { article: v.articleLabel, message: m }),
            done: () => t('bodyWrites.article.added'),
            refusedText: (err) => koreanReason(err) ?? t('bodyWrites.article.failed'),
            failed: (err, { qc, missed }) =>
              addArticleFailure(err, {
                t,
                action: t('bodyWrites.article.add'),
                missed,
                appeared: () => appearedRow(qc, policyId, v.chapterId, first, idsBefore),
                // 서버는 첫 내용이 있을 때만 초안을 만든다(빈 글이면 행만)
                content: typeof first.content === 'string' && first.content !== '' ? first.content : null,
                more: v.payloads.length > 1,
              }),
          };
        }),
    };
  }, [latest]);
}
