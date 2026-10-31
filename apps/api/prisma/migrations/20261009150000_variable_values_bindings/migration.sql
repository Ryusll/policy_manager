-- T-109 ① 변수 값·유효기간과 본문 위치 연결(특허 청구항 5·9, 도 9). 옛 기본값·사용 기록을 옮긴 뒤 지운다

-- CreateEnum
CREATE TYPE "VariableBindingOrigin" AS ENUM ('manual', 'marker', 'legacy', 'inherited');

-- CreateEnum
CREATE TYPE "VariableBindingState" AS ENUM ('active', 'needs_review', 'released');

-- CreateTable
CREATE TABLE "variable_values" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "variable_id" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "valid_from" DATE,
    "valid_to" DATE,
    "period_confirmed" BOOLEAN NOT NULL DEFAULT true,
    "note" TEXT,
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

CONSTRAINT "variable_values_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "variable_bindings" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "variable_id" TEXT NOT NULL,
    "article_id" TEXT NOT NULL,
    "version_id" TEXT NOT NULL,
    "start" INTEGER NOT NULL,
    "end" INTEGER NOT NULL,
    "text" TEXT NOT NULL,
    "context_before" TEXT NOT NULL,
    "context_after" TEXT NOT NULL,
    "occurrence" INTEGER NOT NULL,
    "origin" "VariableBindingOrigin" NOT NULL,
    "state" "VariableBindingState" NOT NULL DEFAULT 'active',
    "review_reason" TEXT,
    "value_id" TEXT,
    "parent_id" TEXT,
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

CONSTRAINT "variable_bindings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "variable_values_variable_id_valid_from_idx" ON "variable_values"("variable_id", "valid_from");

-- CreateIndex
CREATE INDEX "variable_bindings_version_id_state_idx" ON "variable_bindings"("version_id", "state");

-- CreateIndex
CREATE INDEX "variable_bindings_variable_id_state_idx" ON "variable_bindings"("variable_id", "state");

-- CreateIndex
CREATE INDEX "variable_bindings_article_id_idx" ON "variable_bindings"("article_id");

-- AddForeignKey
ALTER TABLE "variable_values" ADD CONSTRAINT "variable_values_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "variable_values" ADD CONSTRAINT "variable_values_variable_id_fkey" FOREIGN KEY ("variable_id") REFERENCES "variables"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "variable_bindings" ADD CONSTRAINT "variable_bindings_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "variable_bindings" ADD CONSTRAINT "variable_bindings_variable_id_fkey" FOREIGN KEY ("variable_id") REFERENCES "variables"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "variable_bindings" ADD CONSTRAINT "variable_bindings_article_id_fkey" FOREIGN KEY ("article_id") REFERENCES "articles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "variable_bindings" ADD CONSTRAINT "variable_bindings_version_id_fkey" FOREIGN KEY ("version_id") REFERENCES "article_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "variable_bindings" ADD CONSTRAINT "variable_bindings_value_id_fkey" FOREIGN KEY ("value_id") REFERENCES "variable_values"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "variable_bindings" ADD CONSTRAINT "variable_bindings_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "variable_bindings"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 옛 기본값(defaultValue) → 기간을 모르는 값. "처음부터"와 "모름"은 다르므로 기간 미확정(period_confirmed = false)으로
-- 넣는다 — 관리자가 기간을 정하기 전에는 개정 후보에 쓰지 않는다(T-109 코덱스 자문 결정 4)
INSERT INTO "variable_values" ("id", "tenant_id", "variable_id", "value", "valid_from", "valid_to", "period_confirmed", "note", "created_at", "updated_at")
SELECT gen_random_uuid()::text, v."tenant_id", v."id", v."default_value", NULL, NULL, false,
       '옛 기본값을 옮긴 값 — 유효기간을 정해야 개정 후보에 쓴다', now(), now()
FROM "variables" v
WHERE v."default_value" IS NOT NULL AND btrim(v."default_value") <> '';

