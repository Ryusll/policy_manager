import { useCallback, useLayoutEffect, useState } from 'react';
import type { QueryClient } from '@tanstack/react-query';
import { useClearStaleOnReceive, useToolStatus, type ToolStatus, type ToolStatusKind } from './toolStatus';

/*
 * 조문 배너(T-224 단계 B, 설계 E2) — 분절 보기에서 고른 조문 위의 알림 띠. 판 쓰기의 결과는 시작한 화면이든 같은 규정을 다시 그린
 * 화면이든 그 조문을 보고 있으면 여기에 보인다(도구 줄은 화면 위라 판 목록에서 멀다). 아니면 도구 줄·이름 붙은 알림으로 간다
 * (lib/policyWrite). 상태는 도구 줄과 같은 규칙(lib/toolStatus — 실패는 남기고 같은 작업이 성공하면 걷고, 받기 실패는 그 조회를 받으면
 * 걷힌다)이되, 성공도 닫거나 조문을 바꿀 때까지 남는다(전부터 이 띠는 저절로 사라지지 않았다).
 */

type Entry = { status: ToolStatus; shown: boolean };
const banners = new Map<string, Entry>();
const keyOf = (policyId: string, articleId: string) => `${policyId}:${articleId}`;

/** 지금 그 규정의 그 조문을 분절 보기로 보이는 화면의 배너(없거나 보이지 않으면 undefined) — 결과를 보낼 자리 */
export const bannerFor = (policyId: string, articleId: string | undefined): ToolStatus | undefined => {
  const e = articleId ? banners.get(keyOf(policyId, articleId)) : undefined;
  return e?.shown ? e.status : undefined;
};

/** 그 규정·그 조문의 배너(보이지 않는 것까지) — 반영된 결과가 다른 자리로 갈 때 그 조문의 옛 글을 비운다 */
export const bannerOf = (policyId: string, articleId: string | undefined): ToolStatus | undefined =>
  articleId ? banners.get(keyOf(policyId, articleId))?.status : undefined;

/** 그 규정의 화면이 들고 있는 배너 모두(보이지 않는 것까지) — 같은 판이 성공하면 다른 자리에 남은 그 판의 옛 줄도 걷는다(B1 검토) */
export const bannersOf = (policyId: string): ToolStatus[] =>
  [...banners.entries()].filter(([k]) => k.startsWith(`${policyId}:`)).map(([, e]) => e.status);

export function registerBanner(policyId: string, articleId: string, status: ToolStatus, shown = true): () => void {
  const key = keyOf(policyId, articleId);
  const entry: Entry = { status, shown };
  banners.set(key, entry);
  return () => {
    if (banners.get(key) === entry) banners.delete(key);
  };
}

/**
 * 고른 조문의 배너 상태 — 조문을 고른 동안 등록부에 걸고, shown(분절 보기에 그 조문의 띠 자리가 보인다)일 때만 결과를 받는다(전문
 * 보기에서는 들고만 있어 같은 판의 성공이 옛 줄을 걷을 수 있다). 조문을 바꾸면(목차·주소 이동·조 순서 저장 뒤 고름 풀림 모두)
 * 걷는다 — 다른 조문의 결과가 남지 않게. close 는 늘 같은 함수다.
 */
export function useArticleBanner(qc: QueryClient, policyId: string | undefined, articleId: string | undefined, shown: boolean) {
  const [message, setMessage] = useState('');
  const [kind, setKind] = useState<ToolStatusKind>('info');
  const keep = useCallback((m: string) => setMessage(m), []);
  const status = useToolStatus(setMessage, keep, setKind);
  useClearStaleOnReceive(qc, status);
  useLayoutEffect(() => {
    status.clear();
  }, [articleId, status]);
  useLayoutEffect(
    () => (policyId && articleId ? registerBanner(policyId, articleId, status, shown) : undefined),
    [shown, policyId, articleId, status],
  );
  return { message, kind, close: status.clear };
}
