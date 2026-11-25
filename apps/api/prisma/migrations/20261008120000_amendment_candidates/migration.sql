-- CreateEnum
CREATE TYPE "AmendmentMethod" AS ENUM ('rule', 'llm');

-- CreateEnum
CREATE TYPE "AmendmentState" AS ENUM ('draft', 'review', 'approved', 'rejected');

-- CreateEnum
CREATE TYPE "AmendmentConfidence" AS ENUM ('high', 'medium', 'low');

-- AlterTable
ALTER TABLE "law_change_events" ADD COLUMN     "amendments_processed_at" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "user_notifications" ADD COLUMN     "link" TEXT;

-- CreateTable
CREATE TABLE "amendment_candidates" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "article_id" TEXT NOT NULL,
    "base_version_id" TEXT NOT NULL,
    "change_event_id" TEXT NOT NULL,
    "law_link_id" TEXT,
    "candidate_content" TEXT NOT NULL,
    "rationale" JSONB NOT NULL,
    "diff" JSONB NOT NULL,
    "generation_method" "AmendmentMethod" NOT NULL,
    "variant" TEXT NOT NULL,
    "generation_meta" JSONB,
    "confidence" "AmendmentConfidence" NOT NULL,
    "review_flags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "review_state" "AmendmentState" NOT NULL DEFAULT 'draft',
    "as_of_date" DATE NOT NULL,
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "amendment_candidates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "amendment_candidates_tenant_id_review_state_created_at_idx" ON "amendment_candidates"("tenant_id", "review_state", "created_at");

-- CreateIndex
CREATE INDEX "amendment_candidates_tenant_id_article_id_idx" ON "amendment_candidates"("tenant_id", "article_id");

-- CreateIndex
CREATE INDEX "amendment_candidates_change_event_id_idx" ON "amendment_candidates"("change_event_id");

-- CreateIndex
CREATE UNIQUE INDEX "amendment_candidates_tenant_id_change_event_id_article_id_b_key" ON "amendment_candidates"("tenant_id", "change_event_id", "article_id", "base_version_id", "generation_method", "variant");

-- CreateIndex
CREATE INDEX "law_change_events_amendments_processed_at_idx" ON "law_change_events"("amendments_processed_at");

-- AddForeignKey
ALTER TABLE "amendment_candidates" ADD CONSTRAINT "amendment_candidates_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "amendment_candidates" ADD CONSTRAINT "amendment_candidates_article_id_fkey" FOREIGN KEY ("article_id") REFERENCES "articles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "amendment_candidates" ADD CONSTRAINT "amendment_candidates_base_version_id_fkey" FOREIGN KEY ("base_version_id") REFERENCES "article_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "amendment_candidates" ADD CONSTRAINT "amendment_candidates_change_event_id_fkey" FOREIGN KEY ("change_event_id") REFERENCES "law_change_events"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "amendment_candidates" ADD CONSTRAINT "amendment_candidates_law_link_id_fkey" FOREIGN KEY ("law_link_id") REFERENCES "law_links"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- 기능 도입 전에 감지된 변경 이벤트는 자동 생성이 "처리한 것"으로 둔다. 비워 두면 배포 직후
-- 첫 동기화가 지난 개정 전부에 후보를 만들고 회사마다 알림을 한꺼번에 보낸다. 그 이벤트의
-- 후보는 법령 화면의 "개정 후보 만들기"로 직접 만든다(T-106).
UPDATE "law_change_events" SET "amendments_processed_at" = "detected_at" WHERE "amendments_processed_at" IS NULL;
