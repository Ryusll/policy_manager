import { BadGatewayException, Logger, ServiceUnavailableException } from '@nestjs/common';
import {
  ASK_FORMAT_FAILED,
  AskBadResponseError,
  AskRefusedError,
  SELECT_SCHEMA,
  SELECT_SYSTEM,
  selectKeys,
  type AiUsage,
  type AnswerAcceptor,
  type AskProvider,
} from './ask-provider';
import { REPORT_SCHEMA, REPORT_SYSTEM } from './ask-report-prompt';
import { baseModel, errorCode, num, parseJsonLoose } from './ask-openai-util';

export { FREE_DEFAULT_MODELS, FREE_DEFAULT_PLATFORMS } from './ask-openai-util';

/**
 * T-208 무료 AI 제공사 묶음(freellmapi) — OpenAI 호환 `/chat/completions` 를 내장 fetch 로 부른다(SRS SEARCH-8, ADR-0028).
 *
 * - **허용 모델만**: `models` 를 차례로 직접 지정한다. 'auto' 는 쓰지 않는다 — 학습용 기록을 남기는 키 없는 제공사까지
 *   후보가 된다. 한도(429)·모델 없음(404·503)·오류·시간 초과·형식 미달이면 다음 모델로 가고, 모두 실패해도 목록 밖의
 *   약한 모델로 내리지 않는다.
 * - **허용 제공사만**: 응답의 `X-Routed-Via: <제공사>/<모델>` 의 제공사가 허용 목록 밖이면 답을 버리고 더 보내지 않는다 —
 *   설정이 어긋난 것이라 계속 보내면 고지에 없는 곳으로 더 나간다. 모델만 목록 밖이면 그 답만 버리고 다음 모델로 간다.
 * - **다시 보내기 전 회사 확인(T-146)**: 두 번째 모델부터 보내기 직전마다 `beforeRetry` 를 부른다 — 던지면 그대로 올린다.
 * - 질문·본문·답은 로그에 남기지 않는다(컨테이너 로그는 질문 기록의 90일 파기 밖이다) — 모델 이름·상태·사유만 남긴다.
 */

export interface OpenAiCompatConfig {
  /** `/v1` 까지(끝의 `/` 없이) */
  baseUrl: string;
  /** 부를 때마다 읽는다 — 통합 키 파일이 api 보다 늦게 생겨도 다시 띄우지 않고 쓰게 */
  apiKey: () => string;
  models: string[];
  /** 허용 제공사 — null 이면 `X-Routed-Via` 를 보지 않는다(제공사를 알려 주지 않는 일반 OpenAI 호환 주소) */
  allowedPlatforms: string[] | null;
  timeoutMs?: { select: number; answer: number };
  /** 한 단계 안에서 모델을 바꿔 가며 쓰는 시간 상한 — 웹 서버의 질문 대기(180초) 안에 두 단계가 끝나게 */
  budgetMs?: { select: number; answer: number };
  fetchImpl?: typeof fetch;
  now?: () => number;
}

type Step = 'select' | 'answer';
type Tokens = Omit<AiUsage, 'model'>;
type Attempt =
  | { kind: 'ok'; raw: unknown; tokens: Tokens; servedBy: string }
  | {
      kind: 'auth' | 'offlist' | 'limit' | 'unavailable' | 'error' | 'format' | 'refused' | 'schema-unsupported';
      reason: string;
      tokens?: Tokens;
      servedBy?: string;
    };

/** 서버 설정 문제 — 회사 관리자가 고칠 수 없어 아스트룸에 묻게 한다 */
const SETUP_PENDING = 'AI 연결 설정(키)이 아직 준비되지 않았습니다. 아스트룸에 문의해 주세요.';

export class OpenAiCompatAskProvider implements AskProvider {
  readonly name = 'freellmapi' as const;
  private readonly log = new Logger('AskFreeLlm');
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;
  private readonly timeoutMs: { select: number; answer: number };
  private readonly budgetMs: { select: number; answer: number };
  /** 허용 밖 제공사가 답한 뒤 이 시각까지는 보내지 않는다 — freellmapi 의 10분 재점검이 그 키를 끌 때까지(H3) */
  private blockedUntil = 0;

