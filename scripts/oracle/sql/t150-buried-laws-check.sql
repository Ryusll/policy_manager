-- T-150 ④ 점검(읽기 전용): 시행 예정 판으로 등록돼 그 개정이 변경 이벤트 없이 묻힌 법령
--
-- 실행: ORACLE_SSH=ubuntu@<서버주소> bash scripts/oracle/run-readonly-sql.sh scripts/oracle/sql/t150-buried-laws-check.sql
-- 새 표(law_versions, T-151)를 쓰지 않으므로 T-151 배포 전에도 돈다. 0건이어야 한다. 있으면 T-151 배포 뒤 첫 동기화 전에
-- 법령마다 `law-sync.sh --rebaseline <법령 id>` 로 계획을 보고 `--apply` 로 되돌린다(DB 백업 뒤, 동기화 cron 을 멈추고 — 런북 7-5).
-- 법령 본문은 내보내지 않는다 — 법령명·id·MST·날짜·건수만.
--
-- 묻힘의 징후: 법령 행의 시행일(지금 판의 본문 기본정보 시행일)이 등록한 날(한국 날짜)보다 뒤인데, 그 시행일로 남은 변경 이벤트가
-- 없다 — 등록 때 아직 시행 전이던 판을 기준판으로 삼아, 그 판이 바꾼 조가 이벤트·개정 후보 없이 본문에만 들어갔다.
-- (등록 뒤 동기화가 더 새 판을 반영했으면 법령 행의 시행일이 그 판의 것이라 잡히지 않는다 — 그 경우는 보정도 막힌다.)
BEGIN TRANSACTION READ ONLY;

SELECT l.law_name                                                         AS "법령명",
       l.id                                                               AS "법령_id",
       l.external_id                                                      AS "저장_MST",
       l.external_law_id                                                  AS "법령ID",
       l.effective_date                                                   AS "저장_판_시행일",
       (l.created_at AT TIME ZONE 'Asia/Seoul')::date                     AS "등록일",
       (SELECT count(*) FROM law_change_events e WHERE e.law_id = l.id)   AS "이벤트",
       (SELECT count(*) FROM law_links k JOIN law_articles a ON a.id = k.law_article_id WHERE a.law_id = l.id) AS "연결"
FROM laws l
WHERE l.effective_date > (l.created_at AT TIME ZONE 'Asia/Seoul')::date
  AND NOT EXISTS (SELECT 1 FROM law_change_events e WHERE e.law_id = l.id AND e.law_effective_date = l.effective_date)
ORDER BY l.law_name;

-- 처리하지 않은 변경 이벤트 — 보정 뒤 `--law` 동기화의 끝은 이 이벤트 전부(그 법령 밖 포함)의 개정 후보·알림을 만든다. 0 이어야 한다(런북 7-5 의 2-1)
SELECT count(*) AS "처리하지_않은_이벤트" FROM law_change_events WHERE amendments_processed_at IS NULL;

ROLLBACK;
