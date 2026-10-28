import client from './client';
import type { EventEffectiveNotes } from '../lib/effectiveNotes';
import type { LawRelationType } from './lawLinks';
import type { AmendmentCandidate } from './amendments';

/**
 * 법령 변경 이벤트와 우리 회사 영향 (T-105).
 * 이벤트는 모든 회사가 함께 쓰는 데이터지만, `impact` 는 **우리 회사 연결만** 센다.
 */
export type LawChangeType = 'created' | 'modified' | 'deleted';

export const CHANGE_TYPE_LABEL: Record<LawChangeType, string> = {
  created: '신설',
  modified: '변경',
  deleted: '삭제',
};

export const RECEIVED_VIA_LABEL: Record<string, string> = {
  poll: '자동 확인',
  manual: '직접 등록',
  webhook: '외부 통지',
};

export type LawChangeEvent = {
  id: string;
  lawId: string;
  lawName: string;
  lawArticleId: string | null;
  nodeKey: string;
  label: string;
  changeType: LawChangeType;
  beforeContent: string | null;
  afterContent: string | null;
  promulgatedDate: string | null;
  lawEffectiveDate: string | null;
  /** 이 변경을 만든 판(T-150) — "법률 제21700호". 판 기록 전(T-151 전) 변경은 null */
  version?: { lawType: string | null; promulgationNo: string | null } | null;
  /** 조별로 다른 시행일 표기(T-144) — 계획용 날짜(lawEffectiveDate)는 그대로. 없으면 null */
  effectiveNotes?: EventEffectiveNotes | null;
  receivedVia: string;
  detectedAt: string;
};

export type LawChangeListItem = LawChangeEvent & {
  impact: { confirmed: number; suggested: number };
};

export type ImpactedArticle = {
  linkId: string;
  /** 연결이 걸린 법령조항과 그 표기(예: 제60조). 바뀐 조항의 위 조항(조·항)에 건 연결로 찾았으면 viaParent(T-148) */
  linkLawArticleId: string;
  linkLabel: string;
  viaParent: boolean;
  relationType: LawRelationType;
  scope: string | null;
  evidenceText: string | null;
  confirmedAt: string | null;
  policy: { id: string; code: string; title: string; isActive: boolean };
  article: { id: string; number: number; clauseNumber: number | null; itemNumber: number | null; title: string };
  /** 제1 조문 — 기준일에 시행 중인 발행 버전. 없으면 개정 후보를 만들 수 없다 */
  baseVersion: {
    id: string;
    versionNum: number;
    status: string;
    effectiveDate: string | null;
    content: string;
  } | null;
  /** 제1 조문이 없는 이유 — 시행일 미기록(가져온 규정, 보정하면 풀림) / 기준일에 시행 중인 본문 없음 / 기준일에 폐지됨(T-126) */
  skipReason: 'not_in_force' | 'effective_date_missing' | 'repealed' | null;
  /** 기준일에 폐지돼 있으면 그 폐지 시행일 (YYYY-MM-DD) */
  repealedOn: string | null;
  /** 이 변경으로 만든 개정 후보(T-106). isCurrentBase 가 false 면 그 뒤 기준 본문이 바뀌었다 */
  candidate: (AmendmentCandidate & { isCurrentBase: boolean }) | null;
};

export type LawImpact = {
  event: LawChangeEvent;
  /** 영향 분석 기준일 (YYYY-MM-DD) */
  asOf: string;
  impacted: ImpactedArticle[];
  /** 확정 안 된(추천) 연결 수 — 영향에 넣지 않는다 */
  suggestedCount: number;
  /** 영향을 찾을 수 없는 사유(법령에서 사라진 조문 등) */
  unresolvable: string | null;
};

export const lawChangesApi = {
  list: (params: { lawId?: string; affected?: boolean; limit?: number }): Promise<LawChangeListItem[]> =>
    client.get('/law-changes', { params }).then((r) => r.data),
  impact: (id: string, asOf?: string): Promise<LawImpact> =>
    client.get(`/law-changes/${id}/impact`, { params: asOf ? { asOf } : undefined }).then((r) => r.data),
};
