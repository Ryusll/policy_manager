-- T-109 ② 개정 후보의 예정 사내 시행일과 변수 입력 지문 — 같은 기준 본문이라도 예정일·변수 값이 다르면 다른 후보다
ALTER TABLE "amendment_candidates" ADD COLUMN "planned_effective_date" DATE;
ALTER TABLE "amendment_candidates" ADD COLUMN "variable_fingerprint" TEXT NOT NULL DEFAULT '';
-- 기존 후보(rule/1)의 예정일은 만들 때의 기준일로 둔다 — 변수를 넣지 않았으니 지문은 빈 값
UPDATE "amendment_candidates" SET "planned_effective_date" = "as_of_date";
ALTER TABLE "amendment_candidates" ALTER COLUMN "planned_effective_date" SET NOT NULL;

DROP INDEX "amendment_candidates_tenant_id_change_event_id_article_id_b_key";
CREATE UNIQUE INDEX "amendment_candidates_tenant_id_change_event_id_article_id_b_key" ON "amendment_candidates"("tenant_id", "change_event_id", "article_id", "base_version_id", "base_fingerprint", "generation_method", "variant", "planned_effective_date", "variable_fingerprint");
