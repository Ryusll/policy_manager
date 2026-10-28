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

/** 법령 판 하나(T-150) — 판 기록이 없는 옛 변경은 id·mst 가 null 이고 시행일만 있다 */
export type LawVersionSummary = {
  id: string | null;
  mst: string | null;
  lawType: string | null;
  promulgationNo: string | null;
  promulgatedDate: string | null;
  revisionType: string | null;
  effectiveDate: string | null;
  stageEffectiveDates: string[];
};

/** 조항에 가장 먼저 시행될 예정 변경(T-150) */
export type LawScheduledChange = {
  eventId: string;
  changeType: 'created' | 'modified' | 'deleted';
  /** 시행일부터의 문구 — 삭제면 null */
  content: string | null;
  effectiveDate: string;
  versionId: string | null;
  /** 이어서 시행될 예정 변경이 더 있다 */
  laterCount: number;
};

/** 오늘 시행 중인 문구로 본 법령조항 — 시행일에 신설될 조항은 content 가 null */
export type LawInForceArticle = Omit<LawArticle, 'content' | 'lawId' | 'versionKey' | 'effectiveDate'> & {
  content: string | null;
  scheduled: LawScheduledChange | null;
};

export type LawInForce = {
  today: string;
  current: LawVersionSummary | null;
  scheduled: Array<LawVersionSummary & { changeCount: number }>;
  articles: LawInForceArticle[];
};

export const lawsApi = {
  list: (): Promise<Law[]> => client.get('/laws').then((r) => r.data),
  get: (id: string): Promise<Law> => client.get(`/laws/${id}`).then((r) => r.data),
  articles: (id: string): Promise<LawArticle[]> => client.get(`/laws/${id}/articles`).then((r) => r.data),
  /** 현행 본문과 시행 예정 변경(T-150) — 조항 본문(articles)은 마지막 반영 판의 것이라 시행 전 문구일 수 있다 */
  inForce: (id: string): Promise<LawInForce> => client.get(`/laws/${id}/in-force`).then((r) => r.data),
  /**
   * alreadyTracked — 같은 법령을 이미 다른 판으로 추적 중이라 새로 만들지 않고 그 법령을 돌려줬다(T-151).
   * requestedMst — 요청한 판이 현행이 아니라 현행 판으로 등록했다(T-150). 시행 예정 판은 다음 동기화가 변경으로 받는다
   */
  register: (mst: string, sourceCode?: string): Promise<Law & { alreadyTracked?: boolean; requestedMst?: string }> =>
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
  /** 이번에 반영한 판들(공포 순, T-151) — 두 확인 사이에 판이 여럿 공포되면 하나씩 차례로 반영한다 */
  versions?: LawSyncedVersion[];
  /** 반영하지 못하고 남은 판 수 — 다음 동기화가 잇는다 */
  remaining?: number;
};

export type LawSyncedVersion = {
  mst: string;
  /** '제21533호(2026-04-07 공포)' */
  label: string;
  promulgationDate: string | null;
  revisionType: string | null;
  stageEffectiveDates: string[];
  events: number;
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
