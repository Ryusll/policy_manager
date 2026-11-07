-- T-152 검토 반영 — 개정 정보를 읽지 못한 마지막 시각(본문 조회 실패·다른 판 본문). 채우기는 실패한 적 없는 판부터 읽고,
-- 실패한 판은 오래전에 실패한 것부터 다시 본다(계속 실패하는 판이 맨 앞에 남아 뒤 판을 막지 않게). 비어도 되는 칸이라 채우는 단계가 없다.
ALTER TABLE "law_versions" ADD COLUMN "revision_info_tried_at" TIMESTAMP(3);
