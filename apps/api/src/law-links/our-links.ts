import type { Prisma } from '@prisma/client';

/**
 * 우리 회사 연결만 — 연결의 회사와, 연결이 가리키는 조문의 실제 소속이 둘 다 그 회사인 것 (T-148).
 *
 * LawLink 는 tenantId 를 따로 들고 있다. 잘못 들어간 행(회사 1 이름으로 회사 2 조문을 가리킴)은 연결의 회사만
 * 보면 회사 1 것으로 잡힌다 — 부모를 안 보고 자식만 확인한 T-41 의 사고 모양이다. 그래서 연결을 찾는 조회는
 * 모두 이 조건으로 건다. 조문의 소속을 먼저 확인하고 그 조문으로 찾는 조회(조문별 목록·자동 찾기)는 이미 맞다.
 * 넘긴 조건과 AND 로 묶어, 넘긴 조건에 tenantId·article 이 있어도 이 조건을 덮어쓰지 못한다.
 * 이 조건에 걸리지 않는 연결은 그 회사에 "없는" 연결이다 — 수정·삭제도 404 로 답한다.
 */
export function ourLinks(tenantId: string, where: Prisma.LawLinkWhereInput = {}): Prisma.LawLinkWhereInput {
  return { AND: [where, { tenantId, article: { chapter: { policy: { tenantId } } } }] };
}
