import type { Prisma } from '@prisma/client';
import type { PrismaService } from '../common/prisma/prisma.service';
import { descendantPrefix, selfAndAncestorNodeKeys } from '../laws/law-node-key';
import { ourLinks } from '../law-links/our-links';

/**
 * 바뀐 법령조항에서 연결을 찾는 범위 (T-148) — 그 조항과 같은 법령의 상위 조항(조·항).
 *
 * 인용 자동 찾기는 '제60조'를 조 머리 행(60//)에 잇는데, 항이 여럿인 조는 머리 행 본문이 비어 있어 항 개정
 * 이벤트가 항(60/1/)에만 생긴다. 같은 행만 보면 가장 흔한 연결이 실제 개정을 받지 못한다. 영향 조회·자동 생성의
 * 회사 찾기·변경 목록(거르기·개수)·추천 수가 모두 이 파일의 함수를 쓴다 — 화면에서 본 영향과 후보가 갈라지지 않게.
 *
 * ⚠️ **테넌트 경계.** LawArticle 은 회사 공용이다. 여기서 구한 법령조항 id 로 lawLink 를 찾을 때는 반드시
 * `ourLinks`(연결의 회사 + 조문의 실제 소속)로 건다 — 연결의 회사만 보고 조문의 소속을 안 본 것이 T-41 의 사고다.
 */

/** 바뀐 조항 하나 — 그 조항과 같은 법령의 상위 조항 id(자신 포함) */
export async function reachOf(prisma: PrismaService, lawArticleId: string): Promise<string[]> {
  const self = await prisma.lawArticle.findUnique({ where: { id: lawArticleId }, select: { lawId: true, nodeKey: true } });
  if (!self) return [lawArticleId];
  const rows = await prisma.lawArticle.findMany({
    where: { lawId: self.lawId, nodeKey: { in: selfAndAncestorNodeKeys(self.nodeKey) } },
    select: { id: true },
  });
  return [...new Set([lawArticleId, ...rows.map((r) => r.id)])];
}

/**
 * 바뀐 조항에 확정 연결이 닿는 회사들 — 자동 생성의 회사 찾기. 회사 경계를 넘는 시스템 조회라 회사 id 만 돌려주고,
 * 연결의 회사와 조문의 실제 소속이 같은 연결만 센다(T-41). 회사별 생성은 그 회사 조건으로 다시 한다
 */
export async function tenantsReached(prisma: PrismaService, lawArticleId: string): Promise<string[]> {
  const reach = await reachOf(prisma, lawArticleId);
  // 회사 id 만 먼저 뽑는다. Prisma 의 distinct 는 SQL DISTINCT 가 아니라 엔진에서 거르므로 DB 는 닿는 확정 연결 행을
  // 다 읽는다(열은 회사 id 하나). "연결의 회사 = 조문의 회사"는 Prisma 조건 하나로 쓸 수 없어, 회사마다 다시 본다
  const candidates = await prisma.lawLink.findMany({
    where: { lawArticleId: { in: reach }, confirmState: 'confirmed' },
    select: { tenantId: true },
    distinct: ['tenantId'],
  });
  const reached: string[] = [];
  for (const { tenantId } of candidates) {
    const owned = await prisma.lawLink.findFirst({
      where: ourLinks(tenantId, { lawArticleId: { in: reach }, confirmState: 'confirmed' }),
      select: { id: true },
    });
    if (owned) reached.push(tenantId);
  }
  return reached;
}

