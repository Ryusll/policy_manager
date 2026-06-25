-- 조문별 판·법·규 근거 메모(자유 입력)
ALTER TABLE "articles" ADD COLUMN IF NOT EXISTS "related_precedent_note" TEXT;
ALTER TABLE "articles" ADD COLUMN IF NOT EXISTS "related_law_note" TEXT;
ALTER TABLE "articles" ADD COLUMN IF NOT EXISTS "related_rule_note" TEXT;
