/*
  Warnings:

  - You are about to drop the `export_jobs` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "export_jobs" DROP CONSTRAINT "export_jobs_tenant_id_fkey";

-- DropTable
DROP TABLE "export_jobs";
