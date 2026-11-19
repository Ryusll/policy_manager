import type { AskReason, AskResult } from './ask.service';
import type { AskScopePolicy } from './ask-candidates';

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
  parentId: true,
} as const;

/** 다시 보기에 읽는 칸 */
export const ASK_HISTORY_DETAIL_SELECT = {
  ...ASK_HISTORY_LIST_SELECT,
  answer: true,
  citations: true,
  lawCitations: true,
  consulted: true,
  scope: true,
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
  parentId: string | null;
}

interface DetailRow extends ListRow {
  scope: unknown;
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
  /** 이어 물은 질문이면 앞 질문의 기록 id(T-220) — 앞 질문이 지워졌어도 남는다 */
  parentId: string | null;
}

/** 이어 물은 앞 질문 — 보관 기간 안에 남아 있을 때만 */
export interface AskParentQuestion {
  id: string;
  question: string;
}

export interface AskHistoryDetail extends AskHistoryItem {
  /** 앞 질문(T-220) — 이어 물은 질문이 아니거나 앞 질문이 보관 기간을 넘겨 지워졌으면 null */
  parent: AskParentQuestion | null;
  /** 물을 때 고른 범위 — 그때의 이름·코드 그대로, 비었으면 회사 전체에서 물었다(T-219). 목록에는 싣지 않는다 */
  scope: AskScopePolicy[];
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

/** 기록에 남긴 범위 — 모양이 맞는 것만(물은 때의 이름·코드). 범위 칸 전의 기록은 빈 배열(회사 전체) */
export function scopeOf(value: unknown): AskScopePolicy[] {
  return list<Record<string, unknown> | null>(value).flatMap((p) =>
    p && typeof p.id === 'string' && typeof p.title === 'string' && typeof p.code === 'string'
      ? [{ id: p.id, title: p.title, code: p.code }]
      : [],
  );
}

export function toHistoryItem(row: ListRow): AskHistoryItem {
  return {
    id: row.id,
    question: row.question,
    createdAt: row.createdAt.toISOString(),
    outcome: askOutcome(row),
    parentId: row.parentId ?? null,
  };
}

export function toHistoryDetail(row: DetailRow, parent: AskParentQuestion | null = null): AskHistoryDetail {
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
  return { ...item, parent, scope: scopeOf(row.scope), snapshot, result };
}
