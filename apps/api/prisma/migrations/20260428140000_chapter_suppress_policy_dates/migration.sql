-- 장 헤더 숨김(조문만 구성), 규정 개정일·시행일
ALTER TABLE "chapters" ADD COLUMN IF NOT EXISTS "suppress_header" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "policies" ADD COLUMN IF NOT EXISTS "revision_date" DATE;
ALTER TABLE "policies" ADD COLUMN IF NOT EXISTS "effective_date" DATE;
