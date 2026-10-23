import { ConflictException, NotFoundException } from '@nestjs/common';
import { PlanTier, Prisma, type VersionStatus } from '@prisma/client';

/**
 * 행 잠금 — 쓰기 경로들이 같은 순서·같은 세기로 줄 서게 한다(T-131). 이 파일 밖에서 `FOR UPDATE` 를 쓰지 않는다(시험이 본다).
 *
 * **순서는 회사 → 규정 → 조문(id 순) → 재파싱 검토 행 → 원문 세션.** 회사 행은 규정을 새로 만드는 쓰기만 잡는다(플랜 상한, T-135).
 * 조문을 잡은 채 규정을 기다리는 경로가 하나라도 있으면, 규정을 잡고
 * 조문을 기다리는 경로(계층 쓰기·재파싱 묶음)와 서로 기다리다 멈춘다(40P01 → 500). 규정 행을 고칠 수도 있는 경로(첫 시행이면
 * 규정 시행일을 채우는 한꺼번에 시행·시행일 보정)도 규정부터 잡는다. 판단에 쓰는 값은 잠근 뒤 다시 읽는다 — 잠그기 전에 읽은 값으로
 * 쓰면 그 사이 커밋된 쓰기를 덮는다.
 *
 * **법령 쪽은 따로 줄 선다(T-151).** 법령 등록(법령ID 열쇠 → 법령 행)·판 반영·표기 채우기는 법령 행만 잡고 규정 쪽 행은 잡지 않아,
 * 위 순서와 엮이지 않는다.
 *
 * **법령 관계 근거 문구의 원천(T-177)은 조문 → 판(id 순) → 연결.** 조문·판을 FOR KEY SHARE 로 잡아(`holdArticleVersions`) 위 쓰기들의
 * NO KEY UPDATE 와는 함께 잡히고, 조문·장·규정 삭제(조문 FOR UPDATE → 판 → 연결)·재파싱 반려(판을 지운 뒤 연결 원천 비우기)와만 줄
 * 선다 — 순서가 같아 교착하지 않는다. 재파싱 반려가 한 조문에서 지우는 판은 그 묶음 초안 하나뿐이라 판끼리 순서가 엇갈릴 일도 없다 —
 * 반영(reparse-bundle.service `apply`)이 조문마다 다음 판 번호를 한 번만 매기므로 같은 조문에 초안이 둘이면 (article_id, version_num)
 * 유일 위반으로 반영 자체가 실패하고, 초안·검토 중 판이 남은 조문은 반영을 막는다.
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
/** 긴 트랜잭션(재파싱 묶음·한꺼번에 시행·시행일 보정·조 재정렬·규정 삭제·법령 등록 — 60초) */
export const LONG_LOCK_WAIT_MS = 30_000;

export const LOCK_BUSY_MESSAGE = '다른 작업이 같은 규정을 고치는 중입니다 — 잠시 뒤 다시 시도하세요.';
export const VARIABLE_BUSY_MESSAGE = '다른 작업이 이 변수를 쓰는 중입니다 — 잠시 뒤 다시 시도하세요.';
export const TENANT_BUSY_MESSAGE = '다른 사람이 규정을 등록하는 중입니다 — 잠시 뒤 다시 시도하세요.';
export const LAW_BUSY_MESSAGE = '다른 작업이 이 법령을 저장하는 중입니다 — 잠시 뒤 다시 시도하세요.';

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

/**
 * 회사 행(맨 앞 순서) — 규정을 새로 만드는 쓰기끼리 줄 세운다. 잠근 뒤 센 규정 수로 플랜 상한을 본다(`policies/policy-slots`).
 * 계정 쪽 회사 행 잠금(users.service)과도 같은 줄이다
 */
