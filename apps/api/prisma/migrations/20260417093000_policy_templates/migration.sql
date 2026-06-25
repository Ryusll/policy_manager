CREATE TABLE "policy_templates" (
  "id" TEXT NOT NULL,
  "tenant_id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "is_default" BOOLEAN NOT NULL DEFAULT false,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "layout_json" JSONB NOT NULL,
  "css_text" TEXT NOT NULL DEFAULT '',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "policy_templates_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "policies"
ADD COLUMN "template_id" TEXT;

CREATE INDEX "policy_templates_tenant_id_is_default_idx"
ON "policy_templates"("tenant_id", "is_default");

CREATE UNIQUE INDEX "policy_templates_tenant_id_name_key"
ON "policy_templates"("tenant_id", "name");

ALTER TABLE "policy_templates"
ADD CONSTRAINT "policy_templates_tenant_id_fkey"
FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "policies"
ADD CONSTRAINT "policies_template_id_fkey"
FOREIGN KEY ("template_id") REFERENCES "policy_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;
