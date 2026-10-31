-- CreateEnum
CREATE TYPE "Role" AS ENUM ('admin', 'editor', 'viewer');

-- CreateEnum
CREATE TYPE "VersionStatus" AS ENUM ('draft', 'review', 'published', 'archived');

-- CreateEnum
CREATE TYPE "PlanTier" AS ENUM ('starter', 'pro', 'enterprise');

-- CreateEnum
CREATE TYPE "PlatformRole" AS ENUM ('none', 'global_admin');

-- CreateEnum
CREATE TYPE "BillingStatus" AS ENUM ('active', 'trial', 'past_due', 'canceled');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('succeeded', 'failed', 'refunded');

-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('active', 'trial', 'canceled', 'expired');

-- CreateEnum
CREATE TYPE "PolicyAppendixKind" AS ENUM ('supplementary', 'annex', 'form');

-- CreateTable
CREATE TABLE "tenants" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "plan" "PlanTier" NOT NULL DEFAULT 'starter',
    "plan_expires_at" TIMESTAMP(3),
    "billing_status" "BillingStatus" NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT,
    "name" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'viewer',
    "platform_role" "PlatformRole" NOT NULL DEFAULT 'none',
    "oauth_provider" TEXT,
    "oauth_sub" TEXT,
    "refresh_token" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "policies" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "metadata" JSONB,
    "revision_date" DATE,
    "effective_date" DATE,
    "template_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "policies_pkey" PRIMARY KEY ("id")
);

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

