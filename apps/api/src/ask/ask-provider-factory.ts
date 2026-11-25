import { readFileSync } from 'fs';
import { Logger } from '@nestjs/common';
import { AnthropicAskProvider, type AskProvider } from './ask-provider';
import { MockAskProvider } from './ask-mock-provider';
import { FREE_DEFAULT_MODELS, FREE_DEFAULT_PLATFORMS, OpenAiCompatAskProvider } from './ask-openai-compat';
import { askProviderKind } from './ask-provider-kind';

/**
 * 서버 설정으로 규정 질문의 AI 제공사를 만든다 (T-208, ADR-0028). 설정이 없으면 null — 메뉴를 숨기고 "아스트룸에 문의".
 *
 * 무료 제공사(freellmapi)의 환경변수
 * - `AI_QA_BASE_URL` — OpenAI 호환 주소(`/v1` 까지). 기본은 같은 compose 의 내부 주소 `http://freellmapi:3001/v1`
 * - `AI_QA_API_KEY` 또는 `AI_QA_API_KEY_FILE` — freellmapi 통합 키. 파일은 freellmapi 가 뜰 때 내부 볼륨에 쓴다
 *   (`scripts/freellm/freellm-init.mjs`) — 사람이 대시보드에서 옮겨 적지 않게
 * - `AI_QA_MODELS` — 허용 모델(쉼표, 앞에서부터 쓴다), `AI_QA_ALLOWED_PLATFORMS` — 허용 제공사
 */

const log = new Logger('AskProvider');

function listFrom(raw: string | undefined, fallback: string[]): string[] {
  const items = (raw ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return items.length ? items : fallback;
}

/** 통합 키 — 값이 있으면 그것, 없으면 파일. 읽지 못하면 빈 값(부르는 쪽이 "키가 아직 준비되지 않았다"로 알린다) */
export function readApiKey(env: NodeJS.ProcessEnv): string {
  const direct = env.AI_QA_API_KEY?.trim();
  if (direct) return direct;
  const file = env.AI_QA_API_KEY_FILE?.trim();
  if (!file) return '';
  try {
    return readFileSync(file, 'utf8').trim();
  } catch (e) {
    log.warn(`통합 키 파일을 읽지 못함(${(e as NodeJS.ErrnoException)?.code ?? 'unknown'}) — freellmapi 가 떴는지 본다`);
    return '';
  }
}

export function createAskProvider(env: NodeJS.ProcessEnv = process.env): AskProvider | null {
  const kind = askProviderKind(env);
  if (kind === 'mock') return new MockAskProvider();
  if (kind === 'anthropic') return new AnthropicAskProvider(env.ANTHROPIC_API_KEY!.trim());
  if (kind === 'freellmapi') {
    // 허용 제공사는 고지 판 2 에 적은 곳(Google·Groq) 안에서만 좁힐 수 있다 — 환경변수로 고지 밖 제공사를 열지 못하게
    const asked = listFrom(env.AI_QA_ALLOWED_PLATFORMS, FREE_DEFAULT_PLATFORMS);
    const platforms = asked.filter((p) => FREE_DEFAULT_PLATFORMS.includes(p));
    if (platforms.length < asked.length) log.warn('AI_QA_ALLOWED_PLATFORMS 의 고지 밖 제공사는 쓰지 않는다(google·groq 만)');
    // 모델은 이름을 직접 준다 — auto·fusion 은 허용 목록 밖 모델까지 고르므로 버린다
    const models = listFrom(env.AI_QA_MODELS, FREE_DEFAULT_MODELS).filter((m) => !/^(auto|fusion)(:|$)/i.test(m));
    return new OpenAiCompatAskProvider({
      baseUrl: (env.AI_QA_BASE_URL?.trim() || 'http://freellmapi:3001/v1').replace(/\/+$/, ''),
      apiKey: () => readApiKey(env),
      models: models.length ? models : FREE_DEFAULT_MODELS,
      allowedPlatforms: platforms.length ? platforms : FREE_DEFAULT_PLATFORMS,
    });
  }
  const raw = env.AI_QA_PROVIDER?.trim();
  if (raw && raw.toLowerCase() !== 'anthropic') log.warn(`AI_QA_PROVIDER 값(${raw})을 알 수 없어 규정 질문을 끈 채로 둔다`);
  return null;
}
