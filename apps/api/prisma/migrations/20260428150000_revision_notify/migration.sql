CREATE TABLE IF NOT EXISTS "notification_groups" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "notification_groups_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "notification_group_members" (
    "group_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    CONSTRAINT "notification_group_members_pkey" PRIMARY KEY ("group_id","user_id")
);

CREATE TABLE IF NOT EXISTS "user_notifications" (
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

CREATE UNIQUE INDEX IF NOT EXISTS "notification_groups_tenant_id_name_key" ON "notification_groups"("tenant_id", "name");
CREATE INDEX IF NOT EXISTS "user_notifications_user_id_read_at_created_at_idx" ON "user_notifications"("user_id", "read_at", "created_at");
CREATE INDEX IF NOT EXISTS "user_notifications_tenant_id_created_at_idx" ON "user_notifications"("tenant_id", "created_at");

ALTER TABLE "notification_groups" ADD CONSTRAINT "notification_groups_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "notification_group_members" ADD CONSTRAINT "notification_group_members_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "notification_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "notification_group_members" ADD CONSTRAINT "notification_group_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "user_notifications" ADD CONSTRAINT "user_notifications_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "user_notifications" ADD CONSTRAINT "user_notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
