---
paths:
  - "apps/api/src/**/*.ts"
---

# API (NestJS)

- 테넌트 데이터 쿼리는 tenantId로 건다. 다른 조직의 것은 "없음"과 같은 404로 답한다. 법령 데이터처럼 tenantId가 없는 테이블에서 출발하면 `LawLink.tenantId`·`AmendmentCandidate.tenantId`에서 건다(ADR-0020).
- 라우트 권한은 전역 가드에 맡기고 예외만 `@Public()`, 역할은 `@Roles(...)`, 플랫폼 전용은 `@PlatformRoles('global_admin')`로 적는다(개발컨벤션 2절).
- 요청 본문은 class-validator DTO로 검증한다. 전역 ValidationPipe가 DTO에 없는 필드를 거부하므로 새 필드는 DTO부터 고친다.
- 오류 응답에 스택·쿼리 같은 내부 구현을 싣지 않는다. 화면이 분기해야 하는 오류에는 `code`를 붙인다.
- 같은 행을 여러 요청이 고칠 수 있으면 트랜잭션 안에서 행 잠금이나 조건부 갱신(CAS)으로 막고, 잠금 순서는 기존 경로(규정 → 장 → 조문)와 맞춘다.
- 상태 변경과 그 감사 기록은 같은 트랜잭션(tx)에 쓴다 — 되돌려지면 기록도 없게. 잠금을 쥔 트랜잭션 안에서 tx 를 넘기지 않은 `this.audit.log`(다른 연결)로 감사를 쓰지 않는다. 감사 기록은 고치거나 지우지 않고, 승인·반려 뒤 정정은 `audit/audit-correction.ts` 로 원 기록을 가리키는 후속 기록을 쓴다(ADR-0026).
- 규정 전문을 만드는 다섯 경로(`GET :id`·`as-of`·`compare`·`compare-with`·`three-way`)는 `common/read-snapshot.ts` 의 `readSnapshot` 하나로 읽는다 — `work` 안에서는 읽기(와 조문 고르기)까지만, 전문 조립·비교표 맞대기는 돌려받은 뒤. 하위 도우미에 `db` 를 넘기고 `this.prisma` 를 직접 쓰지 않는다. 소속 확인에는 `findOne` 대신 `assertPolicyInTenant`(ADR-0027).
- 개정 후보는 확정된 법령 관계만 쓰고, 사람 승인 없이 발행하는 경로를 만들지 않는다(ADR-0021).
