-- 절(節) 계층 추가 — 선택 계층. ADR-0011 참고
-- 조(Article)는 절에 속하지 않아도 되므로 articles.section_id 는 nullable.

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

-- CreateIndex
CREATE INDEX "sections_chapter_id_number_idx" ON "sections"("chapter_id", "number");

-- AddForeignKey
ALTER TABLE "sections" ADD CONSTRAINT "sections_chapter_id_fkey"
    FOREIGN KEY ("chapter_id") REFERENCES "chapters"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterTable
ALTER TABLE "articles" ADD COLUMN "section_id" TEXT;

-- AddForeignKey
ALTER TABLE "articles" ADD CONSTRAINT "articles_section_id_fkey"
    FOREIGN KEY ("section_id") REFERENCES "sections"("id") ON DELETE SET NULL ON UPDATE CASCADE;