-- CreateTable
CREATE TABLE "platform_branding" (
    "id" TEXT NOT NULL,
    "legal_name" VARCHAR(200) NOT NULL DEFAULT '',
    "registration_no" VARCHAR(80),
    "product_label" VARCHAR(160) NOT NULL DEFAULT 'Policy Manager',
    "logo_data_url" TEXT,
    "lockup_image_src" VARCHAR(512) NOT NULL DEFAULT '/branding/lockup-astrum-veda.png',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "platform_branding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "policy_appendices" (
    "id" TEXT NOT NULL,
    "policy_id" TEXT NOT NULL,
    "kind" "PolicyAppendixKind" NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "policy_appendices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
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

-- CreateTable
CREATE TABLE "chapters" (
    "id" TEXT NOT NULL,
    "policy_id" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "suppress_header" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "chapters_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sections" (
    "id" TEXT NOT NULL,
    "chapter_id" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "articles" (
    "id" TEXT NOT NULL,
    "chapter_id" TEXT NOT NULL,
    "section_id" TEXT,
    "number" INTEGER NOT NULL,
    "clause_number" INTEGER,
    "item_number" INTEGER,
    "title" TEXT NOT NULL,
    "has_precedent" BOOLEAN NOT NULL DEFAULT false,
    "has_related_law" BOOLEAN NOT NULL DEFAULT false,
    "has_related_rule" BOOLEAN NOT NULL DEFAULT false,
    "related_precedent_note" TEXT,
    "related_law_note" TEXT,
    "related_rule_note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "articles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "article_comments" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "article_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "is_resolved" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "article_comments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "article_versions" (
    "id" TEXT NOT NULL,
    "article_id" TEXT NOT NULL,
    "version_num" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "status" "VersionStatus" NOT NULL DEFAULT 'draft',
    "change_note" TEXT,
    "approved_by" TEXT,
    "approved_at" TIMESTAMP(3),
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "article_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "variables" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "default_value" TEXT,
    "description" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "variables_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "variable_usages" (
    "id" TEXT NOT NULL,
    "version_id" TEXT NOT NULL,
    "variable_id" TEXT NOT NULL,

    CONSTRAINT "variable_usages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_groups" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notification_groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_group_members" (
    "group_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,

    CONSTRAINT "notification_group_members_pkey" PRIMARY KEY ("group_id","user_id")
);

-- CreateTable
CREATE TABLE "user_notifications" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'policy_revision',
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "policy_id" TEXT,
    "article_id" TEXT,
    "version_id" TEXT,
    "read_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "user_id" TEXT,
    "action" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT,
    "details" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "export_jobs" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "file_url" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMP(3),

    CONSTRAINT "export_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "policy_import_logs" (
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

-- CreateTable
CREATE TABLE "billing_customers" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'mock',
    "provider_customer_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "billing_customers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "billing_subscriptions" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "billing_customer_id" TEXT,
    "provider" TEXT NOT NULL DEFAULT 'mock',
    "provider_subscription_id" TEXT,
    "plan" "PlanTier" NOT NULL,
    "status" "SubscriptionStatus" NOT NULL DEFAULT 'active',
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "current_period_start" TIMESTAMP(3),
    "current_period_end" TIMESTAMP(3),
    "canceled_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "billing_subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "billing_payments" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "billing_customer_id" TEXT,
    "subscription_id" TEXT,
    "provider" TEXT NOT NULL DEFAULT 'mock',
    "provider_payment_id" TEXT,
    "provider_order_id" TEXT,
    "amount" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'KRW',
    "status" "PaymentStatus" NOT NULL DEFAULT 'succeeded',
    "paid_at" TIMESTAMP(3),
    "refund_at" TIMESTAMP(3),
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "billing_payments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tenants_slug_key" ON "tenants"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "users_tenant_id_email_key" ON "users"("tenant_id", "email");

-- CreateIndex
CREATE UNIQUE INDEX "users_oauth_provider_oauth_sub_key" ON "users"("oauth_provider", "oauth_sub");

-- CreateIndex
CREATE UNIQUE INDEX "policies_tenant_id_code_key" ON "policies"("tenant_id", "code");

-- CreateIndex
CREATE INDEX "regulation_parse_sessions_tenant_id_created_at_idx" ON "regulation_parse_sessions"("tenant_id", "created_at");

-- CreateIndex
CREATE INDEX "policy_appendices_policy_id_kind_idx" ON "policy_appendices"("policy_id", "kind");

-- CreateIndex
CREATE INDEX "policy_appendices_policy_id_sort_order_idx" ON "policy_appendices"("policy_id", "sort_order");

-- CreateIndex
CREATE INDEX "policy_templates_tenant_id_is_default_idx" ON "policy_templates"("tenant_id", "is_default");

-- CreateIndex
CREATE UNIQUE INDEX "policy_templates_tenant_id_name_key" ON "policy_templates"("tenant_id", "name");

-- CreateIndex
CREATE INDEX "sections_chapter_id_number_idx" ON "sections"("chapter_id", "number");

-- CreateIndex
CREATE INDEX "article_comments_tenant_id_article_id_idx" ON "article_comments"("tenant_id", "article_id");

-- CreateIndex
CREATE UNIQUE INDEX "variables_tenant_id_key_key" ON "variables"("tenant_id", "key");

-- CreateIndex
CREATE UNIQUE INDEX "variable_usages_version_id_variable_id_key" ON "variable_usages"("version_id", "variable_id");

-- CreateIndex
CREATE UNIQUE INDEX "notification_groups_tenant_id_name_key" ON "notification_groups"("tenant_id", "name");

-- CreateIndex
CREATE INDEX "user_notifications_user_id_read_at_created_at_idx" ON "user_notifications"("user_id", "read_at", "created_at");

-- CreateIndex
CREATE INDEX "user_notifications_tenant_id_created_at_idx" ON "user_notifications"("tenant_id", "created_at");

-- CreateIndex
CREATE INDEX "policy_import_logs_tenant_id_created_at_idx" ON "policy_import_logs"("tenant_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "billing_customers_tenant_id_key" ON "billing_customers"("tenant_id");

-- CreateIndex
CREATE INDEX "billing_customers_provider_provider_customer_id_idx" ON "billing_customers"("provider", "provider_customer_id");

-- CreateIndex
CREATE INDEX "billing_subscriptions_tenant_id_status_idx" ON "billing_subscriptions"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "billing_subscriptions_provider_provider_subscription_id_idx" ON "billing_subscriptions"("provider", "provider_subscription_id");

-- CreateIndex
CREATE INDEX "billing_subscriptions_current_period_end_idx" ON "billing_subscriptions"("current_period_end");

-- CreateIndex
CREATE INDEX "billing_payments_tenant_id_created_at_idx" ON "billing_payments"("tenant_id", "created_at");

-- CreateIndex
CREATE INDEX "billing_payments_status_paid_at_idx" ON "billing_payments"("status", "paid_at");

-- CreateIndex
CREATE INDEX "billing_payments_provider_provider_payment_id_idx" ON "billing_payments"("provider", "provider_payment_id");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "policies" ADD CONSTRAINT "policies_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "policies" ADD CONSTRAINT "policies_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "policy_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "regulation_parse_sessions" ADD CONSTRAINT "regulation_parse_sessions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "regulation_parse_sessions" ADD CONSTRAINT "regulation_parse_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "regulation_parse_sessions" ADD CONSTRAINT "regulation_parse_sessions_committed_policy_id_fkey" FOREIGN KEY ("committed_policy_id") REFERENCES "policies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "policy_appendices" ADD CONSTRAINT "policy_appendices_policy_id_fkey" FOREIGN KEY ("policy_id") REFERENCES "policies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "policy_templates" ADD CONSTRAINT "policy_templates_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chapters" ADD CONSTRAINT "chapters_policy_id_fkey" FOREIGN KEY ("policy_id") REFERENCES "policies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sections" ADD CONSTRAINT "sections_chapter_id_fkey" FOREIGN KEY ("chapter_id") REFERENCES "chapters"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "articles" ADD CONSTRAINT "articles_chapter_id_fkey" FOREIGN KEY ("chapter_id") REFERENCES "chapters"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "articles" ADD CONSTRAINT "articles_section_id_fkey" FOREIGN KEY ("section_id") REFERENCES "sections"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "article_comments" ADD CONSTRAINT "article_comments_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "article_comments" ADD CONSTRAINT "article_comments_article_id_fkey" FOREIGN KEY ("article_id") REFERENCES "articles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "article_comments" ADD CONSTRAINT "article_comments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "article_versions" ADD CONSTRAINT "article_versions_article_id_fkey" FOREIGN KEY ("article_id") REFERENCES "articles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "variables" ADD CONSTRAINT "variables_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "variable_usages" ADD CONSTRAINT "variable_usages_version_id_fkey" FOREIGN KEY ("version_id") REFERENCES "article_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "variable_usages" ADD CONSTRAINT "variable_usages_variable_id_fkey" FOREIGN KEY ("variable_id") REFERENCES "variables"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_groups" ADD CONSTRAINT "notification_groups_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_group_members" ADD CONSTRAINT "notification_group_members_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "notification_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_group_members" ADD CONSTRAINT "notification_group_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_notifications" ADD CONSTRAINT "user_notifications_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_notifications" ADD CONSTRAINT "user_notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "export_jobs" ADD CONSTRAINT "export_jobs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "policy_import_logs" ADD CONSTRAINT "policy_import_logs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "policy_import_logs" ADD CONSTRAINT "policy_import_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "policy_import_logs" ADD CONSTRAINT "policy_import_logs_policy_id_fkey" FOREIGN KEY ("policy_id") REFERENCES "policies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing_customers" ADD CONSTRAINT "billing_customers_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing_subscriptions" ADD CONSTRAINT "billing_subscriptions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing_subscriptions" ADD CONSTRAINT "billing_subscriptions_billing_customer_id_fkey" FOREIGN KEY ("billing_customer_id") REFERENCES "billing_customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing_payments" ADD CONSTRAINT "billing_payments_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing_payments" ADD CONSTRAINT "billing_payments_billing_customer_id_fkey" FOREIGN KEY ("billing_customer_id") REFERENCES "billing_customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing_payments" ADD CONSTRAINT "billing_payments_subscription_id_fkey" FOREIGN KEY ("subscription_id") REFERENCES "billing_subscriptions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

