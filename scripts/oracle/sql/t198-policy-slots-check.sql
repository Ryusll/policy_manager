-- T-198 운영 점검: 회사별 요금제와 규정 수 — 규정 상한에 걸려 새 규정을 등록할 수 없는 회사가 있는가 (읽기 전용)
--
-- 출력은 회사(슬러그·이름)·요금제·규정 수·상한·최근 등록 시각과 건수뿐이다. 규정 본문은 내보내지 않는다.
-- 실행: scripts/oracle/run-readonly-sql.sh 로 돌린다(접속 자체를 읽기 전용으로 연다).
--
-- 배경(작업관리대장 T-198): 대표가 "규정 등록이 아예 안 된다"고 했다. Starter 는 규정이 5건까지이고(SRS TENANT-2),
-- 5건이 차면 새 규정·텍스트 가져오기·PDF/법제처 확정이 모두 403 이다. 운영 회사는 Starter 였다(C-42).
-- 세는 방식은 서버(policies/policy-slots.ts)와 같다 — 회사의 모든 규정(비활성 포함).
-- 상한 숫자는 apps/api/src/common/plan-limits.ts 의 maxPoliciesForPlan 과 같아야 한다(SQL 은 그 함수를 읽지 못한다).
BEGIN TRANSACTION READ ONLY;

-- 1) 회사별 자리 — 남은 자리가 0 이하면 새 규정을 만들 수 없다
SELECT t.slug                                        AS 회사,
       t.name                                        AS 회사명,
       t.plan                                        AS 요금제,
       count(p.id)                                   AS 규정_수,
       count(p.id) FILTER (WHERE NOT p.is_active)    AS 그중_비활성,
       CASE t.plan WHEN 'starter' THEN 5 WHEN 'pro' THEN 10000 ELSE 1000000 END AS 상한,
       CASE t.plan WHEN 'starter' THEN 5 WHEN 'pro' THEN 10000 ELSE 1000000 END - count(p.id) AS 남은_자리,
       max(p.created_at)                             AS 마지막_규정_등록
  FROM tenants t
  LEFT JOIN policies p ON p.tenant_id = t.id
 GROUP BY t.id, t.slug, t.name, t.plan
 ORDER BY 남은_자리, t.slug;

-- 2) 최근 30일 PDF·법제처 미리보기 중 확정되지 않은 것 — 상한에 막힌 확정은 세션이 ready 로 남는다
--    (상한 외 이유로 그만둔 것도 섞인다. 상한이 찬 회사와 겹치는지 1) 과 함께 본다)
SELECT t.slug                                         AS 회사,
       count(*) FILTER (WHERE s.status = 'ready')     AS 확정_안_된_미리보기,
       count(*) FILTER (WHERE s.status = 'committed') AS 확정된_미리보기,
       count(*) FILTER (WHERE s.status = 'failed')    AS 추출_실패,
       max(s.created_at)                              AS 마지막_올린_시각
  FROM regulation_parse_sessions s
  JOIN tenants t ON t.id = s.tenant_id
 WHERE s.created_at > now() - interval '30 days'
 GROUP BY t.slug
 ORDER BY 확정_안_된_미리보기 DESC, t.slug;

ROLLBACK;
