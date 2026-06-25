CREATE TYPE "PolicyAppendixKind" AS ENUM ('supplementary', 'annex', 'form');

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

CREATE INDEX "policy_appendices_policy_id_kind_idx" ON "policy_appendices"("policy_id", "kind");

CREATE INDEX "policy_appendices_policy_id_sort_order_idx" ON "policy_appendices"("policy_id", "sort_order");

ALTER TABLE "policy_appendices" ADD CONSTRAINT "policy_appendices_policy_id_fkey" FOREIGN KEY ("policy_id") REFERENCES "policies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
