-- T-150 ④ 점검(읽기 전용): 시행 예정 판으로 등록돼 그 개정이 변경 이벤트 없이 묻힌 법령
--
-- 실행: ORACLE_SSH=ubuntu@<서버주소> bash scripts/oracle/run-readonly-sql.sh scripts/oracle/sql/t150-buried-laws-check.sql
-- 0건이어야 한다. 있으면 법령마다 `law-sync.sh --rebaseline <법령 id>` 로 계획을 보고 `--apply` 로 되돌린다(DB 백업 뒤, 동기화 cron 을
-- 멈추고 — 런북 7-5). 법령 본문은 내보내지 않는다 — 법령명·id·MST·날짜·건수만.
--
-- 묻힘의 징후: 저장 판이 시행에 들어가는 날이 등록한 날(한국 날짜)보다 뒤인데, 그 판의 본문 시행일로 남은 변경 이벤트가 없다 — 등록 때
-- 아직 시행 전이던 판을 기준판으로 삼아, 그 판이 바꾼 조가 이벤트·개정 후보 없이 본문에만 들어갔다.
-- 시행에 들어가는 날은 보정(`--rebaseline`)과 같은 기준이다 — 단계 시행 판은 첫 단계일(판 기록의 단계 시행일), 판 기록에 단계가 없으면
-- 법령 행의 시행일. 본문 시행일만 보면 등록 때 첫 단계가 이미 시행 중이던 판이 잡혔다(2026-11-01 운영의 산업안전보건법·상법 시행령, T-199 ⑤).
-- created_at 은 UTC 값을 담은 timestamp(시간대 없음)라 UTC 로 읽은 뒤 한국 날짜로 바꾼다(T-150 검토).
-- (등록 뒤 동기화가 더 새 판을 반영했으면 법령 행이 그 판을 가리켜 잡히지 않는다 — 그 경우는 `--reset` 없이는 보정이 막힌다.)
-- 등록한 판보다 먼저 공포된 판이 등록 때 시행 전이어서 묻힌 경우는 이 SQL 로 보이지 않는다 — `law-sync.sh --rebaseline all`(런북 7-5 2-1).
BEGIN TRANSACTION READ ONLY;

WITH stored AS (
  SELECT l.id,
         l.law_name,
         l.external_id,
         l.external_law_id,
         l.effective_date,
         (l.created_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Seoul')::date AS registered_on,
         COALESCE(
           (SELECT min(d) FROM law_versions v CROSS JOIN LATERAL unnest(v.stage_effective_dates) AS d
             WHERE v.law_id = l.id AND v.mst = l.external_id),
           l.effective_date) AS starts_on
  FROM laws l
)
SELECT s.law_name                                                         AS "법령명",
       s.id                                                               AS "법령_id",
       s.external_id                                                      AS "저장_MST",
       s.external_law_id                                                  AS "법령ID",
       s.starts_on                                                        AS "저장_판_시행_시작일",
       s.effective_date                                                   AS "본문_시행일",
       s.registered_on                                                    AS "등록일",
       (SELECT count(*) FROM law_change_events e WHERE e.law_id = s.id)   AS "이벤트",
       (SELECT count(*) FROM law_links k JOIN law_articles a ON a.id = k.law_article_id WHERE a.law_id = s.id) AS "연결"
FROM stored s
WHERE s.starts_on > s.registered_on
  AND NOT EXISTS (SELECT 1 FROM law_change_events e WHERE e.law_id = s.id AND e.law_effective_date = s.effective_date)
ORDER BY s.law_name;

-- 처리하지 않은 변경 이벤트 — 보정 뒤 `--law` 동기화의 끝은 이 이벤트 전부(그 법령 밖 포함)의 개정 후보·알림을 만든다. 0 이어야 한다(런북 7-5 의 2-1)
SELECT count(*) AS "처리하지_않은_이벤트" FROM law_change_events WHERE amendments_processed_at IS NULL;

ROLLBACK;
