-- CreateEnum
CREATE TYPE "LawRelationType" AS ENUM ('delegation', 'application', 'citation', 'obligation', 'reference');

-- CreateEnum
CREATE TYPE "LawLinkState" AS ENUM ('suggested', 'confirmed', 'rejected');

-- CreateTable
CREATE TABLE "law_links" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "law_article_id" TEXT NOT NULL,
    "article_id" TEXT NOT NULL,
    "relation_type" "LawRelationType" NOT NULL,
    "scope" TEXT,
    "evidence_text" TEXT,
    "confidence" DOUBLE PRECISION,
    "confirm_state" "LawLinkState" NOT NULL DEFAULT 'suggested',
    "confirmed_by" TEXT,
    "confirmed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "law_links_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "law_links_tenant_id_article_id_idx" ON "law_links"("tenant_id", "article_id");

-- CreateIndex
CREATE INDEX "law_links_law_article_id_confirm_state_idx" ON "law_links"("law_article_id", "confirm_state");

-- CreateIndex
CREATE UNIQUE INDEX "law_links_tenant_id_law_article_id_article_id_key" ON "law_links"("tenant_id", "law_article_id", "article_id");

-- AddForeignKey
ALTER TABLE "law_links" ADD CONSTRAINT "law_links_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "law_links" ADD CONSTRAINT "law_links_law_article_id_fkey" FOREIGN KEY ("law_article_id") REFERENCES "law_articles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "law_links" ADD CONSTRAINT "law_links_article_id_fkey" FOREIGN KEY ("article_id") REFERENCES "articles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
