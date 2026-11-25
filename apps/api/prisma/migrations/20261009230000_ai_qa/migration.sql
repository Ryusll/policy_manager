-- T-130 규정 근거 AI 질의응답: 회사별 켜기(기본 켜짐) + 질문 기록
ALTER TABLE "tenants" ADD COLUMN "ai_qa_enabled" BOOLEAN NOT NULL DEFAULT true;

CREATE TABLE "ai_qa_logs" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "user_id" TEXT,
    "question" TEXT NOT NULL,
    "answerable" BOOLEAN NOT NULL,
    "answer" JSONB,
    "cited_article_ids" TEXT[],
    "context_row_count" INTEGER NOT NULL DEFAULT 0,
    "ai_called" BOOLEAN NOT NULL,
    "model" TEXT,
    "input_tokens" INTEGER NOT NULL DEFAULT 0,
    "output_tokens" INTEGER NOT NULL DEFAULT 0,
    "cache_read_tokens" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_qa_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ai_qa_logs_tenant_id_created_at_idx" ON "ai_qa_logs"("tenant_id", "created_at");

ALTER TABLE "ai_qa_logs" ADD CONSTRAINT "ai_qa_logs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ai_qa_logs" ADD CONSTRAINT "ai_qa_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
