/**
 * 조항 수백 건을 한 트랜잭션에서 upsert 한다(근로기준법 478건). Prisma 기본 5초는 작은
 * 서버(Oracle A1)에서 넘칠 수 있고, 넘치면 등록·동기화가 통째로 롤백된다.
 */
export const TX_OPTIONS = { maxWait: 10_000, timeout: 60_000 };
