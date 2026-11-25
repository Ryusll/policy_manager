-- DropIndex
DROP INDEX "amendment_candidates_tenant_id_change_event_id_article_id_b_key";

-- AlterTable
ALTER TABLE "amendment_candidates" ADD COLUMN     "base_fingerprint" TEXT;

-- AlterTable
ALTER TABLE "article_versions" ADD COLUMN     "change_event_id" TEXT,
ADD COLUMN     "published_at" TIMESTAMP(3),
ADD COLUMN     "source_candidate_id" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "amendment_candidates_tenant_id_change_event_id_article_id_b_key" ON "amendment_candidates"("tenant_id", "change_event_id", "article_id", "base_version_id", "base_fingerprint", "generation_method", "variant");

-- CreateIndex
CREATE UNIQUE INDEX "article_versions_source_candidate_id_key" ON "article_versions"("source_candidate_id");

-- AddForeignKey
ALTER TABLE "article_versions" ADD CONSTRAINT "article_versions_change_event_id_fkey" FOREIGN KEY ("change_event_id") REFERENCES "law_change_events"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "article_versions" ADD CONSTRAINT "article_versions_source_candidate_id_fkey" FOREIGN KEY ("source_candidate_id") REFERENCES "amendment_candidates"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- 기존 후보(T-106·T-107)의 발행 이력 지문을 지금 이력으로 채운다. 비워 두면 같은 기준 본문으로 다시 만들 때
-- 유니크 키가 막지 못해(NULL 은 서로 다르다) 같은 후보가 또 생기고, 승인 때 비교할 값도 없다.
-- 계산은 서비스(amendment-revision.ts 의 historyFingerprint)와 같다 — 줄 형식·정렬(바이트 순서)·접두어까지.
UPDATE "amendment_candidates" c
SET "base_fingerprint" = 'fp1:' || encode(sha256(convert_to((
  SELECT string_agg(
           v."id" || '|' || v."status"::text || '|' || coalesce(to_char(v."effective_date", 'YYYY-MM-DD'), '') || '|' || v."version_num"::text,
           E'\n' ORDER BY v."id" COLLATE "C")
  FROM "article_versions" v
  WHERE v."article_id" = c."article_id" AND v."status" IN ('published', 'archived')
), 'UTF8')), 'hex')
WHERE c."base_fingerprint" IS NULL;
