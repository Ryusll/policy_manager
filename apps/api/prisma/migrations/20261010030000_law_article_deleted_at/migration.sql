-- T-124 법령에서 사라진 조항을 지우지 않고 표시만 한다 — 회사들이 걸어 둔 연결(law_links)이
-- cascade 로 함께 지워져, 삭제 개정에 영향받는 사내 조문을 찾지 못하던 문제. 기존 행은 모두 살아 있는 조항이다.
ALTER TABLE "law_articles" ADD COLUMN "deleted_at" TIMESTAMP(3);
