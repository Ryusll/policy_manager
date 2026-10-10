import { ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

/**
 * 행 잠금 — 쓰기 경로들이 같은 순서·같은 세기로 줄 서게 한다(T-131). 이 파일 밖에서 `FOR UPDATE` 를 쓰지 않는다(시험이 본다).
 *
 * **순서는 규정 → 조문(id 순) → 재파싱 검토 행 → 원문 세션.** 조문을 잡은 채 규정을 기다리는 경로가 하나라도 있으면, 규정을 잡고
 * 조문을 기다리는 경로(계층 쓰기·재파싱 묶음)와 서로 기다리다 멈춘다(40P01 → 500). 규정 행을 고칠 수도 있는 경로(첫 시행이면
 * 규정 시행일을 채우는 한꺼번에 시행·시행일 보정)도 규정부터 잡는다. 판단에 쓰는 값은 잠근 뒤 다시 읽는다 — 잠그기 전에 읽은 값으로
 * 쓰면 그 사이 커밋된 쓰기를 덮는다.
 *
 * **세기는 FOR NO KEY UPDATE.** 쓰는 쪽끼리는 FOR UPDATE 와 똑같이 줄 서지만, 그 행을 가리키는 FK insert(의견·즐겨찾기·
 * 개정 후보·검토 항목 — FK 검사는 FOR KEY SHARE)는 막지 않는다. 키를 바꾸는 쓰기는 없다. 지우기만 `FOR UPDATE` 를 미리 id 순으로
 * 잡는다(`lockArticlesForDelete`) — 지우기는 어차피 그 잠금을 잡는데, 스캔 순서로 잡으면 여러 조문을 id 순으로 가리키는 insert 와
 * 서로 기다리다 멈출 수 있다. 규정을 지울 때는 규정 행도 처음부터 `FOR UPDATE`(`lockPolicyForDelete`).
 *
 * **기다리는 시간은 트랜잭션 제한보다 짧게.** 잠금 문장은 정해진 시간 안에 못 잡으면 409(잠시 뒤 다시)로 끝낸다 — 기본 제한(5초)의
 * 트랜잭션이 60초짜리 묶음 승인 뒤에 서서 제한에 걸려 500 이 되지 않게. `lock_timeout` 만으로는 모자란다: 행 잠금은 앞에서 기다리는
 * 트랜잭션 뒤에 한 번, 잠근 트랜잭션에 또 한 번 기다리는데 `lock_timeout` 은 그 기다림마다 따로 센다(여럿이 몰리면 두 배 넘게
 * 기다린다 — 시험에서 확인). 그래서 잠금 문장에는 `statement_timeout` 도 같은 값으로 걸고, 잡은 뒤에는 원래 값으로 돌린다.
 * `lock_timeout` 은 트랜잭션 끝까지 남겨 그 뒤의 암묵적 대기(행 UPDATE·FK 확인)도 대략 그 안에서 끝나게 한다 — 그 오류는 전역
 * 필터(`LockBusyFilter`)가 같은 409 로 바꾼다.
 */

type Tx = Prisma.TransactionClient;

/** 기본 제한(5초) 트랜잭션 — 나머지 일을 할 시간을 남긴다 */
export const LOCK_WAIT_MS = 3_000;
/** 긴 트랜잭션(재파싱 묶음·한꺼번에 시행·시행일 보정·조 재정렬·규정 삭제 — 60초) */
export const LONG_LOCK_WAIT_MS = 30_000;

export const LOCK_BUSY_MESSAGE = '다른 작업이 같은 규정을 고치는 중입니다 — 잠시 뒤 다시 시도하세요.';
export const VARIABLE_BUSY_MESSAGE = '다른 작업이 이 변수를 쓰는 중입니다 — 잠시 뒤 다시 시도하세요.';

/**
 * 잠금을 정해진 시간 안에 못 잡았다 — 409(잠시 뒤 다시). 어느 잠금을 얼마나 기다렸는지 들고 있어 전역 필터가 경고로 남긴다
 * (배포 뒤 잠금 다툼을 볼 수 있게)
 */
export class LockBusyException extends ConflictException {
  constructor(
    readonly lock: string,
    readonly waitMs: number,
    message = LOCK_BUSY_MESSAGE,
  ) {
    super(message);
  }
}

const rawCode = (e: unknown) =>
  e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2010' ? (e.meta as { code?: string } | undefined)?.code : undefined;

/**
 * 잠금 문장이 기다리다 끝난 오류 — lock_timeout(55P03) 또는 statement_timeout(57014). 두 시계를 같은 값으로 걸어 대개 문장 시계가
 * 먼저 끝난다. 잠금 문장에만 statement_timeout 을 걸므로 57014 는 잠금 기다림이다
 */
export function isLockWaitAbort(e: unknown): boolean {
  const code = rawCode(e);
  return code === '55P03' || code === '57014';
}

async function acquire<T>(tx: Tx, label: string, waitMs: number, lock: () => Promise<T>, busyMessage = LOCK_BUSY_MESSAGE): Promise<T> {
  const ms = `${waitMs}ms`;
  const [{ prev }] = await tx.$queryRaw<{ prev: string }[]>`
    SELECT current_setting('statement_timeout') AS prev, set_config('lock_timeout', ${ms}, true) AS lt, set_config('statement_timeout', ${ms}, true) AS st`;
  let result: T;
  try {
    result = await lock();
  } catch (e) {
    if (isLockWaitAbort(e)) throw new LockBusyException(label, waitMs, busyMessage);
    throw e;
  }
  await tx.$executeRaw`SELECT set_config('statement_timeout', ${prev}, true)`;
  return result;
}

/** 규정 행 — 기다리는 사이 지워졌으면 404 */
export async function lockPolicyRow(tx: Tx, policyId: string, waitMs = LOCK_WAIT_MS) {
  const rows = await acquire(tx, 'policy', waitMs, () => tx.$queryRaw<{ id: string }[]>`SELECT id FROM policies WHERE id = ${policyId} FOR NO KEY UPDATE`);
  if (!rows.length) throw new NotFoundException('Policy not found');
}

/**
 * 규정을 지울 때의 규정 행 — 처음부터 FOR UPDATE. 약한 잠금으로 잡았다가 지우며 올리면, 규정을 FK 로 가리키며 먼저 FOR KEY SHARE 를
 * 잡은 insert(조문 즐겨찾기 — 규정 다음 조문을 확인한다)가 지울 조문을 기다리는 사이 서로 기다리다 멈춘다
 */
export async function lockPolicyForDelete(tx: Tx, policyId: string, waitMs = LOCK_WAIT_MS) {
  const rows = await acquire(tx, 'policy', waitMs, () => tx.$queryRaw<{ id: string }[]>`SELECT id FROM policies WHERE id = ${policyId} FOR UPDATE`);
  if (!rows.length) throw new NotFoundException('Policy not found');
}

/** 조문 행 하나 — 기다리는 사이 지워졌으면 404 */
export async function lockArticleRow(tx: Tx, articleId: string, waitMs = LOCK_WAIT_MS) {
  const rows = await acquire(tx, 'article', waitMs, () => tx.$queryRaw<{ id: string }[]>`SELECT id FROM articles WHERE id = ${articleId} FOR NO KEY UPDATE`);
  if (!rows.length) throw new NotFoundException('Article not found');
}

/** 조문 여럿 — 늘 id 순으로. 기다리는 사이 하나라도 지워졌으면 409 */
export async function lockArticleRows(tx: Tx, articleIds: string[], waitMs = LOCK_WAIT_MS) {
  if (!articleIds.length) return;
  const ids = [...new Set(articleIds)].sort();
  const rows = await acquire(
    tx,
    'articles',
    waitMs,
    () => tx.$queryRaw<{ id: string }[]>`SELECT id FROM articles WHERE id IN (${Prisma.join(ids)}) ORDER BY id FOR NO KEY UPDATE`,
  );
  if (rows.length !== ids.length) throw new ConflictException('그 사이 조문이 바뀌었습니다 — 화면을 새로 고친 뒤 다시 시도하세요.');
}

/** 규정 → 그 규정의 모든 조문(id 순) — 재파싱 묶음·시행일 보정처럼 규정 전체를 다시 계산하는 쓰기 */
export async function lockPolicyWithArticles(tx: Tx, policyId: string, waitMs = LOCK_WAIT_MS) {
  await lockPolicyRow(tx, policyId, waitMs);
  await acquire(
    tx,
    'policy-articles',
    waitMs,
    () =>
      tx.$queryRaw`SELECT a.id FROM articles a JOIN chapters c ON c.id = a.chapter_id WHERE c.policy_id = ${policyId} ORDER BY a.id FOR NO KEY UPDATE OF a`,
  );
}

/** 지울 조문(규정 전체·장 하나·조문 하나)을 id 순으로 미리 — 규정 잠금 다음에 */
export async function lockArticlesForDelete(
  tx: Tx,
  scope: { policyId: string } | { chapterId: string } | { articleId: string },
  waitMs = LOCK_WAIT_MS,
) {
  await acquire(tx, 'delete-articles', waitMs, () => {
    if ('policyId' in scope) {
      return tx.$queryRaw`SELECT a.id FROM articles a JOIN chapters c ON c.id = a.chapter_id WHERE c.policy_id = ${scope.policyId} ORDER BY a.id FOR UPDATE OF a`;
    }
    if ('chapterId' in scope) return tx.$queryRaw`SELECT id FROM articles WHERE chapter_id = ${scope.chapterId} ORDER BY id FOR UPDATE`;
    return tx.$queryRaw`SELECT id FROM articles WHERE id = ${scope.articleId} FOR UPDATE`;
  });
}

/** 재파싱 검토 행 — 규정(·조문) 다음에. 없으면(다른 회사·없는 검토) false */
export async function lockReparseReviewRow(tx: Tx, reviewId: string, tenantId: string, waitMs = LOCK_WAIT_MS): Promise<boolean> {
  const rows = await acquire(
    tx,
    'review',
    waitMs,
    () => tx.$queryRaw<{ id: string }[]>`SELECT id FROM reparse_reviews WHERE id = ${reviewId} AND tenant_id = ${tenantId} FOR NO KEY UPDATE`,
  );
  return rows.length > 0;
}

/** 같은 원문·규정의 열린 재파싱 검토들(id 순) — 다시 비교가 앞 검토를 지나감으로 돌리기 전에 */
export async function lockOpenReparseReviews(tx: Tx, tenantId: string, policyId: string, sessionId: string, waitMs = LOCK_WAIT_MS) {
  await acquire(
    tx,
    'open-reviews',
    waitMs,
    () =>
      tx.$queryRaw`SELECT id FROM reparse_reviews WHERE tenant_id = ${tenantId} AND policy_id = ${policyId} AND session_id = ${sessionId} AND status = 'open' ORDER BY id FOR NO KEY UPDATE`,
  );
}

/** 원문 세션(맨 끝 순서) — 반영이 원문을 쓰는 동안 원문 미리보기 고치기·다시 비교가 끼어들지 않게 */
export async function lockParseSessionRow(tx: Tx, sessionId: string, waitMs = LOCK_WAIT_MS) {
  await acquire(tx, 'session', waitMs, () => tx.$queryRaw`SELECT id FROM regulation_parse_sessions WHERE id = ${sessionId} FOR NO KEY UPDATE`);
}

/** 원문 세션 공유 잠금 — 다시 비교가 읽는 동안 반영이 원문을 쓰지 못하게(맨 끝 순서) */
export async function shareParseSessionRow(tx: Tx, sessionId: string, waitMs = LOCK_WAIT_MS) {
  await acquire(tx, 'session-share', waitMs, () => tx.$queryRaw`SELECT id FROM regulation_parse_sessions WHERE id = ${sessionId} FOR SHARE`);
}

/** 변수 행 — 값 고치기끼리, 그리고 승인 때 값 재확인(FOR SHARE)과 줄 선다. 연결 insert(FK)는 막지 않는다 */
export async function lockVariableRow(tx: Tx, variableId: string, waitMs = LOCK_WAIT_MS) {
  await acquire(tx, 'variable', waitMs, () => tx.$queryRaw`SELECT id FROM variables WHERE id = ${variableId} FOR NO KEY UPDATE`, VARIABLE_BUSY_MESSAGE);
}
