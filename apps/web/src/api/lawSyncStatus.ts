import client from './client';

/**
 * 법령 동기화 멈춤 경고(T-153 ④) — 마지막 성공 실행이 36시간을 넘었는지 서버가 읽을 때 계산한다. 플랫폼 관리자 화면은
 * `/platform-admin/law-sync/status`, 법령 화면은 `/laws/sync-status`(시각과 참·거짓뿐)를 부른다.
 */
export type LawSyncStatus = {
  /** 마지막 성공 실행이 끝난 시각(ISO), 없으면 null */
  lastSuccessAt: string | null;
  /** 36시간을 넘었는지 — 성공 실행이 한 번도 없으면 false */
  stale: boolean;
  everSucceeded: boolean;
  staleAfterHours: number;
};

export const LAW_SYNC_STATUS_KEY = { platform: ['law-sync', 'status'] as const, laws: ['laws', 'sync-status'] as const };

export const lawSyncStatusApi = {
  platform: () => client.get<LawSyncStatus>('/platform-admin/law-sync/status').then((r) => r.data),
  laws: () => client.get<LawSyncStatus>('/laws/sync-status').then((r) => r.data),
};
