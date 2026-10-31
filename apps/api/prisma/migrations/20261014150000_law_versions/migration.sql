-- T-151(PAT-07, 특허 도 7 S770): 법령 판 기록 — 두 확인 사이에 공포된 판을 공포 순으로 하나씩 반영하고, 변경 이벤트가 판을 가리킨다.
-- 이미 등록된 법령은 지금 판을 기준판(baseline)으로 옮겨 적는다(이벤트 없음). 순서 키는 TS 한 곳에서만 계산하므로 비워 두고 첫 동기화가 채운다.
-- 옛 이벤트의 판 칸은 비워 둔다(대장 T-151).

CREATE TYPE "LawVersionKind" AS ENUM ('baseline', 'change');

CREATE TABLE "law_versions" (
    "id" TEXT NOT NULL,
    "law_id" TEXT NOT NULL,
    "mst" TEXT NOT NULL,
    "previous_mst" TEXT,
    "kind" "LawVersionKind" NOT NULL,
    "order_key" TEXT,
    "law_type" TEXT,
    "promulgated_date" DATE,
    "promulgation_no" TEXT,
    "revision_type" TEXT,
    "effective_date" DATE,
    "stage_effective_dates" DATE[] DEFAULT ARRAY[]::DATE[],
    "version_key" TEXT,
    "received_via" "LawEventChannel",
    "event_count" INTEGER NOT NULL DEFAULT 0,
    "recorded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "law_versions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "law_versions_law_id_mst_key" ON "law_versions"("law_id", "mst");
CREATE INDEX "law_versions_law_id_order_key_idx" ON "law_versions"("law_id", "order_key");

ALTER TABLE "law_versions" ADD CONSTRAINT "law_versions_law_id_fkey" FOREIGN KEY ("law_id") REFERENCES "laws"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "law_change_events" ADD COLUMN "law_version_id" TEXT;

CREATE UNIQUE INDEX "law_change_events_law_version_id_node_key_key" ON "law_change_events"("law_version_id", "node_key");

ALTER TABLE "law_change_events" ADD CONSTRAINT "law_change_events_law_version_id_fkey" FOREIGN KEY ("law_version_id") REFERENCES "law_versions"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- 이미 등록된 법령마다 지금 판을 기준판으로 — 동기화는 이 판 다음부터 걷는다
INSERT INTO "law_versions" ("id", "law_id", "mst", "kind", "law_type", "promulgated_date", "promulgation_no", "effective_date", "version_key", "recorded_at")
SELECT gen_random_uuid()::text, "id", "external_id", 'baseline', "law_type", "promulgated_date", "law_no", "effective_date", "version_key", CURRENT_TIMESTAMP
FROM "laws";
