-- T-218 내 지난 질문(SRS SEARCH-10): 다시 보기에 물은 때의 답과 근거를 그대로 보이려고, 답하지 못한 까닭과
-- 근거 조문(원문 포함)·법령 근거·살펴본 조문을 질문 기록에 함께 남긴다. 모두 비워 둘 수 있는 칸이라 기존 행은 그대로 둔다
-- (이 칸 전에 쌓인 기록은 답 본문만 보인다). 보관 기간(90일)과 파기는 그대로다.
ALTER TABLE "ai_qa_logs" ADD COLUMN "reason" TEXT;
ALTER TABLE "ai_qa_logs" ADD COLUMN "citations" JSONB;
ALTER TABLE "ai_qa_logs" ADD COLUMN "law_citations" JSONB;
ALTER TABLE "ai_qa_logs" ADD COLUMN "consulted" JSONB;
