/**
 * 규정 질문 기록 파기 — 서버 cron 이 하루 한 번 부르는 진입점 (T-146, D-09 재결정 ⑤).
 *
 * 보관 기간(`AI_QA_LOG_RETENTION_DAYS` — 90일, 코드 상수)보다 오래된 `ai_qa_logs` 를 모든 회사에서 지운다.
 * 앱 전체를 띄우지 않고 DB 만 연다 — 지우는 일 하나라 AI 연결·다른 모듈이 필요 없다.
 *
 * 실행: `node dist/ask/ask-purge.cli.js` — 서버에서는 `scripts/oracle/ai-qa-purge.sh`
 * 종료 코드: 성공 0, 실패 1(cron 이 실패를 알 수 있게). 지운 건수만 찍고 질문 내용은 찍지 않는다.
 */
import { PrismaClient } from '@prisma/client';
import { purgeAiQaLogs } from './ask-retention';

async function main(): Promise<number> {
  const prisma = new PrismaClient();
  try {
    const r = await purgeAiQaLogs(prisma);
    console.log(`[ai-qa-purge] ${r.days}일 지난 기록 ${r.deleted}건 삭제 (${r.cutoff.toISOString()} 이전)`);
    return 0;
  } finally {
    await prisma.$disconnect();
  }
}

main()
  .then((code) => process.exit(code))
  .catch((e) => {
    console.error(`[ai-qa-purge] 실행 실패: ${e?.message ?? e}`);
    process.exit(1);
  });
