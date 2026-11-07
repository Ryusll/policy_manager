import type { Prisma } from '@prisma/client';
import { bundleNotice, failureNotice, type CandidateOrigin } from './amendment-catchup-rules';

/**
 * 개정 후보 알림을 받는 사람 — 회사의 검토 권한자(관리자·편집자). 받는 사람 규칙은 이 함수 하나에 둔다:
 * 변경마다 보내는 알림(동기화 끝 자동 생성)과 회사마다 묶는 알림(T-149)이 함께 쓰고, 규정 팀·개인 거르기(T-159)는 여기를 고친다
 */
export async function amendmentRecipients(db: Pick<Prisma.TransactionClient, 'user'>, tenantId: string): Promise<string[]> {
  const users = await db.user.findMany({ where: { tenantId, role: { in: ['admin', 'editor'] } }, select: { id: true } });
  return users.map((u) => u.id);
}

/**
 * 여러 변경으로 만든 후보를 회사마다 알림 하나로(T-149) — 연결 확정 한 번이나 일괄 처리 한 번에 만든 것을 묶어 개정 후보 목록으로 보낸다.
 * 후보는 이미 저장됐으므로(변경마다 따로 커밋) 알림이 실패하면 호출부가 실패로 알린다 — 후보는 목록에서 그대로 보인다
 */
export async function notifyBundle(
  db: Pick<Prisma.TransactionClient, 'user' | 'userNotification'>,
  tenantId: string,
  n: { events: number; articles: number; created: number; origin: CandidateOrigin },
): Promise<number> {
  if (!n.created) return 0;
  const users = await amendmentRecipients(db, tenantId);
  if (!users.length) return 0;
  const notice = bundleNotice(n);
  const { count } = await db.userNotification.createMany({
    data: users.map((userId) => ({ tenantId, userId, kind: 'law_amendment', ...notice })),
  });
  return count;
}

/** 연결 확정 뒤 후보를 못 만들었다고 알린다(T-149) — 받는 사람은 같은 규칙. 실패한 변경의 법령이 하나면 그 법령 화면으로, 여럿이면 목록으로 */
export async function notifyFailure(
  db: Pick<Prisma.TransactionClient, 'user' | 'userNotification' | 'law'>,
  tenantId: string,
  n: { failed: number; lawIds: string[] },
): Promise<number> {
  const users = await amendmentRecipients(db, tenantId);
  if (!users.length) return 0;
  const laws = n.lawIds.length ? await db.law.findMany({ where: { id: { in: n.lawIds } }, select: { lawName: true }, orderBy: { lawName: 'asc' } }) : [];
  const notice = failureNotice({ failed: n.failed, lawId: n.lawIds.length === 1 ? n.lawIds[0] : null, lawNames: laws.map((l) => l.lawName) });
  const { count } = await db.userNotification.createMany({ data: users.map((userId) => ({ tenantId, userId, kind: 'law_amendment', ...notice })) });
  return count;
}
