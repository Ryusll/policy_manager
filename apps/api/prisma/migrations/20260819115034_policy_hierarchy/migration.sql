-- AlterTable
ALTER TABLE "policies" ADD COLUMN     "parent_id" TEXT;

-- CreateIndex
CREATE INDEX "policies_tenant_id_parent_id_idx" ON "policies"("tenant_id", "parent_id");

-- AddForeignKey
ALTER TABLE "policies" ADD CONSTRAINT "policies_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "policies"("id") ON DELETE SET NULL ON UPDATE CASCADE;