-- 옛 사용 기록(variable_usages: "이 버전이 이 변수를 쓴다")을 표식 {{KEY}} 이 나오는 자리마다의 연결로 옮긴다.
-- 위치는 UTF-16 기준인데 strpos 는 문자(코드 포인트) 기준이라, 앞에 BMP 밖 문자(이모지 등)가 있으면 어긋날 수 있다 —
-- 그런 연결은 "위치 확인 필요"로 둔다. 변수의 회사와 버전의 실제 소속이 다른 기록은 잘못 이은 것이라 옮기지 않는다.
-- 발행 본문은 바꾸지 않는다(사용 기록만으로 어떤 값이 들어갔는지 추정하지 않는다).
WITH RECURSIVE u AS (
  SELECT vu."variable_id", av."article_id", av."id" AS "version_id", av."content", p."tenant_id",
         '{{' || var."key" || '}}' AS "token"
  FROM "variable_usages" vu
  JOIN "variables" var ON var."id" = vu."variable_id"
  JOIN "article_versions" av ON av."id" = vu."version_id"
  JOIN "articles" ar ON ar."id" = av."article_id"
  JOIN "chapters" c ON c."id" = ar."chapter_id"
  JOIN "policies" p ON p."id" = c."policy_id"
  WHERE var."tenant_id" = p."tenant_id"
),
occ AS (
  SELECT u."variable_id", u."article_id", u."version_id", u."content", u."tenant_id", u."token",
         strpos(u."content", u."token") AS "pos", 0 AS "n"
  FROM u
  WHERE strpos(u."content", u."token") > 0
  UNION ALL
  SELECT o."variable_id", o."article_id", o."version_id", o."content", o."tenant_id", o."token",
         o."pos" + length(o."token") - 1 + strpos(substr(o."content", o."pos" + length(o."token")), o."token"),
         o."n" + 1
  FROM occ o
  WHERE strpos(substr(o."content", o."pos" + length(o."token")), o."token") > 0
)
INSERT INTO "variable_bindings" ("id", "tenant_id", "variable_id", "article_id", "version_id", "start", "end", "text",
  "context_before", "context_after", "occurrence", "origin", "state", "review_reason", "created_at", "updated_at")
SELECT gen_random_uuid()::text, o."tenant_id", o."variable_id", o."article_id", o."version_id",
       o."pos" - 1, o."pos" - 1 + length(o."token"), o."token",
       substr(o."content", greatest(o."pos" - 20, 1), o."pos" - greatest(o."pos" - 20, 1)),
       substr(o."content", o."pos" + length(o."token"), 20),
       o."n", 'legacy',
       (CASE WHEN substr(o."content", 1, o."pos" - 1) ~ '[\U00010000-\U0010FFFF]' THEN 'needs_review' ELSE 'active' END)::"VariableBindingState",
       CASE WHEN substr(o."content", 1, o."pos" - 1) ~ '[\U00010000-\U0010FFFF]' THEN 'position_unverified' END,
       now(), now()
FROM occ o;

-- 본문에 그 표식이 없는 옛 기록(사용 기록 API 로 직접 넣은 것)은 위치 없이 "다시 이어야 함"으로 남긴다
INSERT INTO "variable_bindings" ("id", "tenant_id", "variable_id", "article_id", "version_id", "start", "end", "text",
  "context_before", "context_after", "occurrence", "origin", "state", "review_reason", "created_at", "updated_at")
SELECT gen_random_uuid()::text, p."tenant_id", vu."variable_id", av."article_id", av."id", 0, 0, '{{' || var."key" || '}}',
       '', '', 0, 'legacy', 'needs_review', 'legacy_unmatched', now(), now()
FROM "variable_usages" vu
JOIN "variables" var ON var."id" = vu."variable_id"
JOIN "article_versions" av ON av."id" = vu."version_id"
JOIN "articles" ar ON ar."id" = av."article_id"
JOIN "chapters" c ON c."id" = ar."chapter_id"
JOIN "policies" p ON p."id" = c."policy_id"
WHERE var."tenant_id" = p."tenant_id" AND strpos(av."content", '{{' || var."key" || '}}') = 0;

-- 옮겼으니 옛 사용 기록 표와 기본값 열을 지운다
-- DropForeignKey
ALTER TABLE "variable_usages" DROP CONSTRAINT "variable_usages_version_id_fkey";

-- DropForeignKey
ALTER TABLE "variable_usages" DROP CONSTRAINT "variable_usages_variable_id_fkey";

-- AlterTable
ALTER TABLE "variables" DROP COLUMN "default_value";

-- DropTable
DROP TABLE "variable_usages";