  constructor(private readonly cfg: OpenAiCompatConfig) {
    this.fetchImpl = cfg.fetchImpl ?? fetch;
    this.now = cfg.now ?? Date.now;
    // 두 단계의 상한 합(30+110초)에 법령 읽기·회사 확인을 더해도 웹 서버의 질문 대기(180초) 안이다 — 보낼 때마다(같은 모델에
    // 다시 보낼 때도) 남은 시간 안으로 줄여 보낸다
    this.timeoutMs = cfg.timeoutMs ?? { select: 25_000, answer: 90_000 };
    this.budgetMs = cfg.budgetMs ?? { select: 30_000, answer: 110_000 };
  }

  async select(input: { toc: string; question: string }, beforeRetry?: () => Promise<void>) {
    try {
      const res = await this.call(
        'select',
        `${SELECT_SYSTEM}\n\n<목차>\n${input.toc}\n</목차>`,
        `질문: ${input.question}`,
        { name: 'veda_select', schema: SELECT_SCHEMA },
        beforeRetry,
        (raw) => Array.isArray((raw as { keys?: unknown } | null)?.keys),
      );
      return { keys: selectKeys(res.raw), usage: res.usage };
    } catch (e) {
      // 고르기 답이 모든 모델에서 형식 미달이면 빈 목록으로 이어 간다 — 질문 낱말로 찾은 조가 대신 남는다(Anthropic 과 같게)
      if (!(e instanceof AskBadResponseError)) throw e;
      this.log.warn('AI select: 고르기 답이 형식 미달 — 질문 낱말로 찾은 조로 이어 간다');
      return { keys: [], usage: e.usage };
    }
  }

  answer(input: { context: string; question: string }, beforeRetry?: () => Promise<void>, accept?: AnswerAcceptor) {
    return this.call(
      'answer',
      REPORT_SYSTEM,
      `${input.context}\n\n질문: ${input.question}`,
      { name: 'veda_report', schema: REPORT_SCHEMA },
      beforeRetry,
      accept,
    );
  }

