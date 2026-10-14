import type { PrismaClient } from '@prisma/client';

/**
 * 규정 질문 기록(`ai_qa_logs`)의 보관 기간과 파기 (T-146, D-09 재결정 ⑤, ADR-0025).
 *
 * 질문 원문과 AI 답에는 직원 개인정보(병가·경조사·징계 같은 사정)가 섞일 수 있어 기한 없이 두지 않는다.
 * 보관 일수는 환경변수가 아니라 코드 상수다 — 관리자가 동의한 고지(`ask-notice.ts`)에 이 일수가 그대로 실리므로,
 * 바꾸면 고지 판도 함께 올려야 한다(고지 지문 시험이 잡는다). 월 한도가 그달(한국 1일 0시부터) 기록을 세므로
 * 31일보다 짧으면 안 된다(시험이 본다).
 *
 * 파기는 서버 cron 이 하루 한 번 `ask-purge.cli` 를 부른다(법령 동기화 T-104 와 같은 방식). API 컨테이너 안
 * 스케줄러는 쓰지 않는다 — 2대로 늘리면 두 번 돈다. 질문 때 지우는 방식은 질문이 끊긴 회사의 기록이 남아 쓰지 않는다.
 */
export const AI_QA_LOG_RETENTION_DAYS = 90;
const DAY_MS = 24 * 60 * 60 * 1000;

/** 이 시각보다 먼저 만든 기록을 지운다 */
export function retentionCutoff(days: number, now = new Date()): Date {
  return new Date(now.getTime() - days * DAY_MS);
}

/** 보관 기간이 지난 기록을 모든 회사에서 지운다. 지운 건수만 돌려준다 — 질문 내용은 로그에도 남기지 않는다 */
export async function purgeAiQaLogs(db: Pick<PrismaClient, 'aiQaLog'>, days = AI_QA_LOG_RETENTION_DAYS, now = new Date()) {
  const cutoff = retentionCutoff(days, now);
  const { count } = await db.aiQaLog.deleteMany({ where: { createdAt: { lt: cutoff } } });
  return { deleted: count, cutoff, days };
}
