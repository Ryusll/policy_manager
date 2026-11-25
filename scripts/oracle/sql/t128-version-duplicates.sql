-- T-128 배포 전 점검(읽기 전용): 같은 조문에 같은 버전 번호가 겹친 곳
--
-- 실행: ORACLE_SSH=ubuntu@<서버주소> bash scripts/oracle/run-readonly-sql.sh scripts/oracle/sql/t128-version-duplicates.sql
-- 0건이면 마이그레이션 20261010020000_article_version_unique 는 유니크만 건다.
-- 있으면 그 조문들의 버전 번호를 지금 순서(번호 → 만든 시각 → id)대로 1부터 다시 매긴 뒤 건다.
-- 본문은 내보내지 않는다 — 회사·규정 코드·조 번호와 건수만.
BEGIN TRANSACTION READ ONLY;

SELECT t.slug                AS 회사,
       p.code                AS 규정코드,
       a.number              AS 조,
       a.clause_number       AS 항,
       a.item_number         AS 호,
       v.version_num         AS 겹친_버전번호,
       COUNT(*)              AS 건수
FROM article_versions v
JOIN articles a ON a.id = v.article_id
JOIN chapters c ON c.id = a.chapter_id
JOIN policies p ON p.id = c.policy_id
JOIN tenants t ON t.id = p.tenant_id
GROUP BY t.slug, p.code, a.id, a.number, a.clause_number, a.item_number, v.version_num
HAVING COUNT(*) > 1
ORDER BY t.slug, p.code, a.number, v.version_num;

ROLLBACK;
