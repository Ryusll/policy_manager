import type { PrismaService } from '../common/prisma/prisma.service';
import { ourLinks } from '../law-links/our-links';
import type { InForceArticle } from '../laws/law-in-force';
import { readLawInForce } from '../laws/law-in-force.query';
import { descendantPrefix } from '../laws/law-node-key';

/**
 * T-209 규정 질문의 법령 근거 — 회사가 확정한 법령 연결의 오늘 시행 중 문구 (SRS SEARCH-4, ADR-0028).
 *
 * 고른 조문에 **확정(confirmed)** 연결이 있으면 그 법령 조문을 [L번호]와 함께 AI 에 준다. 추천(suggested)·거절 연결과 개정
 * 후보(초안)는 넣지 않는다. 문구는 `readLawInForce` 의 **오늘 시행 중** 문구다 — 법령 행의 본문은 마지막으로 반영한 판이라
 * 시행 전 문구일 수 있다(T-150). 조 머리에 걸린 연결은 머리 본문이 비어 있는 일이 흔해(항이 여럿인 조) 아래 항·호까지 함께
 * 준다. 시행 예정 개정이 있으면 시행일을 함께 적는다. 회사 경계는 `ourLinks`(연결의 회사와 조문의 실제 소속을 둘 다 본다).
 */

/** 법령 문구 전체·조문 하나의 길이 상한(글자) — 넘치면 뒤쪽 조문을 뺀다(첫 조문은 늘 넣는다) */
export const LAW_CONTEXT_MAX_CHARS = 6_000;
export const LAW_ARTICLE_MAX_CHARS = 1_500;
/** 한 질문에 읽는 법령 수 상한 — 법령마다 전체 조항을 한 번 읽는다 */
const MAX_LAWS = 6;

export interface LawRef {
  ref: string;
  lawId: string;
  lawName: string;
  lawArticleId: string;
  label: string;
  title: string | null;
  /** 오늘 시행 중 문구(아래 항·호 포함, 상한까지) */
  content: string;
  /** 가장 먼저 시행될 예정 개정의 시행일 — 없으면 null */
  scheduledOn: string | null;
}

export interface LinkedLawArticle {
  lawId: string;
  lawName: string;
  lawArticleId: string;
  nodeKey: string;
}

const clip = (s: string, max: number) => (s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s);

/**
 * 연결된 법령 조항(관련도 순)과 각 법령의 현행 조항 목록으로 <법령> 글과 참조 번호를 만든다 — DB 를 부르지 않는 순수 함수.
 * 같은 조항이 여러 조문에 걸려 있어도 한 번만 준다. 오늘 시행 중 문구가 없으면(시행일에 신설될 조항) 뺀다.
 */
export function buildLawContext(
  links: LinkedLawArticle[],
  inForce: Map<string, InForceArticle[]>,
  maxChars = LAW_CONTEXT_MAX_CHARS,
  perArticle = LAW_ARTICLE_MAX_CHARS,
): { text: string; refs: LawRef[] } {
  const refs: LawRef[] = [];
  const lines: { lawName: string; line: string }[] = [];
  const seen = new Set<string>();
  let size = 0;
  for (const link of links) {
    const key = `${link.lawId}:${link.nodeKey}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const articles = inForce.get(link.lawId) ?? [];
    const self = articles.find((a) => a.nodeKey === link.nodeKey);
    if (!self) continue;
    const prefix = descendantPrefix(link.nodeKey);
    const rows = [self, ...(prefix ? articles.filter((a) => a.nodeKey.startsWith(prefix)) : [])];
    const content = clip(
      rows
        .map((a) => a.content?.trim() ?? '')
        .filter(Boolean)
        .join(' '),
      perArticle,
    );
    if (!content) continue;
    const scheduledOn = rows
      .map((a) => a.scheduled?.effectiveDate ?? null)
      .filter((d): d is string => !!d)
      .sort()[0] ?? null;
    const line = lineOf(refs.length + 1, self, content, scheduledOn);
    if (refs.length > 0 && size + line.length > maxChars) break;
    size += line.length + 1;
    lines.push({ lawName: link.lawName, line });
    refs.push({
      ref: `L${refs.length + 1}`,
      lawId: link.lawId,
      lawName: link.lawName,
      lawArticleId: self.id,
      label: self.label,
      title: self.title,
      content,
      scheduledOn,
    });
  }
  if (!refs.length) return { text: '', refs };
  // 법령별로 묶어 보인다 — 참조 번호 순서는 그대로
  const byLaw = new Map<string, string[]>();
  for (const l of lines) byLaw.set(l.lawName, [...(byLaw.get(l.lawName) ?? []), l.line]);
  const text = [...byLaw.entries()].map(([name, ls]) => `<법령 이름="${name}">\n${ls.join('\n')}\n</법령>`).join('\n');
  return { text, refs };
}

function lineOf(n: number, a: InForceArticle, content: string, scheduledOn: string | null): string {
  const title = a.title?.trim() ? `(${a.title.trim()})` : '';
  const note = scheduledOn ? ` (${scheduledOn} 시행 예정 개정이 있다)` : '';
  return `[L${n}] ${a.label}${title} ${content}${note}`;
}

/**
 * 고른 조문(관련도 순)에 걸린 확정 연결의 법령 근거. 연결이 없으면 빈 글 — 그때 AI 는 법령 이름까지만 쓴다(SEARCH-4).
 */
export async function lawContextFor(
  prisma: PrismaService,
  tenantId: string,
  articleIds: string[],
  now: Date = new Date(),
): Promise<{ text: string; refs: LawRef[] }> {
  if (!articleIds.length) return { text: '', refs: [] };
  const found = await prisma.lawLink.findMany({
    where: ourLinks(tenantId, { articleId: { in: articleIds }, confirmState: 'confirmed' }),
    select: {
      articleId: true,
      lawArticle: { select: { id: true, nodeKey: true, lawId: true, law: { select: { lawName: true } } } },
    },
  });
  const order = new Map(articleIds.map((id, i) => [id, i]));
  const links: LinkedLawArticle[] = found
    .sort((a, b) => (order.get(a.articleId) ?? 0) - (order.get(b.articleId) ?? 0))
    .map((l) => ({
      lawId: l.lawArticle.lawId,
      lawName: l.lawArticle.law.lawName,
      lawArticleId: l.lawArticle.id,
      nodeKey: l.lawArticle.nodeKey,
    }));
  const lawIds = [...new Set(links.map((l) => l.lawId))].slice(0, MAX_LAWS);
  const inForce = new Map<string, InForceArticle[]>();
  for (const id of lawIds) inForce.set(id, (await readLawInForce(prisma, id, now)).articles);
  return buildLawContext(
    links.filter((l) => inForce.has(l.lawId)),
    inForce,
  );
}
