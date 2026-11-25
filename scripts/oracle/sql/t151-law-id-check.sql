-- T-151 운영 반영 전 점검(읽기 전용): 법령ID 없는 법령 행과 같은 법령의 중복 행
--
-- 실행: ORACLE_SSH=ubuntu@<서버주소> bash scripts/oracle/run-readonly-sql.sh scripts/oracle/sql/t151-law-id-check.sql
-- 새 표를 쓰지 않으므로 배포 전에 돈다. 두 결과 모두 0건이어야 한다. 있으면 런북 7-5 의 순서를 따른다
-- (해제·삭제부터 하지 않는다 — 연결과 변경 이력이 지워진다). 법령 본문은 내보내지 않는다 — 법령명·MST·법령ID·날짜·건수만.
BEGIN TRANSACTION READ ONLY;

-- ① 법령ID 없는 행 — 판 목록을 법령ID 로 받으므로 동기화되지 않는다(T-151).
--    같은_이름_다른_행 이 0 이고 ②에 같은 법령명이 없으면 같은 판(저장 MST)을 다시 등록해 법령ID 를 채운다(저장 공포일이 늦은 행부터).
--    그 밖은 옛 중복 — T-154 로 넘긴다. 이름이 바뀐 법령은 같은 이름으로 잡히지 않는다 — 의심되면 T-154.
SELECT l.law_name                                                       AS "법령명",
       l.external_id                                                    AS "저장_MST",
       l.promulgated_date                                               AS "저장_공포일",
       (SELECT count(*) FROM law_links k JOIN law_articles a ON a.id = k.law_article_id WHERE a.law_id = l.id) AS "연결",
       (SELECT count(*) FROM amendment_candidates c JOIN law_change_events e ON e.id = c.change_event_id
         WHERE e.law_id = l.id)                                         AS "개정후보",
       (SELECT count(*) FROM laws o WHERE o.source_id = l.source_id AND o.law_name = l.law_name AND o.id <> l.id) AS "같은_이름_다른_행"
FROM laws l
WHERE l.external_law_id IS NULL
ORDER BY l.law_name, l.promulgated_date DESC NULLS LAST, l.external_id;

-- ② 같은 법령ID 의 행이 둘 이상(옛 중복) — 연결을 한 행으로 모으고 나머지를 지우는 정리는 T-154.
SELECT l.external_law_id                                       AS "법령ID",
       min(l.law_name)                                         AS "법령명",
       count(*)                                                AS "행",
       string_agg(l.external_id, ', ' ORDER BY l.created_at)   AS "저장_MST들"
FROM laws l
WHERE l.external_law_id IS NOT NULL
GROUP BY l.source_id, l.external_law_id
HAVING count(*) > 1
ORDER BY 2;

ROLLBACK;