export async function lockTenantRow(tx: Tx, tenantId: string, waitMs = LOCK_WAIT_MS): Promise<{ plan: PlanTier }> {
  const rows = await acquire(
    tx,
    'tenant',
    waitMs,
    () => tx.$queryRaw<{ plan: PlanTier }[]>`SELECT plan FROM tenants WHERE id = ${tenantId} FOR NO KEY UPDATE`,
    TENANT_BUSY_MESSAGE,
  );
  if (!rows.length) throw new NotFoundException('Tenant not found');
  return rows[0];
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

/** 근거 문구의 원천을 고를 판(T-177) — 잡은 채 읽는다 */
export interface HeldVersion {
  id: string;
  versionNum: number;
  status: VersionStatus;
  effectiveDate: Date | null;
  repealedOn: Date | null;
  content: string;
}

/**
 * 법령 관계 근거 문구의 원천 판(T-177) — 연결을 쓰기 전에 조문 행과 그 판들을 연결의 FK 확인과 같은 세기(FOR KEY SHARE)로 잡고 판들을
 * 돌려준다. 조문이 그 사이 지워졌으면 null. 순서는 조문 → 판(id 순) → (연결 쓰기)로, 조문·장·규정 삭제(조문 FOR UPDATE → 판 → 연결)와
 * 재파싱 반려(판을 지운 뒤 연결)와 같다 — 판을 먼저 잡고 연결의 FK 확인에서 조문을 기다리면 조문 삭제와 교착한다. 잡은 판들로 원천을
 * 고르므로 고른 판이 쓰기 전에 지워지지 않는다. 이 잠금 앞에는 다른 잠금을 잡지 않는다
 */
export async function holdArticleVersions(tx: Tx, articleId: string, waitMs = LOCK_WAIT_MS): Promise<HeldVersion[] | null> {
  const started = Date.now();
  return acquire(tx, 'article', waitMs, async () => {
    const article = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM articles WHERE id = ${articleId} FOR KEY SHARE`;
    if (!article.length) return null;
    // 두 문장이 기다림 한도 하나를 나눠 쓴다 — 문장마다 따로 세면 잠그는 데만 두 배를 기다린다(lockLawRowsForRegister 와 같다).
    // 한도를 조문 문장이 다 썼으면 조문 라벨, 판 문장이 넘기면 판 라벨 — 경고 로그에서 조문(삭제)에 막혔는지 판(재파싱 반려)에 막혔는지 가린다
    const left = waitMs - (Date.now() - started);
    if (left <= 0) throw new LockBusyException('article', waitMs);
    await tx.$executeRaw`SELECT set_config('lock_timeout', ${`${left}ms`}, true), set_config('statement_timeout', ${`${left}ms`}, true)`;
    let versions: HeldVersion[];
    try {
      versions = await tx.$queryRaw<HeldVersion[]>`
        SELECT id, version_num AS "versionNum", status, effective_date AS "effectiveDate", repealed_on AS "repealedOn", content
        FROM article_versions WHERE article_id = ${articleId} ORDER BY id FOR KEY SHARE`;
    } catch (e) {
      if (isLockWaitAbort(e)) throw new LockBusyException('article-versions', waitMs);
      throw e;
    }
    // 잠근 뒤의 암묵적 기다림(연결 쓰기의 행 잠금·FK 확인)은 다른 도우미처럼 한도 전체로
    await tx.$executeRaw`SELECT set_config('lock_timeout', ${`${waitMs}ms`}, true)`;
    return versions;
  });
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

/**
 * 법령 등록(T-151) — 같은 판(MST)이나 같은 법령ID 의 법령 행을 잡는다. 판 반영(법령 행의 MST 를 바꾸는 UPDATE — 키 쓰기라 더 센
 * 잠금)과 줄 서서, 동기화가 판을 옮기는 사이에 등록이 같은 법령의 둘째 행을 만들거나 옮겨 간 행을 옛 판으로 고치지 않게 한다.
 * 아직 행이 없는 법령의 첫 등록끼리는 잡을 행이 없다 — 판이 다르면 (법령원, MST) 유일에도 걸리지 않으니 법령ID 열쇠로 줄 세운다.
 * 행이 여럿이면 같은 법령의 옛 중복이다 — 부르는 쪽(등록)이 어느 행인지 짐작하지 않고 거절한다. 큰 법령의 판 반영은 수십 초 걸릴 수 있어 오래 기다린다
 */
export async function lockLawRowsForRegister(tx: Tx, sourceId: string, mst: string, lawId: string | null, waitMs = LONG_LOCK_WAIT_MS) {
  const started = Date.now();
  const rows = await acquire(
    tx,
    'law',
    waitMs,
    async () => {
      if (lawId) {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`law-register:${sourceId}:${lawId}`}))`;
        // 두 문장이 기다림 한도 하나를 나눠 쓴다 — 문장마다 따로 세면 두 배까지 기다려 트랜잭션 제한(60초)에 걸린다(409 가 아니라 500)
        const left = waitMs - (Date.now() - started);
        if (left <= 0) throw new LockBusyException('law', waitMs, LAW_BUSY_MESSAGE);
        const ms = `${left}ms`;
        await tx.$executeRaw`SELECT set_config('lock_timeout', ${ms}, true), set_config('statement_timeout', ${ms}, true)`;
      }
      const locked = await tx.$queryRaw<{ id: string; external_id: string; effective_notes_version: number | null }[]>`
        SELECT id, external_id, effective_notes_version FROM laws
        WHERE source_id = ${sourceId} AND (external_id = ${mst} OR (${lawId}::text IS NOT NULL AND external_law_id = ${lawId}::text))
        FOR NO KEY UPDATE`;
      // 잠근 뒤의 암묵적 기다림(행 쓰기·FK 확인)은 다른 도우미처럼 한도 전체로 — 줄인 값이 남으면 몇 ms 만에 뜻하지 않은 409 가 난다
      if (lawId) await tx.$executeRaw`SELECT set_config('lock_timeout', ${`${waitMs}ms`}, true)`;
      return locked;
    },
    LAW_BUSY_MESSAGE,
  );
  return rows;
}
