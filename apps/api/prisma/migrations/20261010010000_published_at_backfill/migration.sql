-- T-111 날짜 3종 — 옛 발행 이력의 발행일 보정.
-- 발행일(published_at)은 T-108 부터 다섯 발행 경로 모두가 발행하는 순간에 적는다. 그 전 발행 이력은 비어 있는데,
-- 승인 시각(approved_at)은 처음부터 모든 발행 경로가 발행하는 그 순간에 적어 왔다(시행 승인·한꺼번에 시행·가져오기 확정).
-- 그래서 발행 이력(시행본·이전 버전)이고 발행일이 비어 있으며 승인 시각이 있는 것만 승인 시각으로 채우고 보정 표시를 남긴다.
-- 승인 시각도 없는 발행 이력(관리자 JSON 일괄 등록 등)은 근거가 없어 비워 둔다 — 생성일·시행일로 대신 채우지 않는다.
-- AlterTable
ALTER TABLE "article_versions" ADD COLUMN "published_at_from_approval" BOOLEAN NOT NULL DEFAULT false;

-- 보정
UPDATE "article_versions"
SET "published_at" = "approved_at", "published_at_from_approval" = true
WHERE "status" IN ('published', 'archived') AND "published_at" IS NULL AND "approved_at" IS NOT NULL;
