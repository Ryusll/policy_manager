-- T-130 후속: 규정 질문 한도가 새던 문제 — 끝까지 가지 못한 질문의 사유를 남기고, 직원별 월 한도를 세는 인덱스
ALTER TABLE "ai_qa_logs" ADD COLUMN "failure" TEXT;
CREATE INDEX "ai_qa_logs_tenant_id_user_id_created_at_idx" ON "ai_qa_logs"("tenant_id", "user_id", "created_at");