/** 변경 이벤트 여럿 — 이벤트 id → 닿는 법령조항 id. 조항 행이 없는 이벤트(예전에 지운 조항)는 빈 목록 */
export async function reachOfEvents(
  prisma: PrismaService,
  events: Array<{ id: string; lawId: string; lawArticleId: string | null; nodeKey: string }>,
): Promise<Map<string, string[]>> {
  const linked = events.filter((e) => e.lawArticleId);
  const keysByLaw = new Map<string, Set<string>>();
  for (const e of linked) {
    const keys = keysByLaw.get(e.lawId) ?? new Set<string>();
    for (const k of selfAndAncestorNodeKeys(e.nodeKey)) keys.add(k);
    keysByLaw.set(e.lawId, keys);
  }
  const rows = keysByLaw.size
    ? await prisma.lawArticle.findMany({
        where: { OR: [...keysByLaw].map(([lawId, keys]) => ({ lawId, nodeKey: { in: [...keys] } })) },
        select: { id: true, lawId: true, nodeKey: true },
      })
    : [];
  const idOf = new Map(rows.map((r) => [`${r.lawId}|${r.nodeKey}`, r.id]));
  const reach = new Map<string, string[]>();
  for (const e of events) {
    if (!e.lawArticleId) {
      reach.set(e.id, []);
      continue;
    }
    const ancestors = selfAndAncestorNodeKeys(e.nodeKey).flatMap((k) => idOf.get(`${e.lawId}|${k}`) ?? []);
    reach.set(e.id, [...new Set([e.lawArticleId, ...ancestors])]);
  }
  return reach;
}

/**
 * "우리 조문에 걸린 변경만" — 우리 회사의 확정 연결이 걸린 조항이나 그 **아래** 조항의 변경.
 * 조항 행이 없는 이벤트(예전에 지운 조항)는 연결을 따라갈 수 없어 넣지 않는다(T-105 와 같다)
 */
export async function affectedEventsWhere(prisma: PrismaService, tenantId: string): Promise<Prisma.LawChangeEventWhereInput> {
  const linked = await prisma.lawLink.findMany({
    where: ourLinks(tenantId, { confirmState: 'confirmed' }),
    select: { lawArticle: { select: { lawId: true, nodeKey: true } } },
    distinct: ['lawArticleId'],
  });
  if (!linked.length) return { id: { in: [] } };
  return {
    lawArticleId: { not: null },
    OR: linked.map(({ lawArticle: { lawId, nodeKey } }) => {
      const prefix = descendantPrefix(nodeKey);
      return prefix ? { lawId, nodeKey: { startsWith: prefix } } : { lawId, nodeKey };
    }),
  };
}

/**
 * 이벤트마다 우리 회사 조문 수 — 확정 연결이 걸린 조문, 추천 연결이 걸린 조문("확인 필요").
 * 같은 조문이 조·항에 둘 다 걸려도 한 번 센다
 */
export async function impactCounts(
  prisma: PrismaService,
  tenantId: string,
  reach: Map<string, string[]>,
): Promise<(eventId: string) => { confirmed: number; suggested: number }> {
  const ids = [...new Set([...reach.values()].flat())];
  const links = ids.length
    ? await prisma.lawLink.findMany({
        where: ourLinks(tenantId, { lawArticleId: { in: ids }, confirmState: { in: ['confirmed', 'suggested'] } }),
        select: { lawArticleId: true, articleId: true, confirmState: true },
      })
    : [];
  return (eventId) => countArticles(links, new Set(reach.get(eventId) ?? []));
}

/**
 * 닿는 조항에 걸린 연결로 조문 수를 센다. 확정 연결이 있는 조문의 추천 연결도 확인 필요로 센다 — 조 단위로
 * 확정된 조문의 항 단위 추천은 확정하면 바뀐 항에 바로 닿는(상위 조항 표시가 풀리는) 연결이라 감추지 않는다
 */
export function countArticles(
  links: Array<{ lawArticleId: string; articleId: string; confirmState: string }>,
  reach: Set<string>,
): { confirmed: number; suggested: number } {
  const confirmed = new Set<string>();
  const suggested = new Set<string>();
  for (const l of links) {
    if (!reach.has(l.lawArticleId)) continue;
    if (l.confirmState === 'confirmed') confirmed.add(l.articleId);
    else if (l.confirmState === 'suggested') suggested.add(l.articleId);
  }
  return { confirmed: confirmed.size, suggested: suggested.size };
}
