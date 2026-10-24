-- T-178 (PAT-21, 특허 도 12) 감사 로그 정정 — 원 기록은 고치거나 지우지 않고, 정정은 원 기록을 가리키는 후속 기록으로 쌓는다.

-- 개정 후보 상태 전환의 종류 — 결정·요청에 따른 전환(기존 행 전부)과 앞선 결정을 바로잡는 정정(반려 정정, 시행 예정 철회)
CREATE TYPE "AmendmentChangeKind" AS ENUM ('transition', 'correction');

ALTER TABLE "amendment_state_changes" ADD COLUMN "kind" "AmendmentChangeKind" NOT NULL DEFAULT 'transition';

-- T-178 전 시행 예정 철회(T-132 ②)가 남긴 승인 → 반려 전환(사유 "승인 철회 — …")도 승인의 정정이었다 — 종류만 정정으로 채운다.
-- 승인 → 반려 전환을 남기는 경로는 그 철회 하나뿐이었다(반려는 검토 → 반려). 상태·사유·시각은 그대로 둔다
UPDATE "amendment_state_changes" SET "kind" = 'correction' WHERE "from_state" = 'approved' AND "to_state" = 'rejected';

-- [legacy-detach:start]
-- T-178 전 시행 예정 철회는 초안에 원천 후보·변경 이벤트를 남겼다(T-178 철회는 늘 뗀다). 그래서 발행되지 않은 버전(초안·검토 중)이 후보를
-- 원천으로 쥐고 있으면 모두 그 옛 초안이다 — 그대로 두면 그 초안을 일반 승인·한꺼번에 시행으로 발행하는 순간 그 후보를 다시 승인할 수
-- 없다(원천 후보 id 는 유일). 버전마다 그 버전 대상 감사(cause migration, 수행자 없음)를 남기고 연결을 뗀다. 발행된 버전은 건드리지 않는다
INSERT INTO "audit_logs" ("id", "tenant_id", "user_id", "action", "entity_type", "entity_id", "details")
SELECT gen_random_uuid()::text, c."tenant_id", NULL, 'version.source_detach', 'ArticleVersion', v."id",
       jsonb_build_object(
         'candidateId', v."source_candidate_id",
         'cause', 'migration',
         'newVersionId', NULL,
         'status', v."status"::text,
         'versionNum', v."version_num",
         'before', jsonb_build_object('sourceCandidateId', v."source_candidate_id", 'changeEventId', v."change_event_id"),
         'after', jsonb_build_object('sourceCandidateId', NULL, 'changeEventId', NULL)
       )
FROM "article_versions" v
JOIN "amendment_candidates" c ON c."id" = v."source_candidate_id"
WHERE v."status" IN ('draft', 'review');

UPDATE "article_versions" v SET "source_candidate_id" = NULL, "change_event_id" = NULL
FROM "amendment_candidates" c
WHERE c."id" = v."source_candidate_id" AND v."status" IN ('draft', 'review');
-- [legacy-detach:end]

-- 정정 대상 — 같은 회사의 원 감사 기록. 원 기록이 지워지는 길은 회사 삭제(연쇄, 한 문장 안에서 둘 다 지워진다)뿐이라 NO ACTION
ALTER TABLE "audit_logs" ADD COLUMN "corrects_id" TEXT;

-- 조회 색인 — 회사별 최신순 목록, 대상(entity)별 기록, 정정 사슬(원 기록 → 정정 기록)
CREATE INDEX "audit_logs_tenant_id_created_at_idx" ON "audit_logs"("tenant_id", "created_at");

CREATE INDEX "audit_logs_tenant_id_entity_type_entity_id_created_at_idx" ON "audit_logs"("tenant_id", "entity_type", "entity_id", "created_at");

CREATE INDEX "audit_logs_tenant_id_corrects_id_idx" ON "audit_logs"("tenant_id", "corrects_id");

ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_corrects_id_fkey" FOREIGN KEY ("corrects_id") REFERENCES "audit_logs"("id") ON DELETE NO ACTION ON UPDATE CASCADE;
