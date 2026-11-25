/**
 * 무료 제공사 묶음(freellmapi) 호출의 순수 도우미와 기본 허용 목록 — VEDA T-208, ADR-0028. DB·네트워크를 부르지 않는다.
 */

/**
 * 기본 허용 모델 — freellmapi 카탈로그 지능 순위 상위(2026-10-19 스냅숏, r25~r41). 바꿀 때는 `AI_QA_MODELS`.
 * freellmapi 의 공통 이름(같은 모델을 여러 제공사가 줄 때 묶는 이름)으로 부른다 — 답한 곳 표시는 제공사 이름
 * (`groq/qwen/qwen3.8-27b`)으로 오므로 마지막 경로 조각끼리 견준다(`baseModel`).
 */
export const FREE_DEFAULT_MODELS = ['gemini-3.8-flash', 'gemini-3.7-flash', 'gemini-3.6-flash', 'gemini-3.5-flash', 'qwen3.8-27b'];

/** 'qwen/qwen3.8-27b'·'@cf/qwen/qwen3.8-27b' → 'qwen3.8-27b' */
export const baseModel = (id: string) => id.split('/').pop()?.trim().toLowerCase() ?? '';

/** 기본 허용 제공사 — 고지 판 2 에 적은 곳(`AI_QA_ALLOWED_PLATFORMS`) */
export const FREE_DEFAULT_PLATFORMS = ['google', 'groq'];

/** 코드 펜스·앞뒤 군말이 붙어 와도 가장 바깥 JSON 객체를 읽는다. 못 읽으면 undefined */
export function parseJsonLoose(text: string): unknown {
  let t = text.trim();
  const fence = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(t);
  if (fence) t = fence[1].trim();
  try {
    return JSON.parse(t);
  } catch {
    // 아래에서 가장 바깥 중괄호만 다시 읽어 본다 — 그래도 안 되면 undefined(형식 미달)로 알린다
  }
  const a = t.indexOf('{');
  const b = t.lastIndexOf('}');
  if (a < 0 || b <= a) return undefined;
  try {
    return JSON.parse(t.slice(a, b + 1));
  } catch {
    return undefined;
  }
}

export const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

/** OpenAI 형식 오류 본문의 `error.code` — 없거나 JSON 이 아니면 빈 값 */
export function errorCode(body: string): string {
  const parsed = parseJsonLoose(body) as { error?: { code?: unknown } } | undefined;
  return typeof parsed?.error?.code === 'string' ? parsed.error.code : '';
}
