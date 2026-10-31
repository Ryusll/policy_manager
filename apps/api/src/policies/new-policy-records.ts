import { randomUUID } from 'crypto';
import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { AuditEntry } from '../audit/audit.service';
import { ChapterHeaderError, newChapterHeader } from './chapter-header';

/**
 * 가져오기로 만드는 새 규정의 행 전부(T-135) — 저장 트랜잭션 밖에서 미리 만들고, 안에서는 한꺼번에 넣기만 한다.
 *
 * 예전에는 규정·장·절·조문·버전·부칙을 하나씩 저장했다(서버 파싱 가져오기는 서비스 함수로, 텍스트 가져오기는 브라우저가 API 를
 * 차례로 불러서). 중간에 실패하면 규정만 있고 조문이 빠진 반쪽 규정이 남았고, 다시 하면 코드 중복으로 막혔다. 이제 두 경로 모두
 * 이 행들을 트랜잭션 하나에 넣는다. 하나씩 저장하던 함수의 정리·검사는 여기서 그대로 한다 — 코드·제목·조문 제목 앞뒤 공백, 장
 * 머리글 규칙(장 표기가 없는 문서의 숨김 장), 절 제목 필수, 부칙 제목 200자. 본문이 빈 행(항을 거느린 조의 제목 행)에는 버전을
 * 만들지 않는다(예전과 같다). id 는 미리 정해 장·절·조문을 잇는다(`createMany` 는 만든 id 를 돌려주지 않는다).
 */

/** 넣을 문서 — 서버 파싱의 `CommitPlan`, 텍스트 가져오기의 장·조문 목록이 모두 이 모양이 된다 */
export type NewPolicyPlan = {
  chapters: { number: number; title: string; suppressHeader: boolean; sections: { number: number; title: string }[] }[];
  rows: {
    number: number;
    branchNumber: number | null;
    clauseNumber: number | null;
    itemNumber: number | null;
    title: string;
    content: string;
    /** `chapters` 인덱스 */
    chapterIndex: number;
    /** 소속 장의 `sections` 인덱스. 절에 속하지 않으면 null */
    sectionIndex: number | null;
  }[];
  appendices: { kind: 'supplementary' | 'annex' | 'form'; title: string; body: string }[];
};

export type NewPolicyRecords = {
  policy: Prisma.PolicyUncheckedCreateInput & { id: string; code: string };
  chapters: (Prisma.ChapterCreateManyInput & { id: string })[];
  sections: (Prisma.SectionCreateManyInput & { id: string })[];
  articles: (Prisma.ArticleCreateManyInput & { id: string })[];
  versions: Prisma.ArticleVersionCreateManyInput[];
  appendices: Prisma.PolicyAppendixCreateManyInput[];
};

export type NewPolicyInput = {
  tenantId: string;
  userId: string;
  code: string;
  title: string;
  description?: string;
  /** 부서·분류 */
  metadata?: Prisma.InputJsonValue;
  /**
   * 바로 시행하면 그 본문이 실제로 시행된 날 — 규정 시행일이자 첫 버전의 시행일. null 이면 첫 버전을 초안으로 둔다
   * (편집자의 텍스트 가져오기 — 관리자가 상세 화면에서 한꺼번에 시행한다)
   */
  effective: Date | null;
  /** 바로 시행할 때의 시행 사유 */
  changeNote: string;
  /** 승인·발행 시각 */
  now: Date;
  newId?: () => string;
};

