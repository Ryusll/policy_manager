---
paths:
  - "apps/api/src/**/*.ts"
---

# API (NestJS)

- 테넌트 데이터 쿼리는 tenantId로 건다. 다른 조직의 것은 "없음"과 같은 404로 답한다. 법령 데이터처럼 tenantId가 없는 테이블에서 출발하면 `LawLink.tenantId`·`AmendmentCandidate.tenantId`에서 건다(ADR-0020).
- 라우트 권한은 전역 가드에 맡기고 예외만 `@Public()`, 역할은 `@Roles(...)`, 플랫폼 전용은 `@PlatformRoles('global_admin')`로 적는다(개발컨벤션 2절).
- 요청 본문은 class-validator DTO로 검증한다. 전역 ValidationPipe가 DTO에 없는 필드를 거부하므로 새 필드는 DTO부터 고친다.
- 오류 응답에 스택·쿼리 같은 내부 구현을 싣지 않는다. 화면이 분기해야 하는 오류에는 `code`를 붙인다.
- 같은 행을 여러 요청이 고칠 수 있으면 트랜잭션 안에서 행 잠금이나 조건부 갱신(CAS)으로 막고, 잠금 순서는 기존 경로(규정 → 장 → 조문)와 맞춘다. 감사 로그는 잠금을 잡은 트랜잭션 밖에서 남긴다.
- 개정 후보는 확정된 법령 관계만 쓰고, 사람 승인 없이 발행하는 경로를 만들지 않는다(ADR-0021).
