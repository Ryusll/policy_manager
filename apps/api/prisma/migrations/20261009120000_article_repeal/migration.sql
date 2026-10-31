-- T-126 폐지 시행일 — "게시본 폐지"와 "새 버전에 밀려 내려감(대체)"을 가른다
ALTER TABLE "article_versions" ADD COLUMN "repealed_on" DATE;

-- 기존 폐지 보정: 지금도 내려가 있는(archived) 버전 중 "게시본 폐지" 감사 기록(version.archive)이 있는 것에
-- 그 기록 시각의 한국 날짜를 넣는다(감사 시각은 UTC 로 저장돼 있다 — 한국은 UTC+9, 서머타임 없음).
-- 감사가 없는 archived 는 비워 둔다(시점 조회는 예전처럼 본다). 폐지 기능은 처음부터 이 감사를 남겼으므로 대개는
-- 새 버전에 밀려 내려간 것이지만, 그렇다고 단정해 다른 값을 넣지는 않는다.
-- 감사의 회사와 버전의 실제 소속(조문 → 장 → 규정)이 같은 것만 쓴다. 같은 버전에 둘 이상이면 이른 쪽.
UPDATE "article_versions" AS v
SET "repealed_on" = r."day"
FROM (
  SELECT a."entity_id" AS "version_id", (MIN(a."created_at") + INTERVAL '9 hours')::date AS "day"
  FROM "audit_logs" a
  JOIN "article_versions" av ON av."id" = a."entity_id"
  JOIN "articles" ar ON ar."id" = av."article_id"
  JOIN "chapters" c ON c."id" = ar."chapter_id"
  JOIN "policies" p ON p."id" = c."policy_id"
  WHERE a."action" = 'version.archive'
    AND a."entity_type" = 'ArticleVersion'
    AND a."tenant_id" = p."tenant_id"
  GROUP BY a."entity_id"
) AS r
WHERE v."id" = r."version_id"
  AND v."status" = 'archived';
