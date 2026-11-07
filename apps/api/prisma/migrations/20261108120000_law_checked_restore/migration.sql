-- T-153 ⑤ 바로잡기 — 이 변경 전에는 확인에 실패해도 last_checked_at(확인 성공 시각)을 찍었다. 지금 오류가 남은 법령의 그 값은 실패
-- 시각이고, 계속 실패하는 법령은 다음 성공이 오지 않아 저절로 바로잡히지 않는다. 실행 기록(law_sync_runs.results)에서 그 법령의
-- 마지막 성공 확인을 찾아 그 실행이 시작된 시각으로 되돌린다(실제 확인은 그 뒤다 — 늦은 시각을 말하지 않게 이르게 잡는다).
-- 성공 기록이 없으면 비운다(첫 확인 전). 성공 = 결과가 updated·unchanged 이고 남은 판이 없으며 확인 기록을 남긴 것 — 판 수·시간
-- 상한이나 경합으로 멈춘 결과는 그때도 확인 시각을 찍지 않았다. last_attempted_at(시도 시각)은 그대로 둔다.
UPDATE "laws" AS l
SET "last_checked_at" = (
  SELECT max(r."started_at")
  FROM "law_sync_runs" AS r
  CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(r."results") = 'array' THEN r."results" ELSE '[]'::jsonb END) AS x(res)
  WHERE x.res ->> 'lawId' = l."id"
    AND x.res ->> 'outcome' IN ('updated', 'unchanged')
    AND coalesce(x.res ->> 'remaining', '0') = '0'
    AND coalesce(x.res ->> 'note', '') NOT LIKE '%확인 기록을 남기지 못했습니다%'
    AND r."started_at" <= l."last_checked_at"
)
WHERE l."last_check_error" IS NOT NULL;

-- 동기화 차례는 last_attempted_at 이 맡는다 — last_checked_at 으로 고르거나 거르는 쿼리가 없다
DROP INDEX IF EXISTS "laws_last_checked_at_idx";
