-- T-144(PAT-06): 조마다 다른 시행일 표기 — 조항에 현재 표기, 변경 이벤트에 그때의 스냅샷, 법령에 표기를 읽은 규칙의 판.
-- 새 표·보정 SQL 없음. 이미 등록된 법령은 판 null(읽지 않음) — 주기 동기화가 다음에 같은 판을 한 번 읽어 채운다(이벤트는 만들지 않는다).
ALTER TABLE "law_articles" ADD COLUMN "effective_notes" JSONB;
ALTER TABLE "law_change_events" ADD COLUMN "effective_info" JSONB;
ALTER TABLE "laws" ADD COLUMN "effective_notes_version" INTEGER;
