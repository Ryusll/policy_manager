-- T-121 운영 점검: PDF로 가져와 등록한 규정 중 내용이 빠졌을 수 있는 규정 (읽기 전용)
--
-- 출력은 회사·규정 코드·규정명·날짜와 건수뿐이다. 규정 본문은 내보내지 않는다.
-- 실행: scripts/oracle/run-readonly-sql.sh 로 돌린다(접속 자체를 읽기 전용으로 연다).
--
-- 배경(작업관리대장 C-44): 10/7 수정 배포 전 PDF 가져오기는
--   ① 항(①)·호(1.)·목(가.)의 첫 줄을 버렸고(한 줄짜리 항은 통째로),
--   ② 문서 제목을 가짜 "제1조 머리말"로 만들어 조 번호를 한 칸씩 밀었다.
-- 가져올 때의 원본 트리가 세션(regulation_parse_sessions.parse_tree)에 남아 있어서,
-- "제목 칸에 번호가 아닌 문장이 든 항·호·목"을 세면 버려진 줄 수를 정확히 알 수 있다.
-- 수정이 운영에 들어간 시각(배포 직전 백업 2026-10-07 13:44:45 UTC) 이후에 등록한 건은 해당 없다.
BEGIN TRANSACTION READ ONLY;

WITH imported AS (
  -- updated_at = 등록(커밋)한 시각. 파싱만 해 두고 수정 배포 뒤 등록한 건은 새 코드가 첫 줄을 살린다.
  SELECT s.id, s.updated_at AS committed_at, s.committed_policy_id AS policy_id, s.parse_tree,
         s.updated_at < timestamptz '2026-10-07 13:44:45+00' AS before_fix
    FROM regulation_parse_sessions s
   WHERE s.status = 'committed'
     AND s.committed_policy_id IS NOT NULL
     AND coalesce(s.mime_type, '') ILIKE '%pdf%'
),
nodes AS (
  SELECT i.id AS session_id, n
    FROM imported i
   CROSS JOIN LATERAL jsonb_path_query(coalesce(i.parse_tree, '{}'::jsonb), 'strict $.**') AS n
   WHERE jsonb_typeof(n) = 'object' AND n ? 'articleNumber'
),
per_session AS (
  SELECT session_id,
         -- 항·호·목인데 제목 칸에 번호 표기 대신 문장이 든 것 = 등록 때 버려진 첫 줄
         count(*) FILTER (
           WHERE (n->>'articleNumber') ~ '^(C[0-9]+|[0-9]+(\.[0-9]+)*|Hp?.|PN[0-9]+)$'
             AND btrim(coalesce(n->>'articleTitle', '')) !~
                 '^(제 *[0-9]+ *[항호목]|[①-⑳]|[0-9]+(\.[0-9]+)*[.)]?|.[.)]?|\([0-9]+\)|\(.\)|항목 [0-9]+)?$'
         ) AS lost_lines
    FROM nodes
   GROUP BY session_id
),
rows_now AS (
  SELECT c.policy_id,
         count(*) FILTER (WHERE a.clause_number IS NOT NULL OR a.item_number IS NOT NULL) AS sub_rows,
         count(*) FILTER (
           WHERE (a.clause_number IS NOT NULL OR a.item_number IS NOT NULL)
             AND NOT EXISTS (
               SELECT 1 FROM article_versions v
                WHERE v.article_id = a.id AND v.status = 'published' AND length(btrim(v.content)) > 0
             )
         ) AS empty_sub_rows
    FROM chapters c
    JOIN articles a ON a.chapter_id = c.id
   GROUP BY c.policy_id
)
SELECT t.slug                                       AS 회사,
       p.code                                       AS 규정코드,
       p.title                                      AS 규정명,
       i.committed_at::date                         AS 등록일,
       i.before_fix                                 AS 수정전_등록,
       CASE WHEN i.before_fix THEN coalesce(ps.lost_lines, 0) ELSE 0 END AS 첫줄_빠진_항목수,
       -- 수정 전 등록은 문서 제목으로 가짜 "제1조 머리말"을 만들어 뒤 조 번호를 한 칸씩 밀었다
       EXISTS (
         SELECT 1 FROM chapters c2 JOIN articles a2 ON a2.chapter_id = c2.id
          WHERE c2.policy_id = p.id AND a2.title = '머리말'
            AND a2.clause_number IS NULL AND a2.item_number IS NULL
       )                                            AS 조번호_밀림,
       coalesce(r.sub_rows, 0)                      AS 현재_항목행수,
       coalesce(r.empty_sub_rows, 0)                AS 본문빈_항목행수
  FROM imported i
  JOIN policies p ON p.id = i.policy_id   -- 지운 규정은 대상이 아니다
  JOIN tenants t ON t.id = p.tenant_id
  LEFT JOIN per_session ps ON ps.session_id = i.id
  LEFT JOIN rows_now r ON r.policy_id = p.id
 ORDER BY i.committed_at;

ROLLBACK;
