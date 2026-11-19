-- T-220 이어서 묻기(SRS SEARCH-12): 이어 물은 앞 질문의 기록 id. 그 답의 근거 조문을 이번 후보로 이어받았다는 표시다.
-- 질문 기록은 행마다 90일 뒤 파기되어 앞 질문이 먼저 지워질 수 있으므로 FK 를 두지 않는다(지워지면 다시 보기에서 '앞 질문을 볼 수 없음').
ALTER TABLE "ai_qa_logs" ADD COLUMN "parent_id" TEXT;
