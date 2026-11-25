import { createHash } from 'crypto';
import { Prisma, type PrismaClient } from '@prisma/client';

/**
 * 버전별 계층 (T-110 ②, 특허 도 5·13 — PAT-04 최소안).
 *
 * 조문의 계층(장·절·조·가지·항·목 번호, 조 제목)은 `Article` 행에 있다. 지금 시행 중인 계층은 늘 그 값이고, 버전에는
 * `ArticleVersion.structure` 를 둔다:
 * - 발행 이력(published·archived) — **얼린 계층**: 그 버전이 시행된 동안의 계층. 계층이 실제로 바뀌는 승인(재파싱 묶음의
 *   제안 계층) 때, 그 조문의 발행 이력 중 아직 얼리지 않은 버전 모두에 승인 직전의 계층을 넣는다. 비어 있으면 지금 `Article` 값을
 *   따른다(옛 기록·계층이 바뀐 적 없는 조문).
 * - 초안·검토 중 — **제안 계층**: 재파싱이 제안한 새 자리. 승인 때 `Article` 로 옮기고 비운다(시행본은 늘 비어 있다).
 * 조 순서 재정렬·번호 직접 수정은 지금 계층의 바로잡기라 버전을 만들지 않는다 — 다만 다른 조문의 얼린 자리와 겹치면 막는다.
 * 장 번호·제목은 장 행에만 있다(버전별로 남기지 않는다). 얼린 계층에는 그때의 장 번호·제목을 함께 적어 두어 과거 조회에 쓴다.
 */

type Db = PrismaClient | Prisma.TransactionClient;

export interface StructureSnapshot {
  v: 1;
  chapter: { id: string; number: number; title: string; hidden: boolean };
  section: { id: string; number: number; title: string } | null;
  number: number;
  branchNumber: number | null;
  clauseNumber: number | null;
  itemNumber: number | null;
  title: string;
}

/** 재파싱이 제안한 새 자리 — 장·절은 기존 id 또는 승인 때 만들 계획의 키 */
export interface StructureProposal {
  v: 1;
  kind: 'proposal';
  chapter: { id: string | null; key: string | null };
  section: { id: string | null; key: string | null } | null;
  number: number;
  branchNumber: number | null;
  clauseNumber: number | null;
  itemNumber: number | null;
  title: string;
  /** 제안을 만들 때의 계층 — 승인 때 지금 값과 다르면 다시 비교해야 한다 */
  base: StructureSnapshot;
}

export type Position = Pick<StructureSnapshot, 'number' | 'branchNumber' | 'clauseNumber' | 'itemNumber'>;

export const positionKey = (p: Position) => `${p.number}|${p.branchNumber ?? 0}|${p.clauseNumber ?? 0}|${p.itemNumber ?? 0}`;

const int = (v: unknown) => typeof v === 'number' && Number.isInteger(v);
const intOrNull = (v: unknown) => v === null || int(v);

export function parseSnapshot(value: unknown): StructureSnapshot | null {
  const s = value as StructureSnapshot | null;
  if (!s || typeof s !== 'object' || s.v !== 1 || (s as unknown as StructureProposal).kind === 'proposal') return null;
  if (!s.chapter || typeof s.chapter.id !== 'string' || !int(s.chapter.number)) return null;
  if (!int(s.number) || !intOrNull(s.branchNumber) || !intOrNull(s.clauseNumber) || !intOrNull(s.itemNumber)) return null;
  return s;
}

export function parseProposal(value: unknown): StructureProposal | null {
  const s = value as StructureProposal | null;
  if (!s || typeof s !== 'object' || s.v !== 1 || s.kind !== 'proposal') return null;
  if (!s.chapter || !int(s.number) || !parseSnapshot(s.base)) return null;
  return s;
}

/** 지금 계층(Article 행 + 장·절) — 얼리거나 제안의 기준으로 쓴다 */
export async function liveStructures(db: Db, articleIds: string[]): Promise<Map<string, StructureSnapshot>> {
  if (!articleIds.length) return new Map();
  const rows = await db.article.findMany({
    where: { id: { in: articleIds } },
    select: {
      id: true,
      number: true,
      branchNumber: true,
      clauseNumber: true,
      itemNumber: true,
      title: true,
      chapter: { select: { id: true, number: true, title: true, suppressHeader: true } },
      section: { select: { id: true, number: true, title: true } },
    },
  });
  return new Map(rows.map((a) => [a.id, snapshotOf(a)]));
}

export function snapshotOf(a: {
  number: number;
  branchNumber: number | null;
  clauseNumber: number | null;
  itemNumber: number | null;
  title: string | null;
  chapter: { id: string; number: number; title: string; suppressHeader: boolean };
  section: { id: string; number: number; title: string } | null;
}): StructureSnapshot {
  return {
    v: 1,
    chapter: { id: a.chapter.id, number: a.chapter.number, title: a.chapter.title, hidden: a.chapter.suppressHeader },
    section: a.section ? { id: a.section.id, number: a.section.number, title: a.section.title } : null,
    number: a.number,
    branchNumber: a.branchNumber,
    clauseNumber: a.clauseNumber,
    itemNumber: a.itemNumber,
    title: a.title ?? '',
  };
}

/** 계층이 같은가 — 장·절은 id 로, 자리·제목은 값으로 */
export function sameStructure(a: StructureSnapshot, b: StructureSnapshot): boolean {
  return (
    a.chapter.id === b.chapter.id &&
    (a.section?.id ?? null) === (b.section?.id ?? null) &&
    positionKey(a) === positionKey(b) &&
    (a.title ?? '') === (b.title ?? '')
  );
}

/** 키 순서를 고정한 JSON — jsonb 는 저장할 때 키 순서를 바꾸므로, 저장 전후 값을 같은 지문으로 보려면 정렬해야 한다 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
}

/** 지문에 넣을 계층 값(장·절 제목 변경까지 본다) */
export function structureHash(value: unknown): string {
  return value == null ? '' : createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex').slice(0, 16);
}

/**
 * 계층이 실제로 바뀌기 직전에 부른다 — 그 조문의 발행 이력 중 아직 얼리지 않은 버전 모두에 지금 계층을 넣는다.
 * 그래야 더 오래된 버전도 새 계층을 따라가지 않는다. 시행본(published)도 넣는다: 같은 승인에서 곧 내려간다.
 */
export async function freezeIssued(db: Db, articleId: string, live: StructureSnapshot): Promise<number> {
  const r = await db.articleVersion.updateMany({
    where: { articleId, status: { in: ['published', 'archived'] }, structure: { equals: Prisma.DbNull } },
    data: { structure: live as unknown as Prisma.InputJsonValue },
  });
  return r.count;
}
