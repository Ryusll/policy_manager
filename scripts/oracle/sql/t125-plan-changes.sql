-- 배포 후 확인: 고객사가 결제 없이 요금제를 바꾼 적이 있는지 (읽기 전용, T-125)
--
-- 10/9 배포 전 운영은 결제 설정이 비어 mock 으로 돌았다 — 고객사 관리자가 요금제 창 버튼으로
-- Pro·Enterprise 를 결제 없이 올릴 수 있었다. 그 경로로 바뀐 요금제는 감사 로그
-- `tenant.plan_changed`(source=mock_checkout_auto)와 0원 결제 기록(metadata.mock=true)을 남긴다.
-- 플랫폼 관리자가 통합 관리에서 바꾼 것은 `platform_admin.tenant_plan.update` 로 따로 보인다.
BEGIN TRANSACTION READ ONLY;

-- 1) 요금제 변경 기록 — 누가, 어느 경로로
SELECT t.slug                         AS 회사,
       a.created_at                   AS 시각,
       CASE a.action
         WHEN 'tenant.plan_changed' THEN '고객사 결제 경로'
         ELSE '플랫폼 관리자'
       END                            AS 경로,
       coalesce(a.details->>'targetPlan', a.details->'after'->>'plan') AS 바뀐_요금제,
       a.details->>'source'           AS 출처,
       u.email                        AS 실행자
  FROM audit_logs a
  JOIN tenants t ON t.id = a.tenant_id
  LEFT JOIN users u ON u.id = a.user_id
 WHERE a.action IN ('tenant.plan_changed', 'platform_admin.tenant_plan.update')
 ORDER BY a.created_at;

-- 2) 결제 기록 — mock 이면 0원, 실제로 돈이 오가지 않았다
SELECT t.slug                    AS 회사,
       p.created_at              AS 시각,
       p.provider                AS 결제사,
       p.amount                  AS 금액,
       p.metadata->>'targetPlan' AS 요금제,
       p.metadata->>'mock'       AS mock
  FROM billing_payments p
  JOIN tenants t ON t.id = p.tenant_id
 ORDER BY p.created_at;

-- 3) 지금 요금제
SELECT slug AS 회사, plan AS 요금제, billing_status AS 청구상태, plan_expires_at AS 만료
  FROM tenants
 ORDER BY slug;

ROLLBACK;
