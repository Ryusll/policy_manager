import { Prisma } from '@prisma/client';
import { createHash } from 'crypto';
import { PrismaService } from '../common/prisma/prisma.service';
import { structureHash } from '../common/article-structure';
import { toDateOnlyString } from '../common/date-only';
import { contentFingerprint, normalizeText } from './reparse-match';

type Db = PrismaService | Prisma.TransactionClient;
const sha = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');
const day = (d: Date | null) => (d ? toDateOnlyString(d) : null);

/**
 * 묶음 지문 — 장·절·조문 계층·제목, 조문마다 발행 이력(상태·시행일·폐지일·얼린 계층)과 작업본(상태·제안 계층·묶음 여부),
 * 반영 계획. 검토 요청 뒤에는 묶음 버전 본문까지(그 뒤로는 고칠 수 없다).
 */
export async function bundleState(db: Db, policyId: string, plan: unknown, withContent: boolean): Promise<string> {
  const chapters = await db.chapter.findMany({
    where: { policyId },
    select: { id: true, number: true, title: true, suppressHeader: true, sections: { select: { id: true, number: true, title: true } } },
  });
  const articles = await db.article.findMany({
    where: { chapter: { policyId } },
    select: {
      id: true,
      chapterId: true,
      sectionId: true,
      number: true,
      branchNumber: true,
      clauseNumber: true,
      itemNumber: true,
      title: true,
      versions: {
        where: { status: { in: ['published', 'archived', 'draft', 'review'] } },
        select: { id: true, status: true, effectiveDate: true, repealedOn: true, structure: true, reparseItemId: true, content: true },
      },
    },
  });
  const lines = [
    ...chapters.map((c) => `C|${c.id}|${c.number}|${c.title}|${c.suppressHeader ? 1 : 0}`),
    ...chapters.flatMap((c) => c.sections.map((s) => `S|${c.id}|${s.id}|${s.number}|${s.title}`)),
    ...articles.map(
      (a) =>
        `A|${a.id}|${a.chapterId}|${a.sectionId ?? ''}|${a.number}|${a.branchNumber ?? ''}|${a.clauseNumber ?? ''}|${a.itemNumber ?? ''}|${a.title}`,
    ),
    ...articles.flatMap((a) =>
      a.versions.map(
        (v) =>
          `V|${a.id}|${v.id}|${v.status}|${day(v.effectiveDate) ?? ''}|${day(v.repealedOn) ?? ''}|${structureHash(v.structure)}|${v.reparseItemId ?? ''}|` +
          (withContent && v.reparseItemId ? contentFingerprint(normalizeText(v.content)) ?? '' : ''),
      ),
    ),
    `P|${structureHash(plan)}`,
  ].sort();
  return `bf1:${sha(lines.join('\n'))}`;
}
