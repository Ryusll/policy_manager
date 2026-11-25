-- CreateTable
CREATE TABLE "law_sources" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "base_url" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "law_sources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "laws" (
    "id" TEXT NOT NULL,
    "source_id" TEXT NOT NULL,
    "external_id" TEXT NOT NULL,
    "external_law_id" TEXT,
    "law_name" TEXT NOT NULL,
    "law_no" TEXT,
    "law_type" TEXT,
    "ministry" TEXT,
    "promulgated_date" DATE,
    "effective_date" DATE,
    "version_key" TEXT,
    "last_checked_at" TIMESTAMP(3),
    "source_url" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "laws_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "law_articles" (
    "id" TEXT NOT NULL,
    "law_id" TEXT NOT NULL,
    "node_key" TEXT NOT NULL,
    "article_no" INTEGER NOT NULL,
    "clause_no" INTEGER,
    "item_no" INTEGER,
    "label" TEXT NOT NULL,
    "title" TEXT,
    "content" TEXT NOT NULL,
    "version_key" TEXT NOT NULL,
    "effective_date" DATE,
    "sort_order" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "law_articles_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "law_sources_code_key" ON "law_sources"("code");

-- CreateIndex
CREATE INDEX "laws_last_checked_at_idx" ON "laws"("last_checked_at");

-- CreateIndex
CREATE UNIQUE INDEX "laws_source_id_external_id_key" ON "laws"("source_id", "external_id");

-- CreateIndex
CREATE INDEX "law_articles_law_id_sort_order_idx" ON "law_articles"("law_id", "sort_order");

-- CreateIndex
CREATE UNIQUE INDEX "law_articles_law_id_node_key_key" ON "law_articles"("law_id", "node_key");

-- AddForeignKey
ALTER TABLE "laws" ADD CONSTRAINT "laws_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "law_sources"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "law_articles" ADD CONSTRAINT "law_articles_law_id_fkey" FOREIGN KEY ("law_id") REFERENCES "laws"("id") ON DELETE CASCADE ON UPDATE CASCADE;

