-- 배포 후 확인: T-109 변수 마이그레이션 결과 (읽기 전용)
--
-- t109-variables-before.sql 의 숫자와 맞춰 본다:
-- 옮길_기본값 = 옮긴_기본값, 표식_있는_기록 ≤ 이은_자리 + 위치확인필요(한 버전에 표식이 여러 번이면 자리마다
-- 하나, 이모지 같은 문자 뒤의 표식은 위치확인필요로 들어간다), 표식_없는_기록 = 다시이어야함(legacy_unmatched).
-- 회사_어긋나_버려질_기록은 옮기지 않으므로 여기서 보이지 않는다(배포 직전 백업에는 남아 있다).
BEGIN TRANSACTION READ ONLY;

SELECT t.slug AS 회사,
       (SELECT count(*) FROM variable_values vv
         WHERE vv.tenant_id = t.id AND vv.period_confirmed = false
           AND vv.note LIKE '옛 기본값을 옮긴 값%')                                   AS 옮긴_기본값_기간미확정,
       count(vb.*) FILTER (WHERE vb.origin = 'legacy' AND vb.state = 'active')       AS 이은_자리,
       count(vb.*) FILTER (WHERE vb.review_reason = 'position_unverified')           AS 위치확인필요,
       count(vb.*) FILTER (WHERE vb.review_reason = 'legacy_unmatched')              AS 다시이어야함
  FROM tenants t
  LEFT JOIN variable_bindings vb ON vb.tenant_id = t.id AND vb.origin = 'legacy'
 GROUP BY t.slug, t.id
 ORDER BY t.slug;

SELECT t.slug AS 회사, av.status AS 상태, count(*) AS 표식_남은_버전
  FROM article_versions av
  JOIN articles ar ON ar.id = av.article_id
  JOIN chapters c ON c.id = ar.chapter_id
  JOIN policies p ON p.id = c.policy_id
  JOIN tenants t ON t.id = p.tenant_id
 WHERE av.status IN ('draft', 'review') AND av.content ~ '\{\{[^{}]+\}\}'
 GROUP BY t.slug, av.status
 ORDER BY t.slug, av.status;

ROLLBACK;
