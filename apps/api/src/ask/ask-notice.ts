import { HttpException, HttpStatus } from '@nestjs/common';
import type { AskProvider } from './ask-provider';
import { AI_QA_LOG_RETENTION_DAYS } from './ask-retention';
import { ASK_MAX_GROUPS } from './ask-text';

/**
 * 규정 질문의 외부 전송 고지와 동의 판 (T-146, D-09 재결정 2026-10-14, ADR-0025).
 *
 * 규정 질문은 회사마다 꺼진 채 시작하고, 회사 관리자가 이 고지를 보고 확인해야 켜진다 — 확인한 사람·시각·판을
 * 회사 행과 감사 로그에 남긴다. 고지 내용(받는 곳·국가·보내는 항목·보관 기간)이 바뀌면 판을 올린다. 그러면
 * 저장값은 그대로여도 관리자가 새 판을 다시 확인하기 전까지 꺼진 것으로 본다(`aiQaState` → 'stale').
 * 오탈자만 고칠 때는 올리지 않는다. 본문을 고치고 판을 안 올리면 `tests/askNotice.test.ts` 의 지문 시험이 실패한다.
 *
 * 화면은 서버가 내려 준 이 고지를 그대로 그리고, 켤 때 그 판 번호를 함께 보낸다 — 오래 열어 둔 탭이 옛 고지에
 * 동의하는 일을 막는다.
 */
export const AI_QA_NOTICE_VERSION = 1;

export interface AiQaNotice {
  version: number;
  /** 이전받는 자 */
  recipient: string;
  /** 이전 국가 */
  country: string;
  /** 보내는 항목 */
  sent: string[];
  notSent: string;
  /** 보관 기간 — Anthropic 과 VEDA 각각 */
  retention: string[];
  training: string;
  /** 거부(끄기) 방법과 효과 */
  control: string;
  /** 질문하는 직원에게 */
  caution: string;
  /** 질문 화면 아래 한 줄 요약 — 보내는 항목·받는 곳·보관 일수를 화면 문구에 따로 적지 않고 판에 묶는다 */
  summary: string;
  /** 관리자가 체크하는 동의 문장 — 판에 묶여 있어야 어떤 문장에 동의했는지 남는다 */
  consentStatement: string;
}

/** 보관 일수(`AI_QA_LOG_RETENTION_DAYS`)가 그대로 실린다 — 일수를 바꾸면 고지가 바뀌므로 판도 올린다 */
export function aiQaNotice(): AiQaNotice {
  const recipient = 'Anthropic, PBC';
  return {
    version: AI_QA_NOTICE_VERSION,
    recipient,
    country: '미국 — 답을 쓰는 처리(추론)를 미국에서만 하도록 지정해 요청합니다',
    sent: [
      '직원이 쓴 질문',
      '회사 규정의 조 목차(규정 이름·조 번호·조 제목)',
      `질문과 관련된 조문의 본문(한 번에 최대 ${ASK_MAX_GROUPS}개 조)`,
    ],
    notSent: '직원 이름·이메일 같은 계정 정보는 보내지 않습니다',
    retention: [
      'Anthropic: 받은 날부터 30일 안에 삭제합니다(이용정책 위반으로 판정된 내용은 최대 2년, 법령상 보관할 내용은 그 기간)',
      `VEDA: 질문과 답 기록을 ${AI_QA_LOG_RETENTION_DAYS}일 보관한 뒤 지웁니다(장애 복구용 백업에는 백업 보관 기간 동안 남습니다)`,
    ],
    training: 'Anthropic은 계약상 보낸 내용을 AI 모델 학습에 쓰지 않습니다',
    control: '회사 관리자는 언제든 끌 수 있고, 끈 뒤로는 질문과 조문을 외부로 보내지 않습니다',
    caution: '질문에 건강·가족 일 같은 민감한 개인정보나 다른 사람의 개인정보를 적지 마세요',
    summary: `답을 쓰려고 질문·회사 규정의 조 목차·관련 조문이 ${recipient}(미국)로 전송됩니다. 질문 기록은 ${AI_QA_LOG_RETENTION_DAYS}일 보관합니다.`,
    consentStatement: '위 내용을 확인했고, 회사를 대표해 외부 전송에 동의합니다',
  };
}

export type AiQaState = 'on' | 'off' | 'stale';

/** 회사 행에서 상태 판정에 읽는 칸 — 상태를 보는 곳(설정 조회·질문)이 모두 같은 칸을 읽게 */
export const AI_QA_CONSENT_SELECT = { aiQaEnabled: true, aiQaNoticeVersion: true, aiQaConsentedAt: true } as const;

/**
 * 저장값과 동의 판으로 본 실제 상태. 켜져 있어도 확인한 판이 지금 판과 다르면 'stale' — 다시 확인하기 전까지
 * 꺼진 것과 같다(같음/다름만 본다. 코드를 되돌려 판이 낮아져도 "다시 확인" 쪽으로 기운다).
 */
export function aiQaState(t: { aiQaEnabled: boolean; aiQaNoticeVersion: number | null }): AiQaState {
  if (!t.aiQaEnabled) return 'off';
  return t.aiQaNoticeVersion === AI_QA_NOTICE_VERSION ? 'on' : 'stale';
}

/** 꺼져 있거나 고지가 바뀌어 다시 확인해야 하면 질문을 받지 않는다 — 한도에 세기 전, AI 를 부르기 전 */
export function assertAskAllowed(state: AiQaState): void {
  if (state === 'on') return;
  throw new HttpException(
    state === 'stale'
      ? {
          statusCode: 403,
          code: 'AI_QA_NOTICE_CHANGED',
          message: '외부 전송 고지가 바뀌어, 회사 관리자가 다시 확인할 때까지 규정 질문을 쓸 수 없습니다.',
        }
      : { statusCode: 403, code: 'AI_QA_DISABLED', message: '회사 관리자가 규정 질문(AI)을 켜지 않았습니다.' },
    HttpStatus.FORBIDDEN,
  );
}

/**
 * 외부로 보내기 직전마다 회사 상태를 다시 본다 — 예약 때 본 것만으로는 목차·본문을 읽고 AI 가 고르는 사이에
 * 관리자가 끈 것을 놓친다. 실패한 호출을 다시 보낼 때도 같은 확인을 거친다(`beforeRetry`, ask-retry.ts).
 * 고지의 "끈 뒤로는 질문과 조문을 외부로 보내지 않습니다"를 지키는 곳이다.
 * `called()` 는 AI 를 부르기 시작했는지 — 부르기 전에 막히거나 실패한 질문은 한도에서 돌려준다.
 */
export function guardProvider(provider: AskProvider, currentState: () => Promise<AiQaState>) {
  let called = false;
  const allowed = async () => {
    assertAskAllowed(await currentState());
    called = true;
  };
  const guarded: AskProvider = {
    name: provider.name,
    select: async (input) => {
      await allowed();
      return provider.select(input, allowed);
    },
    answer: async (input) => {
      await allowed();
      return provider.answer(input, allowed);
    },
  };
  return { provider: guarded, called: () => called };
}
