import client from './client';

/** 검토 표의 판단 — 서버가 이 여섯 값으로 맞춰 보낸다(T-207, SEARCH-7) */
export type AskVerdict = '부합' | '대체로 부합' | '부분 부합' | '보완 필요' | '추가 확인 필요' | '해당 없음';

export interface AskReviewRow {
  area: string;
  law: string;
  current: string;
  verdict: AskVerdict;
  advice: string;
}

/**
 * T-130 규정 근거 AI 질의응답의 답 블록. T-207 부터 답은 늘 [직답 문단, 검토 표, 우선 권고(또는 핵심 정리), 종합 의견 문단,
 * 근거 요약 문단] 순서다. 문단의 굵게는 `**` 짝으로만 온다. list·table 은 T-207 전 모양이다.
 */
export type AskBlock =
  | { type: 'paragraph'; text: string }
  | { type: 'list'; items: string[] }
  | { type: 'table'; headers: string[]; rows: string[][] }
  | { type: 'review'; rows: AskReviewRow[] }
  | { type: 'priorities'; kind: 'amend' | 'summary'; items: { title: string; detail: string }[] };

/** 답에 쓴 법령 근거(T-209) — 회사가 확정한 법령 연결의 오늘 시행 중 문구(AI 가 옮긴 글이 아님) */
export interface AskLawCitation {
  ref: string;
  lawId: string;
  lawName: string;
  lawArticleId: string;
  label: string;
  title: string | null;
  content: string;
  /** 가장 먼저 시행될 예정 개정의 시행일 */
  scheduledOn: string | null;
}

export interface AskCitation {
  ref: string;
  articleId: string;
  policyId: string;
  policyTitle: string;
  policyCode: string;
  label: string;
  joTitle: string;
  number: number;
  branchNumber: number | null;
  clauseNumber: number | null;
  itemNumber: number | null;
  /** DB 의 시행 중 본문(AI 가 옮긴 글이 아님) */
  content: string;
}

export interface AskResult {
  answerable: boolean;
  reason?: 'no_regulations' | 'no_candidates' | 'no_basis' | 'refused';
  blocks: AskBlock[];
  citations: AskCitation[];
  lawCitations: AskLawCitation[];
  consulted: { policyId: string; policyTitle: string; number: number; branchNumber: number | null; label: string }[];
  usage: { used: number; limit: number; userUsed: number; userLimit: number };
}

/** 외부 전송 고지 — 서버가 내려 준 그대로 그린다. 켤 때 `version` 을 함께 보낸다(T-146) */
export interface AiQaNotice {
  version: number;
  recipient: string;
  country: string;
  sent: string[];
  notSent: string;
  retention: string[];
  training: string;
  control: string;
  caution: string;
  /** 질문 화면 아래 한 줄 요약 */
  summary: string;
  /** 관리자가 체크하는 동의 문장 — 판에 묶여 있다 */
  consentStatement: string;
}

export interface AskStatus {
  /** 서버에 AI 가 설정돼 있는가 */
  configured: boolean;
  provider: 'anthropic' | 'freellmapi' | 'mock' | null;
  /** 실제로 켜져 있는가 — 관리자가 지금 판의 고지를 확인하고 켰을 때만 true */
  enabled: boolean;
  /** 켜 두었지만 고지가 바뀌어 관리자가 다시 확인해야 한다(그동안 꺼진 것과 같다) */
  needsConsent: boolean;
  notice: AiQaNotice;
  /** 마지막으로 확인한 고지 판과 시각 */
  consent: { noticeVersion: number; consentedAt: string | null } | null;
  /** 이번 달 회사 전체 사용량·한도 */
  used: number;
  limit: number;
  /** 이번 달 내 사용량·한도(한 사람이 회사 한도를 다 쓰지 못하게) */
  userUsed: number;
  userLimit: number;
}

/** 답을 그리는 데 쓰는 칸(사용량 빼고) — 질문 응답과 지난 질문 다시 보기가 같은 모양이다 */
export type AskAnswerResult = Omit<AskResult, 'usage'>;

/** 질문 응답 — 답과 물을 때 고른 범위(그때의 이름·코드, 비었으면 회사 전체, T-219) */
export interface AskResponse extends AskResult {
  scope: AskScopePolicy[];
  /** 이 질문의 기록 — 이어 물을 때 다음 질문의 parentId(T-220) */
  id: string;
  parentId: string | null;
}

/** 지난 질문의 결과 종류(T-218). failed 는 오류로 답을 받지 못함, unfinished 는 처리 중이었거나 도중에 끊김 */
export type AskOutcome = 'answered' | NonNullable<AskResult['reason']> | 'failed' | 'unfinished';

/** 물을 때 고른 규정(T-219) — 그때의 이름·코드 그대로 */
export interface AskScopePolicy {
  id: string;
  title: string;
  code: string;
}

export interface AskHistoryItem {
  id: string;
  question: string;
  createdAt: string;
  outcome: AskOutcome;
  /** 이어 물은 질문이면 앞 질문의 기록 id(T-220) */
  parentId: string | null;
}

export interface AskHistoryPage {
  items: AskHistoryItem[];
  /** 다음 쪽을 받을 때 넘긴다 — 없으면 끝 */
  nextCursor: string | null;
}

export interface AskHistoryDetail extends AskHistoryItem {
  /** 물을 때 고른 범위(T-219) — 그때의 이름·코드 그대로, 비었으면 회사 전체에서 물었다 */
  scope: AskScopePolicy[];
  /** 앞 질문(T-220) — 이어 물은 질문이 아니거나 앞 질문이 보관 기간을 넘겨 지워졌으면 null */
  parent: { id: string; question: string } | null;
  /** 물은 때의 근거를 남긴 기록인가 — 아니면 답 본문만 있다 */
  snapshot: boolean;
  /** 질문 화면과 같은 모양의 답. 오류·처리 중이던 질문은 null */
  result: AskAnswerResult | null;
}

export const askApi = {
  status: (): Promise<AskStatus> => client.get('/ask/status').then((r) => r.data),
  /** 내 지난 질문(T-218) — 최신순, 보관 기간(90일) 안 */
  history: (cursor?: string | null): Promise<AskHistoryPage> =>
    client.get('/ask/history', { params: cursor ? { cursor } : {} }).then((r) => r.data),
  historyItem: (id: string): Promise<AskHistoryDetail> => client.get(`/ask/history/${id}`).then((r) => r.data),
  /**
   * policyIds(T-219) — 고른 규정 안에서만 찾는다. 비우면 회사 전체.
   * parentId(T-220) — 앞 질문의 답에 이어 묻는다(그 답의 근거 조문을 이어받는다).
   */
  ask: (question: string, policyIds: string[] = [], parentId?: string | null): Promise<AskResponse> =>
    client
      .post('/ask', { question, ...(policyIds.length ? { policyIds } : {}), ...(parentId ? { parentId } : {}) })
      .then((r) => r.data),
  /** 켤 때는 관리자가 확인한 고지 판을 함께 보낸다 — 지금 판이 아니면 400 AI_QA_NOTICE_REQUIRED */
  setEnabled: (enabled: boolean, noticeVersion?: number): Promise<AskStatus> =>
    client.patch('/ask/settings', { enabled, ...(noticeVersion ? { noticeVersion } : {}) }).then((r) => r.data),
};
