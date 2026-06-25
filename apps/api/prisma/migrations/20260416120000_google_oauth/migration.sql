-- OAuth: optional password for Google-only users; Google account linkage
ALTER TABLE "users" ALTER COLUMN "password_hash" DROP NOT NULL;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "oauth_provider" TEXT;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "oauth_sub" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "users_oauth_provider_oauth_sub_key"
  ON "users" ("oauth_provider", "oauth_sub");
