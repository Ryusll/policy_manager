-- 배포 전 확인: T-109 변수 마이그레이션이 옮기고 버릴 것 (읽기 전용)
--
-- 마이그레이션 20261009150000_variable_values_bindings 는 옛 기본값(variables.default_value)과
-- 사용 기록(variable_usages)을 새 구조로 옮긴 뒤 **옛 열과 표를 지운다.** 배포 직전 백업이 있으니
-- 되살릴 수는 있지만, 무엇이 옮겨지고 무엇이 버려지는지 미리 숫자로 본다.
-- 배포 뒤에는 t109-variables-after.sql 로 같은 숫자가 맞는지 본다.
BEGIN TRANSACTION READ ONLY;

-- 1) 회사별: 옮겨질 기본값 / 사용 기록(전체·본문에 표식 있음·표식 없음·회사가 어긋나 버려질 것)
SELECT t.slug AS 회사,
       (SELECT count(*) FROM variables v
         WHERE v.tenant_id = t.id AND v.default_value IS NOT NULL AND btrim(v.default_value) <> '') AS 옮길_기본값,
       count(vu.*)                                                                    AS 사용기록,
       count(vu.*) FILTER (WHERE p.tenant_id = var.tenant_id
                            AND strpos(av.content, '{{' || var.key || '}}') > 0)      AS 표식_있는_기록,
       count(vu.*) FILTER (WHERE p.tenant_id = var.tenant_id
                            AND strpos(av.content, '{{' || var.key || '}}') = 0)      AS 표식_없는_기록_다시이어야함,
       count(vu.*) FILTER (WHERE p.tenant_id <> var.tenant_id)                        AS 회사_어긋나_버려질_기록
  FROM tenants t
  LEFT JOIN variables var ON var.tenant_id = t.id
  LEFT JOIN variable_usages vu ON vu.variable_id = var.id
  LEFT JOIN article_versions av ON av.id = vu.version_id
  LEFT JOIN articles ar ON ar.id = av.article_id
  LEFT JOIN chapters c ON c.id = ar.chapter_id
  LEFT JOIN policies p ON p.id = c.policy_id
 GROUP BY t.slug, t.id
 ORDER BY t.slug;

-- 2) 본문에 {{표식}} 이 남은 버전. 초안·검토 중은 배포 뒤 승인·한꺼번에 시행이 막힌다
--    (검토 중이면 반려 후 다시 검토 요청). 시행·폐지본은 마이그레이션이 본문을 바꾸지 않아 전처럼 보인다(참고)
SELECT t.slug AS 회사, av.status AS 상태, count(*) AS 표식_남은_버전,
       CASE WHEN av.status IN ('draft', 'review') THEN '배포 뒤 승인 막힘' ELSE '참고(본문 그대로)' END AS 영향
  FROM article_versions av
  JOIN articles ar ON ar.id = av.article_id
  JOIN chapters c ON c.id = ar.chapter_id
  JOIN policies p ON p.id = c.policy_id
  JOIN tenants t ON t.id = p.tenant_id
 WHERE av.content ~ '\{\{[^{}]+\}\}'
 GROUP BY t.slug, av.status
 ORDER BY t.slug, av.status;

ROLLBACK;
