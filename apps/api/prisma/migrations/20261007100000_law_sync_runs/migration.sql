-- CreateEnum
CREATE TYPE "LawSyncTrigger" AS ENUM ('schedule', 'manual');

-- CreateEnum
CREATE TYPE "LawSyncStatus" AS ENUM ('running', 'succeeded', 'partial', 'failed');

-- AlterTable
ALTER TABLE "laws" ADD COLUMN "last_check_error" TEXT;

-- CreateTable
CREATE TABLE "law_sync_runs" (
    "id" TEXT NOT NULL,
    "trigger" "LawSyncTrigger" NOT NULL,
    "status" "LawSyncStatus" NOT NULL DEFAULT 'running',
    "triggered_by" TEXT,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMP(3),
    "checked_count" INTEGER NOT NULL DEFAULT 0,
    "changed_count" INTEGER NOT NULL DEFAULT 0,
    "event_count" INTEGER NOT NULL DEFAULT 0,
    "failed_count" INTEGER NOT NULL DEFAULT 0,
    "results" JSONB,
    "error" TEXT,

    CONSTRAINT "law_sync_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "law_sync_runs_started_at_idx" ON "law_sync_runs"("started_at");
