-- T-128 (조문, 버전 번호) 유니크 — 같은 조문에 같은 버전 번호가 둘 생기지 않게 DB 로 막는다.
--
-- 지금까지는 버전을 만드는 경로가 조문 잠금 아래에서 "가장 큰 번호 + 1"로 막을 뿐이었다.
-- 이미 번호가 겹친 조문이 있으면 유니크를 걸 수 없으므로, **겹친 조문만** 버전 번호를 지금 순서
-- (번호 → 만든 시각 → id)대로 1부터 다시 매긴다. 겹친 것이 없으면 아무 행도 바뀌지 않는다.
-- 미리 볼 때는 scripts/oracle/sql/t128-version-duplicates.sql(읽기 전용).
WITH dup AS (
  SELECT DISTINCT article_id
  FROM article_versions
  GROUP BY article_id, version_num
  HAVING COUNT(*) > 1
),
renum AS (
  SELECT v.id,
         ROW_NUMBER() OVER (PARTITION BY v.article_id ORDER BY v.version_num, v.created_at, v.id) AS rn
  FROM article_versions v
  WHERE v.article_id IN (SELECT article_id FROM dup)
)
UPDATE article_versions v
SET version_num = r.rn
FROM renum r
WHERE v.id = r.id AND v.version_num <> r.rn;

CREATE UNIQUE INDEX "article_versions_article_id_version_num_key" ON "article_versions"("article_id", "version_num");
