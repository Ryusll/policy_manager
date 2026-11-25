-- AlterTable
ALTER TABLE "amendment_candidates" ADD COLUMN     "lock_version" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "revision" INTEGER NOT NULL DEFAULT 1;

-- CreateTable
CREATE TABLE "amendment_revisions" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "candidate_id" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "content_hash" TEXT NOT NULL,
    "diff" JSONB NOT NULL,
    "note" TEXT,
    "edited_by" TEXT,
    "state_before" "AmendmentState",
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "amendment_revisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "amendment_state_changes" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "candidate_id" TEXT NOT NULL,
    "from_state" "AmendmentState" NOT NULL,
    "to_state" "AmendmentState" NOT NULL,
    "revision" INTEGER NOT NULL,
    "reason" TEXT,
    "actor_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "amendment_state_changes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "amendment_revisions_tenant_id_candidate_id_idx" ON "amendment_revisions"("tenant_id", "candidate_id");

-- CreateIndex
CREATE UNIQUE INDEX "amendment_revisions_candidate_id_revision_key" ON "amendment_revisions"("candidate_id", "revision");

-- CreateIndex
CREATE INDEX "amendment_state_changes_candidate_id_created_at_idx" ON "amendment_state_changes"("candidate_id", "created_at");

-- AddForeignKey
ALTER TABLE "amendment_revisions" ADD CONSTRAINT "amendment_revisions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "amendment_revisions" ADD CONSTRAINT "amendment_revisions_candidate_id_fkey" FOREIGN KEY ("candidate_id") REFERENCES "amendment_candidates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "amendment_state_changes" ADD CONSTRAINT "amendment_state_changes_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "amendment_state_changes" ADD CONSTRAINT "amendment_state_changes_candidate_id_fkey" FOREIGN KEY ("candidate_id") REFERENCES "amendment_candidates"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- 이미 있는 후보(T-106)의 생성본을 판 1 로 채운다 — 판 테이블이 생성본부터 모든 판을 갖는다는 약속(T-107)을
-- 기존 행에도 지키려고. 해시 형식은 서비스(sha256 hex, UTF-8)와 같다.
INSERT INTO "amendment_revisions" ("id", "tenant_id", "candidate_id", "revision", "content", "content_hash", "diff", "created_at")
SELECT gen_random_uuid()::text, c."tenant_id", c."id", 1, c."candidate_content",
       encode(sha256(convert_to(c."candidate_content", 'UTF8')), 'hex'), c."diff", c."created_at"
FROM "amendment_candidates" c;
