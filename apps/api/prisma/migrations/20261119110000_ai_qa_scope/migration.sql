-- T-219 질문 범위 선택(SRS SEARCH-11): 묻는 사람이 고른 규정을 물은 때의 이름·코드와 함께([{ id, title, code }])
-- 질문 기록에 남겨, 지난 질문에서 어느 범위로 물었는지 그때 그대로 보인다. 빈 배열이 '회사 전체'다.
-- 기본값이 있어 기존 행은 빈 배열(회사 전체)로 채워진다.
ALTER TABLE "ai_qa_logs" ADD COLUMN "scope" JSONB NOT NULL DEFAULT '[]';