  private async call(
    step: Step,
    system: string,
    user: string,
    format: { name: string; schema: Record<string, unknown> },
    beforeRetry?: () => Promise<void>,
    accept?: AnswerAcceptor,
  ): Promise<{ raw: unknown; usage: AiUsage }> {
    if (this.now() < this.blockedUntil) {
      throw new ServiceUnavailableException('AI 연결 설정을 점검해야 합니다. 아스트룸에 문의해 주세요.');
    }
    const key = this.cfg.apiKey();
    if (!key) throw new ServiceUnavailableException(SETUP_PENDING);
    const started = this.now();
    const total: Tokens = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0 };
    const kinds: Attempt['kind'][] = [];
    const notes: string[] = [];
    // 근거 번호가 맞지 않은 답 — 다음 모델로 다시 받되, 더 나은 답이 없으면 쓴다('last-resort')
    let fallback: { raw: unknown; servedBy: string } | null = null;
    let sent = false;
    // 보내기 직전: 첫 전송은 가드가 이미 회사 상태를 봤다. 그 뒤로는(같은 모델에 JSON 모드로 다시 보낼 때도) 보내기 직전마다
    // 확인한다(T-146). 남은 시간이 없으면 null
    const beforeSend = async (): Promise<number | null> => {
      const left = this.budgetMs[step] - (this.now() - started);
      if (sent) {
        if (left <= 0) {
          notes.push('시간 상한');
          return null;
        }
        if (beforeRetry) await beforeRetry();
      }
      sent = true;
      return Math.max(1_000, Math.min(this.timeoutMs[step], left));
    };
    for (const model of this.cfg.models) {
      let timeout = await beforeSend();
      if (timeout === null) break;
      let r = await this.once(step, model, key, system, user, format, timeout, 'schema');
      if (r.kind === 'schema-unsupported') {
        // 구조화 출력(json_schema)을 받지 않는 모델(400) — 같은 모델에 JSON 모드로 한 번 더
        timeout = await beforeSend();
        if (timeout === null) break;
        r = await this.once(step, model, key, system, user, format, timeout, 'object');
      }
      if (r.tokens) {
        total.inputTokens += r.tokens.inputTokens;
        total.outputTokens += r.tokens.outputTokens;
        total.cacheReadTokens += r.tokens.cacheReadTokens;
      }
      if (r.kind === 'ok') {
        const verdict = accept ? accept(r.raw) : true;
        if (verdict === true) {
          if (notes.length) this.log.log(`AI ${step}: ${model} 에서 받음(앞서 ${notes.join(', ')})`);
          return { raw: r.raw, usage: { model: r.servedBy, ...total } };
        }
        if (verdict === 'last-resort' && !fallback) fallback = { raw: r.raw, servedBy: r.servedBy };
        kinds.push('format');
        notes.push(`${model} 형식 미달`);
        continue;
      }
      if (r.kind === 'auth') {
        this.log.error(`AI 인증 실패(${r.reason}) — 통합 키를 확인한다`);
        throw new ServiceUnavailableException('AI 연결 설정(키)이 올바르지 않습니다. 아스트룸에 문의해 주세요.');
      }
      if (r.kind === 'offlist') {
        this.blockedUntil = this.now() + 10 * 60_000;
        this.log.error(`허용하지 않은 제공사가 답함(${r.servedBy || '제공사 표시 없음'}) — freellmapi 설정을 점검한다. 10분 동안 보내지 않음`);
        throw new ServiceUnavailableException('AI 연결 설정을 점검해야 합니다. 아스트룸에 문의해 주세요.');
      }
      kinds.push(r.kind);
      notes.push(`${model} ${r.reason}`);
    }
    if (fallback) {
      this.log.warn(`AI ${step}: 더 나은 답이 없어 근거가 맞지 않은 답으로 끝냄 — ${notes.join(', ')}`);
      return { raw: fallback.raw, usage: { model: fallback.servedBy, ...total } };
    }
    this.log.warn(`AI ${step} 실패 — ${notes.join(', ')}`);
    const usage: AiUsage = { model: '', ...total };
    if (kinds.includes('format')) throw new AskBadResponseError(ASK_FORMAT_FAILED, usage);
    if (kinds.length > 0 && kinds.every((k) => k === 'unavailable')) {
      this.log.error('허용 모델 모두 쓸 수 없음(제공사 키 없음·카탈로그에 없음) — freellmapi 키와 AI_QA_MODELS 를 확인한다');
      throw new ServiceUnavailableException('AI 연결 설정(제공사 키)이 아직 준비되지 않았습니다. 아스트룸에 문의해 주세요.');
    }
    if (kinds.length > 0 && kinds.every((k) => k === 'limit' || k === 'unavailable')) {
      throw new ServiceUnavailableException('무료 AI 사용량이 지금 모두 찼습니다. 잠시 후 다시 물어 주세요.');
    }
    if (kinds.includes('refused') && kinds.every((k) => k === 'refused' || k === 'limit' || k === 'unavailable')) {
      throw new AskRefusedError('provider', usage);
    }
    throw new BadGatewayException('AI 답변을 받지 못했습니다. 잠시 후 다시 물어 주세요.');
  }

  /** 모델 하나에 한 번 보낸다. 구조화 출력(json_schema)을 받지 않는 모델(400)이면 'schema-unsupported' — 부르는 쪽이 다시 보낸다 */
  private async once(
    step: Step,
    model: string,
    key: string,
    system: string,
    user: string,
    format: { name: string; schema: Record<string, unknown> },
    timeoutMs: number,
    jsonMode: 'schema' | 'object',
  ): Promise<Attempt> {
    const body = {
      model,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      temperature: 0.2,
      max_tokens: step === 'select' ? 2_000 : 16_000,
      stream: false,
      response_format:
        jsonMode === 'schema'
          ? { type: 'json_schema', json_schema: { name: format.name, strict: true, schema: format.schema } }
          : { type: 'json_object' },
    };
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await this.fetchImpl(`${this.cfg.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${key}`, 'x-freellm-cache': 'off' },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
      if (!res.ok) {
        // 오류 본문에서는 오류 코드만 본다(연결도 반납) — 본문은 남기지 않는다
        const code = errorCode(await res.text().catch(() => ''));
        if (res.status === 401 || res.status === 403) return { kind: 'auth', reason: `HTTP ${res.status}` };
        if (res.status === 429) return { kind: 'limit', reason: '한도' };
        // 그 모델에 키가 없거나(503 no_providers_configured) 카탈로그에 없다(404) — 설정 문제다
        if (res.status === 404 || (res.status === 503 && code === 'no_providers_configured')) {
          return { kind: 'unavailable', reason: `HTTP ${res.status}${code ? ` ${code}` : ''}` };
        }
        if (res.status === 400 && jsonMode === 'schema') return { kind: 'schema-unsupported', reason: 'HTTP 400' };
        return { kind: 'error', reason: `HTTP ${res.status}` };
      }
      const servedBy = res.headers.get('x-routed-via')?.trim() ?? '';
      const routed = this.checkRoute(servedBy, model);
      if (routed) {
        await res.text().catch(() => '');
        return routed;
      }
      const data = (await res.json().catch(() => null)) as {
        model?: string;
        choices?: { finish_reason?: string; message?: { content?: unknown } }[];
        usage?: { prompt_tokens?: number; completion_tokens?: number; prompt_tokens_details?: { cached_tokens?: number } };
      } | null;
      const tokens: Tokens = {
        inputTokens: num(data?.usage?.prompt_tokens),
        outputTokens: num(data?.usage?.completion_tokens),
        cacheReadTokens: num(data?.usage?.prompt_tokens_details?.cached_tokens),
      };
      const by = servedBy || data?.model || model;
      const choice = data?.choices?.[0];
      if (!choice) return { kind: 'error', reason: '빈 응답', tokens, servedBy: by };
      if (choice.finish_reason === 'content_filter') return { kind: 'refused', reason: '거절', tokens, servedBy: by };
      if (choice.finish_reason === 'length') return { kind: 'format', reason: '길이 제한', tokens, servedBy: by };
      const raw = typeof choice.message?.content === 'string' ? parseJsonLoose(choice.message.content) : undefined;
      if (raw === undefined) return { kind: 'format', reason: 'JSON 아님', tokens, servedBy: by };
      return { kind: 'ok', raw, tokens, servedBy: by };
    } catch (e) {
      return { kind: 'error', reason: (e as Error)?.name === 'AbortError' ? '시간 초과' : '연결 실패' };
    } finally {
      clearTimeout(timer);
    }
  }

  /** 답한 곳 확인 — 제공사가 허용 밖이면 멈추고(offlist), 모델만 목록 밖이면 그 답만 버린다. 확인할 게 없으면 null */
  private checkRoute(servedBy: string, requested: string): Attempt | null {
    if (!this.cfg.allowedPlatforms) return null;
    const slash = servedBy.indexOf('/');
    const platform = slash > 0 ? servedBy.slice(0, slash) : '';
    const model = slash > 0 ? servedBy.slice(slash + 1) : '';
    if (!platform || !this.cfg.allowedPlatforms.includes(platform)) return { kind: 'offlist', reason: '허용 밖 제공사', servedBy };
    const served = baseModel(model);
    if (served !== baseModel(requested) && !this.cfg.models.some((m) => baseModel(m) === served)) {
      return { kind: 'unavailable', reason: `목록 밖 모델(${model})`, servedBy };
    }
    return null;
  }
}
