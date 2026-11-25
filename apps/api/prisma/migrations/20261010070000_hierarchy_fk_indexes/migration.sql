-- T-141: 장·조문 FK 색인 — 규정 하나의 장·조문을 읽는 조회가 표 전체를 훑지 않게(FK 는 색인이 저절로 생기지 않는다).
-- 새 표가 아니라 기존 표의 색인만 더한다. 쓰기를 잠깐 막지만 표가 작아 금방 끝난다.
CREATE INDEX "chapters_policy_id_idx" ON "chapters"("policy_id");
CREATE INDEX "articles_chapter_id_idx" ON "articles"("chapter_id");
