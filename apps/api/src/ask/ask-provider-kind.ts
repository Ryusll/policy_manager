/**
 * 규정 질문의 AI 제공사를 서버 설정으로 고른다 (T-208, SRS SEARCH-6·8, ADR-0028).
 *
 * - `AI_QA_PROVIDER=freellmapi` — 무료 제공사 묶음(같은 compose 의 내부 컨테이너)
 * - `AI_QA_PROVIDER=anthropic` 또는 비움 — `ANTHROPIC_API_KEY` 가 있을 때만 Anthropic
 * - `AI_QA_PROVIDER=mock` — 통합 시험용 모의 AI
 * 모르는 값은 "설정 안 됨"으로 본다 — 오타 하나로 고지와 다른 곳에 보내지 않게.
 * 외부 전송 고지의 판도 이 값을 따른다(`ask-notice.ts`) — 제공사가 바뀌면 관리자가 다시 확인해야 켜진다.
 */
export type AskProviderKind = 'anthropic' | 'freellmapi' | 'mock';

export function askProviderKind(env: NodeJS.ProcessEnv = process.env): AskProviderKind | null {
  const p = env.AI_QA_PROVIDER?.trim().toLowerCase() ?? '';
  if (p === 'mock') return 'mock';
  if (p === 'freellmapi') return 'freellmapi';
  if (p === '' || p === 'anthropic') return env.ANTHROPIC_API_KEY?.trim() ? 'anthropic' : null;
  return null;
}
