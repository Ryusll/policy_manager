-- T-153 ⑤ — 확인 시도 시각(동기화 대상을 오래된 순으로 고르는 열)과 확인 성공 시각(last_checked_at)을 나눈다.
-- 지금까지는 실패해도 last_checked_at 을 찍어, 앞 판으로 등록한 법령이 확인 실패 뒤에도 '현행'으로 보였다. 앞으로 last_checked_at 은
-- 성공 때만 찍고, 정렬은 새 열이 맡는다. 기존 값은 시도 시각으로 그대로 옮긴다(지난 실패로 찍힌 확인 시각은 다음 성공이 바로잡는다).
ALTER TABLE "laws" ADD COLUMN "last_attempted_at" TIMESTAMP(3);
UPDATE "laws" SET "last_attempted_at" = "last_checked_at";
CREATE INDEX "laws_last_attempted_at_idx" ON "laws"("last_attempted_at");
