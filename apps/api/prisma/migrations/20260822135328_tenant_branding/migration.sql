-- CreateTable
CREATE TABLE "tenant_branding" (
    "tenant_id" TEXT NOT NULL,
    "brand_mark" VARCHAR(8) NOT NULL DEFAULT '',
    "logo_data_url" TEXT,
    "logo_width" INTEGER NOT NULL DEFAULT 32,
    "logo_height" INTEGER NOT NULL DEFAULT 32,
    "updated_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenant_branding_pkey" PRIMARY KEY ("tenant_id")
);

-- AddForeignKey
ALTER TABLE "tenant_branding" ADD CONSTRAINT "tenant_branding_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