export function buildNewPolicyRecords(plan: NewPolicyPlan, input: NewPolicyInput): NewPolicyRecords {
  const newId = input.newId ?? randomUUID;
  const policyId = newId();
  const policy = {
    id: policyId,
    tenantId: input.tenantId,
    code: input.code.trim(),
    title: input.title.trim(),
    description: input.description,
    metadata: input.metadata,
    // 새 규정이라 규정 단위 시행일은 비어 있다 — 바로 시행하면 그 시행일로 채운다
    effectiveDate: input.effective ?? undefined,
  };

  const chapters: NewPolicyRecords['chapters'] = [];
  const sections: NewPolicyRecords['sections'] = [];
  const sectionIds: string[][] = [];
  for (const ch of plan.chapters) {
    let header;
    try {
      header = newChapterHeader({ title: ch.title, suppressHeader: ch.suppressHeader });
    } catch (e) {
      if (e instanceof ChapterHeaderError) throw new BadRequestException(e.message);
      throw e;
    }
    const chapterId = newId();
    chapters.push({ id: chapterId, policyId, number: ch.number, ...header });
    sectionIds.push(
      ch.sections.map((sec) => {
        const title = String(sec.title ?? '').trim();
        if (!title) throw new BadRequestException('절 제목을 입력하세요.');
        const id = newId();
        sections.push({ id, chapterId, number: sec.number, title });
        return id;
      }),
    );
  }

  const articles: NewPolicyRecords['articles'] = [];
  const versions: NewPolicyRecords['versions'] = [];
  for (const row of plan.rows) {
    const chapter = chapters[row.chapterIndex];
    if (!chapter) throw new BadRequestException('조문이 속한 장을 찾지 못했습니다 — 원문 미리보기를 다시 확인하세요.');
    const articleId = newId();
    articles.push({
      id: articleId,
      chapterId: chapter.id,
      sectionId: row.sectionIndex == null ? null : (sectionIds[row.chapterIndex]?.[row.sectionIndex] ?? null),
      number: row.number,
      branchNumber: row.branchNumber ?? null,
      title: (row.title ?? '').trim(),
      clauseNumber: row.clauseNumber ?? null,
      itemNumber: row.itemNumber ?? null,
    });
    if (!row.content) continue;
    versions.push(
      input.effective
        ? {
            // 가져온 본문은 이미 시행 중인 사내 규정이다 — 초안을 거치지 않고 첫 버전을 바로 발행한다
            articleId,
            versionNum: 1,
            content: row.content,
            status: 'published',
            approvedBy: input.userId,
            approvedAt: input.now,
            publishedAt: input.now, // 발행일(T-108) — 시행일과 다르다
            effectiveDate: input.effective,
            changeNote: input.changeNote,
            createdBy: input.userId,
          }
        : // 초안이다 — 본문의 변수 표식은 검토 요청 때 값으로 바뀐다(T-109)
          { articleId, versionNum: 1, content: row.content, status: 'draft', createdBy: input.userId },
    );
  }

  // 부칙·별표·서식은 조문이 아니라 규정의 부칙·별표 탭으로 보낸다
  const appendices = plan.appendices.map((a, sortOrder) => ({
    policyId,
    kind: a.kind,
    title: a.title.slice(0, 200).trim(),
    body: a.body ?? '',
    sortOrder,
  }));

  return { policy, chapters, sections, articles, versions, appendices };
}

/** createMany 한 번에 넣는 행 수 — 매개변수 상한(65535) 안쪽으로 */
const INSERT_CHUNK = 1000;

/** 나눠 넣고 넣은 수를 확인한다 — 하나라도 빠지면 트랜잭션째 되돌린다 */
async function insertChunks<T>(rows: T[], insert: (chunk: T[]) => Promise<{ count: number }>, what: string) {
  let inserted = 0;
  for (let i = 0; i < rows.length; i += INSERT_CHUNK) inserted += (await insert(rows.slice(i, i + INSERT_CHUNK))).count;
  if (inserted !== rows.length) throw new Error(`새 규정 넣기: ${what} ${rows.length}건 중 ${inserted}건만 들어갔습니다`);
}

/** 행 전부를 부모부터 넣는다 — 저장 트랜잭션(tx) 안에서만 부른다 */
export async function insertNewPolicy(tx: Prisma.TransactionClient, r: NewPolicyRecords) {
  const policy = await tx.policy.create({ data: r.policy });
  await insertChunks(r.chapters, (data) => tx.chapter.createMany({ data }), '장');
  await insertChunks(r.sections, (data) => tx.section.createMany({ data }), '절');
  await insertChunks(r.articles, (data) => tx.article.createMany({ data }), '조문');
  await insertChunks(r.versions, (data) => tx.articleVersion.createMany({ data }), '첫 버전');
  await insertChunks(r.appendices, (data) => tx.policyAppendix.createMany({ data }), '부칙·별표');
  return policy;
}

/** 하나씩 만들던 때와 같은 감사 기록(규정·장·절 생성) — `details` 는 기록마다 덧붙인다(가져오기 단위 추적) */
export function newPolicyAudits(r: NewPolicyRecords, ctx: { tenantId: string; userId: string; details?: Record<string, unknown> }): AuditEntry[] {
  const base = { tenantId: ctx.tenantId, userId: ctx.userId };
  const policyId = r.policy.id;
  return [
    { ...base, action: 'policy.create', entityType: 'Policy', entityId: policyId, details: { code: r.policy.code, ...ctx.details } },
    ...r.chapters.map((c) => ({ ...base, action: 'chapter.create', entityType: 'Chapter', entityId: c.id, details: { policyId, ...ctx.details } })),
    ...r.sections.map((s) => ({
      ...base,
      action: 'section.create',
      entityType: 'Section',
      entityId: s.id,
      details: { policyId, chapterId: s.chapterId, ...ctx.details },
    })),
  ];
}
