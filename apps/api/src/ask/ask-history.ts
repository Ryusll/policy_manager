import type { AskReason, AskResult } from './ask.service';

/**
 * 내 지난 질문(T-218, SRS SEARCH-10) — 질문 기록 한 행을 화면에 내보낼 꼴로 바꾼다.
 *
 * 기록의 `failure` 에는 제공사·DB 오류 문구가 그대로 남을 수 있어 내보내지 않고 결과 종류(`outcome`)로만 알린다.
 * 다시 보기는 물은 때 남긴 근거(조문 원문·법령 근거·살펴본 조문)를 그대로 보인다 — 이 칸을 남기기 전(T-218 전)의
 * 기록은 답 본문만 있다(`snapshot: false`, 처리 중이던 기록도 false 지만 결과가 없다).
 * 답하지 못한 결과는 사유와 살펴본 조문만 보인다 — 답 본문·근거는 그때도 비어 있었다(`ask-report.ts` checkReport 의 none).
 */
export type AskOutcome = 'answered' | AskReason | 'failed' | 'unfinished';

const REASONS: readonly AskReason[] = ['no_regulations', 'no_candidates', 'no_basis', 'refused'];

/** 목록에 읽는 칸 */
export const ASK_HISTORY_LIST_SELECT = {
  id: true,
  question: true,
  createdAt: true,
  answerable: true,
  reason: true,
  failure: true,
  aiCalled: true,
  model: true,
  contextRowCount: true,
} as const;

/** 다시 보기에 읽는 칸 */
export const ASK_HISTORY_DETAIL_SELECT = {
  ...ASK_HISTORY_LIST_SELECT,
  answer: true,
  citations: true,
  lawCitations: true,
  consulted: true,
} as const;

interface OutcomeRow {
  answerable: boolean;
  reason: string | null;
  failure: string | null;
  aiCalled: boolean;
  model: string | null;
  contextRowCount: number;
}

interface ListRow extends OutcomeRow {
  id: string;
  question: string;
  createdAt: Date;
}

interface DetailRow extends ListRow {
  answer: unknown;
  citations: unknown;
  lawCitations: unknown;
  consulted: unknown;
}

export interface AskHistoryItem {
  id: string;
  question: string;
  createdAt: string;
  outcome: AskOutcome;
}

export interface AskHistoryDetail extends AskHistoryItem {
  /** 물은 때의 근거를 남긴 기록인가 — T-218 전 기록이면 false 라 답 본문만 보인다 */
  snapshot: boolean;
  /** 화면이 질문 화면과 같은 모양으로 그릴 답. 답을 받지 못했거나(오류) 처리 중이던 질문은 null */
  result: Omit<AskResult, 'usage'> | null;
}

function isReason(value: string | null): value is AskReason {
  return value !== null && (REASONS as readonly string[]).includes(value);
}

/**
 * 결과 종류. 까닭 칸(T-218)이 있으면 그것을 쓰고, 그 전의 기록은 남은 칸으로 되짚는다 — `ask.service.ts` 의 예약(질문만,
 * aiCalled=true) → 마무리 순서를 따른다. 예약만 남은 행(모델 없음)은 처리 중이거나 처리 도중 끊긴 질문이다.
 */
export function askOutcome(row: OutcomeRow): AskOutcome {
  if (row.answerable) return 'answered';
  if (isReason(row.reason)) return row.reason;
  if (row.failure?.startsWith('refused:')) return 'refused';
  if (row.failure) return 'failed';
  if (!row.aiCalled) return 'no_regulations';
  if (row.model === null) return 'unfinished';
  return row.contextRowCount > 0 ? 'no_basis' : 'no_candidates';
}

const list = <T>(value: unknown): T[] => (Array.isArray(value) ? (value as T[]) : []);

export function toHistoryItem(row: ListRow): AskHistoryItem {
  return { id: row.id, question: row.question, createdAt: row.createdAt.toISOString(), outcome: askOutcome(row) };
}

export function toHistoryDetail(row: DetailRow): AskHistoryDetail {
  const item = toHistoryItem(row);
  const snapshot = row.citations !== null && row.citations !== undefined;
  const consulted = list<AskResult['consulted'][number]>(row.consulted);
  let result: AskHistoryDetail['result'] = null;
  if (item.outcome === 'answered') {
    result = {
      answerable: true,
      blocks: list(row.answer),
      citations: list(row.citations),
      lawCitations: list(row.lawCitations),
      consulted,
    };
  } else if (isReason(item.outcome)) {
    result = { answerable: false, reason: item.outcome, blocks: [], citations: [], lawCitations: [], consulted };
  }
  return { ...item, snapshot, result };
}
