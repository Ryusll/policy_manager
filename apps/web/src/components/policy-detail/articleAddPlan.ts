import type { QueryClient, QueryKey } from '@tanstack/react-query';
import { serverMessage } from '../../lib/apiError';
import { goneWrite, koreanReason, refusedWrite, type FailurePlan } from '../../lib/policyWrite';

/*
 * 조문 추가의 실패 계획과 반영 판정(T-224 단계 C, 설계 E3·E6) — useBodyWrites.addArticle 이 쓴다. 조문 추가는 조 머리·항·목을 차례로 한두
 * 번 보내고, 서버에는 같은 자리(조·가지·항·목)를 막는 제약이 없어 그대로 다시 보내면 조문이 겹친다.
 */

type T = (key: string, vars?: Record<string, string | number>) => string;

/** 조문 추가의 몇 번째 요청에서 실패했는가(조 머리를 먼저 만들고 항·목을 만들면 둘) */
export class ArticleStepError extends Error {
  constructor(
    readonly index: number,
    readonly cause: unknown,
  ) {
    super(`add article request ${index} failed`);
  }
}

type Row = {
  id: string;
  number?: number;
  branchNumber?: number | null;
  clauseNumber?: number | null;
  itemNumber?: number | null;
  liveChapterId?: string | null;
  title?: string | null;
  /** 시행 전 판(초안·검토 중) — 첫 내용을 보낸 조문은 그 내용의 초안이 있어야 다 만들어진 것 */
  pendingVersion?: { content?: string | null } | null;
};

type Chapter = { id: string; suppressHeader?: boolean | null; virtual?: boolean | null; articles?: Row[] };

const chaptersOf = (qc: QueryClient, policyId: string) => qc.getQueryData<{ chapters?: Chapter[] }>(['policy', policyId])?.chapters ?? [];

/** 화면이 든 그 규정의 조문 행 id — 누를 때 잡아 두고 반영 판정에 쓴다 */
export const articleIdsOf = (qc: QueryClient, policyId: string) => chaptersOf(qc, policyId).flatMap((ch) => (ch.articles ?? []).map((a) => a.id));

/** 화면이 든 그 규정의 장 id — 숨은 장 만들기의 반영 판정에 쓴다 */
export const chapterIdsOf = (qc: QueryClient, policyId: string) => chaptersOf(qc, policyId).map((c) => c.id);

/** 다시 받은 규정에 누르기 전에 없던 숨은 장(장 머리 없이 조만 두는 장) — 없으면 undefined */
export const newHiddenChapter = (qc: QueryClient, policyId: string, before: readonly string[]) =>
  chaptersOf(qc, policyId).find((c) => !!c.suppressHeader && !c.virtual && !before.includes(c.id));

/** 조문 자리(조·가지·항·목) — 결과 줄의 이름에 쓴다(다른 자리의 결과가 이 줄을 걷지 않게) */
export const positionKey = (p: Readonly<Record<string, unknown>>) =>
  [p.number, p.branchNumber, p.clauseNumber, p.itemNumber].map((x) => (typeof x === 'number' ? String(x) : '')).join('-');

/**
 * 다시 받은 규정의 그 장에 누르기 전에 없던 그 자리의 새 행(지금 장 기준 — 구조 변경 예정으로 다른 장 아래 보여도), 없으면 undefined.
 * 제목도 보낸 그대로여야 한다(서버는 앞뒤 공백을 빼고 저장한다) — 다른 사람이 같은 번호로 만든 조를 내 것으로 치지 않게(단계 C 검토)
 */
export function appearedRow(qc: QueryClient, policyId: string, chapterId: string, p: Readonly<Record<string, unknown>>, idsBefore: readonly string[]): Row | undefined {
  const at = (a: Row) =>
    a.number === p.number &&
    (a.branchNumber ?? null) === (p.branchNumber ?? null) &&
    (a.clauseNumber ?? null) === (p.clauseNumber ?? null) &&
    (a.itemNumber ?? null) === (p.itemNumber ?? null) &&
    (a.title ?? '') === (typeof p.title === 'string' ? p.title.trim() : '');
  for (const ch of chaptersOf(qc, policyId)) {
    const row = (ch.articles ?? []).find((a) => (a.liveChapterId ?? ch.id) === chapterId && !idsBefore.includes(a.id) && at(a));
    if (row) return row;
  }
  return undefined;
}

/**
 * 조문 추가의 실패 계획 — 첫 요청 거절은 양식 안에(입력을 고쳐 다시 보내게), 하나라도 만든 뒤 실패하면 양식을 닫고 '일부만 추가했을 수
 * 있습니다'. 첫 요청이 응답 없이 끝나도 양식을 닫는다(그대로 다시 보내 겹치지 않게). 다시 받은 규정에 그 자리의 새 행이 생겼으면 반영 —
 * 보낼 요청이 남았거나, 첫 내용을 보냈는데 그 행에 초안이 없으면(서버는 행을 만든 뒤 초안을 따로 저장한다) 일부만, 초안이 다른 내용이면
 * 내 것이 아니라 확인 못 함. 장이 이미 지워졌으면(404) 입력값이 아니라 그 까닭을 알린다
 */
export function addArticleFailure(
  err: unknown,
  c: { t: T; action: string; missed: readonly QueryKey[]; appeared: () => Row | undefined; content: string | null; more: boolean },
): FailurePlan | undefined {
  if (!(err instanceof ArticleStepError)) return undefined;
  const partial: FailurePlan = { dialog: 'close', message: c.t('bodyWrites.article.partial'), applied: true };
  if (err.index > 0) return partial;
  if (refusedWrite(err.cause)) {
    const why = koreanReason(err.cause);
    // 장이 이미 지워졌으면(404) 양식 안에는 복사해 두라는 글, 양식이 닫혔으면 결과 자리에 창 밖 글
    if (!why && goneWrite(err.cause)) return { dialog: 'error', message: c.t('bodyWrites.article.gone'), reportMessage: c.t('bodyWrites.article.goneClosed') };
    return { dialog: 'error', message: why ?? c.t('bodyWrites.article.failed') };
  }
  const row = c.missed.length === 0 ? c.appeared() : undefined;
  const draft = row?.pendingVersion;
  // 내 행인가 — 첫 내용을 보냈으면 그 내용의 초안(초안이 없으면 일부만 만들어진 내 행), 보내지 않았으면 초안이 없어야
  const mine = !!row && (c.content === null ? !draft : !draft || draft.content === c.content);
  if (mine) return c.more || (c.content !== null && !draft) ? partial : { dialog: 'close', message: c.t('policyWrites.landed', { action: c.action }), applied: true };
  const why = serverMessage(err.cause);
  return { dialog: 'close', message: why ? c.t('policyWrites.unknownWhy', { action: c.action, reason: why }) : c.t('policyWrites.unknown', { action: c.action }) };
}
