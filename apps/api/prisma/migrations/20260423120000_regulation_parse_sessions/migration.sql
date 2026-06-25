-- CreateTable
CREATE TABLE "regulation_parse_sessions" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "user_id" TEXT,
    "file_name" TEXT NOT NULL,
    "mime_type" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "extracted_text" TEXT,
    "extract_meta" JSONB,
    "parse_tree" JSONB,
    "error_message" TEXT,
    "committed_policy_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "regulation_parse_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "regulation_parse_sessions_tenant_id_created_at_idx" ON "regulation_parse_sessions"("tenant_id", "created_at");

-- AddForeignKey
ALTER TABLE "regulation_parse_sessions" ADD CONSTRAINT "regulation_parse_sessions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "regulation_parse_sessions" ADD CONSTRAINT "regulation_parse_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "regulation_parse_sessions" ADD CONSTRAINT "regulation_parse_sessions_committed_policy_id_fkey" FOREIGN KEY ("committed_policy_id") REFERENCES "policies"("id") ON DELETE SET NULL ON UPDATE CASCADE;
