-- T-110 ① 재파싱 검토 — 규정 문서를 다시 가져와 기존 조문과 맞춘 결과(계층·내용 지문 2축 판정)와 사람의 결정을 남긴다.
-- 규정 데이터는 바꾸지 않는다(반영·묶음 승인은 2단계). 새 표 두 개뿐이라 기존 데이터 보정은 없다.
-- CreateTable
CREATE TABLE "reparse_reviews" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "policy_id" TEXT NOT NULL,
    "session_id" TEXT,
    "source_name" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "algorithm" TEXT NOT NULL,
    "normalizer" TEXT NOT NULL,
    "state_fingerprint" TEXT NOT NULL,
    "summary" JSONB NOT NULL,
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "reparse_reviews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reparse_review_items" (
    "id" TEXT NOT NULL,
    "review_id" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "article_id" TEXT,
    "parsed" JSONB,
    "stored" JSONB,
    "candidates" JSONB,
    "reasons" JSONB NOT NULL,
    "changes" JSONB,
    "recommended" BOOLEAN NOT NULL DEFAULT false,
    "decision" TEXT,
    "target_article_id" TEXT,
    "decided_by" TEXT,
    "decided_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "reparse_review_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "reparse_reviews_tenant_id_policy_id_created_at_idx" ON "reparse_reviews"("tenant_id", "policy_id", "created_at");

-- CreateIndex
CREATE INDEX "reparse_reviews_session_id_idx" ON "reparse_reviews"("session_id");

-- CreateIndex
CREATE INDEX "reparse_review_items_article_id_idx" ON "reparse_review_items"("article_id");

-- CreateIndex
CREATE UNIQUE INDEX "reparse_review_items_review_id_seq_key" ON "reparse_review_items"("review_id", "seq");

-- AddForeignKey
ALTER TABLE "reparse_reviews" ADD CONSTRAINT "reparse_reviews_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reparse_reviews" ADD CONSTRAINT "reparse_reviews_policy_id_fkey" FOREIGN KEY ("policy_id") REFERENCES "policies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reparse_reviews" ADD CONSTRAINT "reparse_reviews_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "regulation_parse_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reparse_review_items" ADD CONSTRAINT "reparse_review_items_review_id_fkey" FOREIGN KEY ("review_id") REFERENCES "reparse_reviews"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reparse_review_items" ADD CONSTRAINT "reparse_review_items_article_id_fkey" FOREIGN KEY ("article_id") REFERENCES "articles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reparse_review_items" ADD CONSTRAINT "reparse_review_items_target_article_id_fkey" FOREIGN KEY ("target_article_id") REFERENCES "articles"("id") ON DELETE SET NULL ON UPDATE CASCADE;
