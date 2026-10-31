-- CreateEnum
CREATE TYPE "LawChangeType" AS ENUM ('created', 'modified', 'deleted');

-- CreateEnum
CREATE TYPE "LawEventChannel" AS ENUM ('poll', 'manual', 'webhook');

-- CreateTable
CREATE TABLE "law_change_events" (
    "id" TEXT NOT NULL,
    "law_id" TEXT NOT NULL,
    "law_article_id" TEXT,
    "node_key" TEXT NOT NULL,
    "change_type" "LawChangeType" NOT NULL,
    "before_content" TEXT,
    "after_content" TEXT,
    "before_version_key" TEXT,
    "after_version_key" TEXT,
    "promulgated_date" DATE,
    "law_effective_date" DATE,
    "received_via" "LawEventChannel" NOT NULL,
    "detected_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "law_change_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "law_change_events_law_article_id_detected_at_idx" ON "law_change_events"("law_article_id", "detected_at");

-- CreateIndex
CREATE INDEX "law_change_events_law_id_detected_at_idx" ON "law_change_events"("law_id", "detected_at");

-- CreateIndex
CREATE INDEX "law_change_events_law_effective_date_idx" ON "law_change_events"("law_effective_date");

-- AddForeignKey
ALTER TABLE "law_change_events" ADD CONSTRAINT "law_change_events_law_id_fkey" FOREIGN KEY ("law_id") REFERENCES "laws"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "law_change_events" ADD CONSTRAINT "law_change_events_law_article_id_fkey" FOREIGN KEY ("law_article_id") REFERENCES "law_articles"("id") ON DELETE SET NULL ON UPDATE CASCADE;
