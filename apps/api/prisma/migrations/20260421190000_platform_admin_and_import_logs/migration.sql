-- Create enums
DO $$ BEGIN
  CREATE TYPE "PlatformRole" AS ENUM ('none', 'global_admin');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "BillingStatus" AS ENUM ('active', 'trial', 'past_due', 'canceled');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- Alter tenants
ALTER TABLE "tenants"
  ADD COLUMN IF NOT EXISTS "plan_expires_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "billing_status" "BillingStatus" NOT NULL DEFAULT 'active';

-- Alter users
ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "platform_role" "PlatformRole" NOT NULL DEFAULT 'none';

-- Create policy import logs
CREATE TABLE IF NOT EXISTS "policy_import_logs" (
  "id" TEXT NOT NULL,
  "tenant_id" TEXT NOT NULL,
  "user_id" TEXT,
  "policy_id" TEXT,
  "source_name" TEXT,
  "parse_profile" TEXT,
  "chapter_count" INTEGER NOT NULL DEFAULT 0,
  "article_count" INTEGER NOT NULL DEFAULT 0,
  "cleanup_options" JSONB,
  "status" TEXT NOT NULL DEFAULT 'success',
  "message" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "policy_import_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "policy_import_logs_tenant_id_created_at_idx"
ON "policy_import_logs"("tenant_id", "created_at");

DO $$ BEGIN
  ALTER TABLE "policy_import_logs"
    ADD CONSTRAINT "policy_import_logs_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "policy_import_logs"
    ADD CONSTRAINT "policy_import_logs_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "policy_import_logs"
    ADD CONSTRAINT "policy_import_logs_policy_id_fkey"
    FOREIGN KEY ("policy_id") REFERENCES "policies"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

