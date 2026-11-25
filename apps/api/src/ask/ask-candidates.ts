import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { PrismaService } from '../common/prisma/prisma.service';
import { todayDateOnly } from '../common/date-only';
import { currentVersionsSql } from '../common/as-of';
import { AskRow, joKey } from './ask-text';

/** 질문 범위로 고를 수 있는 규정 수 상한(T-219) — 이보다 넓으면 범위 없이(회사 전체) 묻는다 */
export const ASK_SCOPE_MAX = 100;

/** 물을 때 고른 규정 — 그때의 이름·코드를 기록에 함께 남겨 지난 질문에 그대로 보인다(T-219) */
export interface AskScopePolicy {
  id: string;
  title: string;
  code: string;
}

/** 범위 확인은 예약 트랜잭션 안에서도 부른다 — 규정만 읽는다 */
type ScopeDb = Pick<Prisma.TransactionClient, 'policy'>;

/**
 * 질문 범위(T-219, SRS SEARCH-11) — 묻는 사람이 살펴볼 규정을 고른다. 그 회사의 **활성 규정**만 받고, 없는 규정·다른 회사 규정·
 * 비활성 규정이 섞이면 구분 없이 같은 400 으로 거절한다(무엇이 있는지 알려 주지 않는다). 예약 트랜잭션 안에서 켜짐·고지 확인
 * 뒤, 한도 확인 앞에 본다 — 거절된 질문은 기록 행도 남기지 않고 한도에도 세지 않는다. 비었으면 null(회사의 시행 중 규정 전체).
 * 고른 차례대로 그때의 이름·코드를 돌려준다. 확인한 뒤 답을 쓰기 전에 비활성이 된 규정은 조문 찾기에서 빠진다(범위는 좁아지기만 한다).
 * 누가 어느 규정을 볼 수 있는지(규정별 열람 범위, 대장 D-21)를 정하는 것이 아니다.
 */
export async function checkedScope(db: ScopeDb, tenantId: string, policyIds: string[] | undefined): Promise<AskScopePolicy[] | null> {
  if (!policyIds?.length) return null;
  const ids = [...new Set(policyIds)];
  const found = await db.policy.findMany({
    where: { id: { in: ids }, tenantId, isActive: true },
    select: { id: true, title: true, code: true },
  });
  if (found.length !== ids.length) {
    throw new BadRequestException({
      statusCode: 400,
      code: 'AI_QA_SCOPE_INVALID',
      message: '고른 규정 가운데 지금 고를 수 없는 규정이 있습니다. 규정 범위를 다시 골라 주세요.',
    });
  }
  const byId = new Map(found.map((p) => [p.id, p]));
  return ids.map((id) => byId.get(id)).filter((p): p is AskScopePolicy => !!p);
}

/**
 * 지금 시행 중인 조문 행 전부(본문 없이) — 목차와 낱말 찾기의 기준. "현재" 판정은 규정 상세·검색과
 * 같은 규칙(`currentVersionsSql`, T-127)이다. 조 머리는 버전이 없어도(제목만 있는 조) 같은 조에 시행 중인
 * 행이 있으면 넣는다. 범위가 있으면 그 규정의 조문만이다(T-219).
 */
export async function inForceRows(db: PrismaService, tenantId: string, scope: string[] | null) {
  const today = todayDateOnly();
  const picked = await db.$queryRaw<{ article_id: string; version_id: string; repealed_on: Date | null }[]>(
    currentVersionsSql(tenantId, today, { activePoliciesOnly: true }),
  );
  const versionOf = new Map<string, string>();
  for (const r of picked) {
    if (r.repealed_on && r.repealed_on.getTime() <= today.getTime()) continue; // 그날 폐지 상태
    versionOf.set(r.article_id, r.version_id);
  }

  const articles = await db.article.findMany({
    where: { chapter: { policy: { tenantId, isActive: true, ...(scope ? { id: { in: scope } } : {}) } } },
    select: {
      id: true,
      number: true,
      branchNumber: true,
      clauseNumber: true,
      itemNumber: true,
      title: true,
      chapter: { select: { policy: { select: { id: true, title: true, code: true } } } },
    },
  });
  const rows: (AskRow & { versionId: string | null })[] = articles.map((a) => ({
    articleId: a.id,
    policyId: a.chapter.policy.id,
    policyTitle: a.chapter.policy.title,
    policyCode: a.chapter.policy.code,
    number: a.number,
    branchNumber: a.branchNumber,
    clauseNumber: a.clauseNumber,
    itemNumber: a.itemNumber,
    title: a.title,
    content: '',
    versionId: versionOf.get(a.id) ?? null,
  }));
  // 시행 중인 행이 하나라도 있는 조만 남기고, 그 조의 머리(버전 없는 제목 행)는 함께 둔다
  const liveJo = new Set(rows.filter((r) => r.versionId).map((r) => joKey(r.policyId, r.number, r.branchNumber)));
  return rows.filter(
    (r) =>
      liveJo.has(joKey(r.policyId, r.number, r.branchNumber)) &&
      (r.versionId || (r.clauseNumber == null && r.itemNumber == null)),
  );
}

/**
 * 질문 낱말이 시행 중 본문·조문 제목에 들어 있는 조 — 들어 있는 낱말 수가 많은 순. 범위가 있으면 SQL 에서도 그 규정만 본다 —
 * 낱말마다 200행에서 자르므로, 결과를 나중에 거르면 범위 밖 규정이 자리를 차지해 범위 안의 조를 놓친다(T-219).
 */
export async function keywordGroups(
  db: PrismaService,
  tenantId: string,
  keywords: string[],
  liveKeys: Set<string>,
  scope: string[] | null,
): Promise<string[]> {
  const score = new Map<string, number>();
  const today = todayDateOnly();
  const inScope = scope ? Prisma.sql`AND p.id IN (${Prisma.join(scope)})` : Prisma.empty;
  for (const kw of keywords) {
    const pattern = `%${kw.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_')}%`;
    // 본문은 "현재" 버전만 본다(T-127) — 시행일 전인 개정 문구로 후보를 고르지 않는다
    const hits = await db.$queryRaw<{ policy_id: string; number: number; branch_number: number | null }[]>(
      Prisma.sql`
        SELECT DISTINCT c.policy_id, a.number, a.branch_number
        FROM articles a
        JOIN chapters c ON c.id = a.chapter_id
        JOIN policies p ON p.id = c.policy_id
        LEFT JOIN (${currentVersionsSql(tenantId, today, { activePoliciesOnly: true })}) cur ON cur.article_id = a.id
        WHERE p.tenant_id = ${tenantId} AND p.is_active = true ${inScope}
          AND (a.title LIKE ${pattern} ESCAPE '\\' OR cur.content LIKE ${pattern} ESCAPE '\\')
        LIMIT 200`,
    );
    for (const h of hits) {
      const key = joKey(h.policy_id, h.number, h.branch_number);
      if (liveKeys.has(key)) score.set(key, (score.get(key) ?? 0) + 1);
    }
  }
  return [...score.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => k);
}
