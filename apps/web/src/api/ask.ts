import client from './client';

/** T-130 규정 근거 AI 질의응답 */
export type AskBlock =
  | { type: 'paragraph'; text: string }
  | { type: 'list'; items: string[] }
  | { type: 'table'; headers: string[]; rows: string[][] };

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
  consulted: { policyId: string; policyTitle: string; number: number; branchNumber: number | null; label: string }[];
  usage: { used: number; limit: number; userUsed: number; userLimit: number };
}

export interface AskStatus {
  /** 서버에 AI 가 설정돼 있는가 */
  configured: boolean;
  provider: 'anthropic' | 'mock' | null;
  /** 회사 관리자가 켜 두었는가 */
  enabled: boolean;
  /** 이번 달 회사 전체 사용량·한도 */
  used: number;
  limit: number;
  /** 이번 달 내 사용량·한도(한 사람이 회사 한도를 다 쓰지 못하게) */
  userUsed: number;
  userLimit: number;
}

export const askApi = {
  status: (): Promise<AskStatus> => client.get('/ask/status').then((r) => r.data),
  ask: (question: string): Promise<AskResult> => client.post('/ask', { question }).then((r) => r.data),
  setEnabled: (enabled: boolean): Promise<AskStatus> => client.patch('/ask/settings', { enabled }).then((r) => r.data),
};
