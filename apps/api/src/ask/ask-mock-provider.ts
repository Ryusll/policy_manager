import { BadGatewayException } from '@nestjs/common';
import { ASK_FORMAT_FAILED, AskBadResponseError, AskRefusedError, type AiUsage, type AnswerAcceptor, type AskProvider } from './ask-provider';

/**
 * 통합 테스트용 모의 AI(`AI_QA_PROVIDER=mock`). 실제 AI 처럼 판단하지 않고 정해진 규칙으로 답한다 — 답 칸은 실제 제공사와
 * 같은 검토 보고서 칸(`REPORT_SCHEMA`, T-207)이라 서버의 검사·블록 만들기와 화면 모양을 그대로 시험한다.
 * - 고르기: 목차 줄에 질문 낱말이 들어 있으면 그 키
 * - 답하기: 첫 참조 번호를 근거로 "모의 답변 — <첫 행 앞부분>". 질문에 "[근거밖]"이 있으면 준 적 없는 번호만 근거로 대고
 *   (걸러지는지 시험), "[모름]"이 있으면 답할 수 없다고 한다. 근거 거르기를 시험하려고 늘 준 적 없는 번호(R999·L999)를 섞는다.
 *   법령 근거(<법령>의 [L번호])가 있으면 첫 번호를 법령 칸에 쓰고, 받은 번호를 전부 법령 근거로 댄다(T-209).
 * - "[형식]"이면 표를 비운 답을 낸다 — 서버가 형식 미달로 보고 안내로 끝내는지 시험한다(SEARCH-7).
 * - 실패 시험: "[실패]"면 호출 실패(502), "[거절]"이면 고르기 단계에서 AI 가 거절한 것으로 한다 — 둘 다 월 한도에 세야 한다.
 * - "[느림]"이면 고르기가 1.5초 걸린다 — 그 사이에 끈 회사는 조문 본문을 보내지 않는지 본다(T-146).
 */
export class MockAskProvider implements AskProvider {
  readonly name = 'mock' as const;
  private readonly usage: AiUsage = { model: 'mock', inputTokens: 0, outputTokens: 0, cacheReadTokens: 0 };

  async select(input: { toc: string; question: string }) {
    if (input.question.includes('[느림]')) await new Promise((r) => setTimeout(r, 1500));
    if (input.question.includes('[실패]')) return Promise.reject(new BadGatewayException('모의 AI 호출 실패'));
    if (input.question.includes('[거절]')) return Promise.reject(new AskRefusedError('mock', { ...this.usage, inputTokens: 10 }));
    const words = input.question.split(/\s+/).filter((w) => w.length >= 2);
    const keys = input.toc
      .split('\n')
      .filter((line) => words.some((w) => line.includes(w.replace(/[?.!,]/g, ''))))
      .map((line) => line.split(' | ')[0]);
    return Promise.resolve({ keys, usage: this.usage });
  }

  answer(input: { context: string; question: string }, _beforeRetry?: () => Promise<void>, accept?: AnswerAcceptor) {
    const raw = this.report(input);
    if (accept && accept(raw) === false) return Promise.reject(new AskBadResponseError(ASK_FORMAT_FAILED, this.usage));
    return Promise.resolve({ raw, usage: this.usage });
  }

  private report(input: { context: string; question: string }): unknown {
    const empty = { lead: '', rows: [], listKind: 'summary', priorities: [], conclusion: '', basis: '', citations: [], lawCitations: [] };
    if (input.question.includes('[모름]')) return { answerable: false, ...empty };
    const first = /\[(R\d+)\] ([^\n]*)/.exec(input.context);
    // 받은 법령 번호를 전부 인용한다 — 확정 연결만 들어갔는지(추천·다른 회사 연결이 섞이지 않았는지)가 응답에 드러나게(T-209)
    const laws = [...input.context.matchAll(/\[(L\d+)\] ([^\n]*)/g)];
    const law = laws[0];
    const ref = first?.[1] ?? 'R999';
    const text = (first?.[2] ?? '').slice(0, 60);
    return {
      answerable: true,
      lead: `모의 답변 — ${text} [R1] 기준으로 **대체로 부합**합니다.`,
      rows: input.question.includes('[형식]')
        ? []
        : [
            {
              area: '근거 조문',
              law: law ? law[2].slice(0, 40) : '사내 기준(직접 관련 법령 없음)',
              current: text || '규정에 없음',
              verdict: '대체로 부합',
              advice: '현행 유지',
            },
          ],
      listKind: 'summary',
      priorities: [{ title: '근거 조문 확인', detail: '아래 근거 조문을 직접 확인하세요.' }],
      conclusion: '모의 종합 의견 — **근거 조문을 확인**하세요.',
      basis: '모의 근거 요약입니다.',
      citations: input.question.includes('[근거밖]') ? ['R999'] : [ref, 'R999'],
      lawCitations: laws.length ? [...laws.map((m) => m[1]), 'L999'] : [],
    };
  }
}
