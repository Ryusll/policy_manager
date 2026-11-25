-- T-110 ② 재파싱 반영·묶음 승인 + 버전별 계층 최소안(PAT-04).
-- article_versions.structure: 발행 이력은 얼린 계층(계층이 실제로 바뀐 승인 때 채운다), 초안·검토 중은 재파싱이 제안한 계층.
-- 기존 버전은 비워 둔다 — 그때 계층이 기록된 적이 없으니 지금 조문 행의 값을 따른다(옛 기록 보정 없음).
-- AlterTable
ALTER TABLE "article_versions" ADD COLUMN     "reparse_item_id" TEXT,
ADD COLUMN     "structure" JSONB;

-- AlterTable
ALTER TABLE "reparse_reviews" ADD COLUMN     "applied_at" TIMESTAMP(3),
ADD COLUMN     "applied_by" TEXT,
ADD COLUMN     "approved_at" TIMESTAMP(3),
ADD COLUMN     "approved_by" TEXT,
ADD COLUMN     "bundle_fingerprint" TEXT,
ADD COLUMN     "change_note" TEXT,
ADD COLUMN     "effective_date" DATE,
ADD COLUMN     "plan" JSONB,
ADD COLUMN     "reject_reason" TEXT,
ADD COLUMN     "rejected_at" TIMESTAMP(3),
ADD COLUMN     "rejected_by" TEXT,
ADD COLUMN     "submitted_at" TIMESTAMP(3),
ADD COLUMN     "submitted_by" TEXT;

-- AlterTable
ALTER TABLE "reparse_review_items" ADD COLUMN     "outcome" JSONB;

-- CreateIndex
CREATE UNIQUE INDEX "article_versions_reparse_item_id_key" ON "article_versions"("reparse_item_id");

-- AddForeignKey
ALTER TABLE "article_versions" ADD CONSTRAINT "article_versions_reparse_item_id_fkey" FOREIGN KEY ("reparse_item_id") REFERENCES "reparse_review_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;
