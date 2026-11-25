-- 배포 후 확인: 시행 전 초안만 있는 조문 (읽기 전용, 본문은 내보내지 않는다)
--
-- 손으로 넣은 조·항은 초안으로만 저장되고, 10/7 배포 전에는 화면에 보이지 않았다(C-46).
-- 내용이 그대로 남아 있는지(내용 있는 초안 수)와, "한꺼번에 시행하기"로 시행될 조문 수를 본다.
BEGIN TRANSACTION READ ONLY;

SELECT t.slug                                                       AS 회사,
       p.code                                                       AS 규정코드,
       p.title                                                      AS 규정명,
       count(*) FILTER (WHERE pub.id IS NULL AND d.id IS NOT NULL)  AS 시행전_초안만_있는_조문,
       count(*) FILTER (WHERE pub.id IS NULL AND d.id IS NOT NULL AND d.has_text) AS 그중_내용있는_초안,
       count(*) FILTER (WHERE pub.id IS NOT NULL)                   AS 시행중_조문,
       count(*)                                                     AS 전체_조문행
  FROM policies p
  JOIN tenants t ON t.id = p.tenant_id
  JOIN chapters c ON c.policy_id = p.id
  JOIN articles a ON a.chapter_id = c.id
  LEFT JOIN LATERAL (
    SELECT v.id FROM article_versions v
     WHERE v.article_id = a.id AND v.status = 'published'
     LIMIT 1
  ) pub ON true
  LEFT JOIN LATERAL (
    SELECT v.id, length(btrim(v.content)) > 0 AS has_text
      FROM article_versions v
     WHERE v.article_id = a.id AND v.status IN ('draft', 'review')
     ORDER BY v.version_num DESC
     LIMIT 1
  ) d ON true
 GROUP BY t.slug, p.code, p.title
HAVING count(*) FILTER (WHERE pub.id IS NULL AND d.id IS NOT NULL) > 0
 ORDER BY 1, 2;

ROLLBACK;
