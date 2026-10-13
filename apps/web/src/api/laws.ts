import client from './client';
import type { EffectiveNote } from '../lib/effectiveNotes';

/**
 * 법령 (T-100). 테넌트 공용 — 등록된 법령은 모든 회사가 같이 본다(ADR-0020).
 */
export type Law = {
  id: string;
  sourceId: string;
  externalId: string;
  externalLawId: string | null;
  lawName: string;
  lawNo: string | null;
  lawType: string | null;
  ministry: string | null;
  promulgatedDate: string | null;
  effectiveDate: string | null;
  versionKey: string | null;
  lastCheckedAt: string | null;
  /** 마지막 확인이 실패했으면 사유. null 이면 정상 — "개정 없음"과 "확인 못 함"을 가른다(T-104) */
  lastCheckError: string | null;
  sourceUrl: string | null;
  articleCount: number;
  source?: { code: string; name: string };
};

export type LawArticle = {
  id: string;
  lawId: string;
  nodeKey: string;
  articleNo: number;
  clauseNo: number | null;
  itemNo: number | null;
  label: string;
  title: string | null;
  content: string;
  versionKey: string;
  effectiveDate: string | null;
  /** 조별 시행일 표기(T-144) — null = 아직 읽지 않음, [] = 없음. 항·호 행은 상위 조의 것 */
  effectiveNotes?: EffectiveNote[] | null;
  sortOrder: number;
};

export const lawsApi = {
  list: (): Promise<Law[]> => client.get('/laws').then((r) => r.data),
  get: (id: string): Promise<Law> => client.get(`/laws/${id}`).then((r) => r.data),
  articles: (id: string): Promise<LawArticle[]> => client.get(`/laws/${id}/articles`).then((r) => r.data),
  register: (mst: string, sourceCode?: string): Promise<Law> =>
    client.post('/laws', { mst, ...(sourceCode ? { sourceCode } : {}) }).then((r) => r.data),
  remove: (id: string): Promise<{ ok: true }> => client.delete(`/laws/${id}`).then((r) => r.data),
};

/** 법령 동기화 1회 결과 중 법령 1건 (T-104) */
export type LawSyncResult = {
  lawId: string;
  lawName: string;
  outcome: 'unchanged' | 'updated' | 'failed';
  fromMst: string;
  toMst?: string;
  events?: number;
  error?: string;
  note?: string;
};

export type LawSyncRun = {
  id: string;
  trigger: 'schedule' | 'manual';
  status: 'running' | 'succeeded' | 'partial' | 'failed';
  triggeredBy: string | null;
  startedAt: string;
  finishedAt: string | null;
  checkedCount: number;
  changedCount: number;
  eventCount: number;
  failedCount: number;
  results: LawSyncResult[] | null;
  error: string | null;
};

/** 법령 동기화 — 플랫폼 관리자 전용. 예약 실행은 서버 cron(CLI)이 한다 */
export const lawSyncApi = {
  runs: (limit = 10): Promise<LawSyncRun[]> =>
    client.get('/platform-admin/law-sync/runs', { params: { limit } }).then((r) => r.data),
  run: (limit?: number): Promise<LawSyncRun> =>
    client.post('/platform-admin/law-sync/run', limit ? { limit } : {}).then((r) => r.data),
};
