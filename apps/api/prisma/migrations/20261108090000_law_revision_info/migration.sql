-- T-152 법제처 개정 정보 — 약칭은 법령 행, 제개정이유·개정문과 읽은 시각은 판 행에 둔다.
-- 모두 비어도 되는 칸이라 채우는 단계가 없다. 이미 등록된 법령은 다음 동기화가 본문을 읽어 이벤트 없이 채운다.
ALTER TABLE "laws" ADD COLUMN "short_title" TEXT;

ALTER TABLE "law_versions"
  ADD COLUMN "revision_reason" TEXT,
  ADD COLUMN "amendment_text" TEXT,
  ADD COLUMN "revision_info_at" TIMESTAMP(3);
