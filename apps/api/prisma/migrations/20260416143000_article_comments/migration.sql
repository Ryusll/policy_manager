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

CREATE INDEX "article_comments_tenant_id_article_id_idx"
  ON "article_comments" ("tenant_id", "article_id");

ALTER TABLE "article_comments"
  ADD CONSTRAINT "article_comments_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "article_comments"
  ADD CONSTRAINT "article_comments_article_id_fkey"
  FOREIGN KEY ("article_id") REFERENCES "articles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "article_comments"
  ADD CONSTRAINT "article_comments_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
