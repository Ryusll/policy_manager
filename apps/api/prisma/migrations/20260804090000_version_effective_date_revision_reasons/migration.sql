-- CreateEnum
CREATE TYPE "PolicyRevisionKind" AS ENUM ('enactment', 'amendment', 'full_amendment', 'repeal');

-- AlterTable: 조문 버전에 시행일 부여 (시점 조회 기준)
ALTER TABLE "article_versions" ADD COLUMN     "effective_date" DATE;

-- CreateTable
CREATE TABLE "policy_revision_reasons" (
    "id" TEXT NOT NULL,
    "policy_id" TEXT NOT NULL,
    "kind" "PolicyRevisionKind" NOT NULL DEFAULT 'amendment',
    "label" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "summary" TEXT,
    "promulgated_date" DATE,
    "effective_date" DATE,
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "policy_revision_reasons_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "article_versions_article_id_effective_date_idx" ON "article_versions"("article_id", "effective_date");

-- CreateIndex
CREATE INDEX "policy_revision_reasons_policy_id_effective_date_idx" ON "policy_revision_reasons"("policy_id", "effective_date");

-- AddForeignKey
ALTER TABLE "policy_revision_reasons" ADD CONSTRAINT "policy_revision_reasons_policy_id_fkey" FOREIGN KEY ("policy_id") REFERENCES "policies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 기존 시행중 버전에 시행일 backfill: 승인일 → 없으면 생성일
UPDATE "article_versions"
SET "effective_date" = COALESCE("approved_at", "created_at")::date
WHERE "effective_date" IS NULL
  AND "status" IN ('published', 'archived');
