import { describe, it, expect } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import {
  buildNewPolicyRecords,
  newPolicyAudits,
  type NewPolicyInput,
  type NewPolicyPlan,
} from '../apps/api/src/policies/new-policy-records';

/**
 * 가져오기로 만드는 새 규정의 행(T-135) — 하나씩 저장하던 서비스 함수의 정리·검사를 그대로 하고, 미리 정한 id 로 장·절·조문을 잇는다.
 * 서버 파싱 가져오기 확정과 텍스트 가져오기가 함께 쓴다.
 */

const now = new Date('2026-10-10T01:02:03Z');
const effective = new Date('2024-01-01T00:00:00Z');
const input = (over: Partial<NewPolicyInput> = {}): NewPolicyInput => {
  let n = 0;
  return {
    tenantId: 'tenant-1',
    userId: 'user-1',
    code: '  HR-01 ',
    title: ' 인사규정  ',
    description: '설명',
    effective,
    changeNote: 'PDF 파싱 커밋 자동 게시',
    now,
    newId: () => `id${(n += 1)}`,
    ...over,
  };
};
const row = (over: Partial<NewPolicyPlan['rows'][number]>) => ({
  number: 1,
  branchNumber: null,
  clauseNumber: null,
  itemNumber: null,
  title: '',
  content: '',
  chapterIndex: 0,
  sectionIndex: null,
  ...over,
});
const plan = (over: Partial<NewPolicyPlan> = {}): NewPolicyPlan => ({
  chapters: [
    { number: 1, title: '총칙', suppressHeader: false, sections: [{ number: 1, title: '통칙' }] },
    { number: 2, title: '', suppressHeader: true, sections: [] },
  ],
  rows: [
    row({ number: 1, title: ' 목적 ', content: '이 규정은 목적을 정한다.', sectionIndex: 0 }),
    row({ number: 2, title: '적용범위', content: '' }),
    row({ number: 2, clauseNumber: 1, content: '첫째 항', sectionIndex: 0 }),
    row({ number: 2, branchNumber: 2, title: '특례', content: '특례 본문', chapterIndex: 1 }),
  ],
  appendices: [
    { kind: 'supplementary', title: `  ${'부'.repeat(198)}칙 끝`, body: '이 규정은 공포한 날부터 시행한다.' },
    { kind: 'annex', title: '별표 1', body: '' },
  ],
  ...over,
});

describe('buildNewPolicyRecords', () => {
  it('규정은 코드·제목 앞뒤 공백을 지우고, 가져오기 시행일을 규정 시행일로', () => {
    const r = buildNewPolicyRecords(plan(), input());
    expect(r.policy).toEqual({
      id: 'id1',
      tenantId: 'tenant-1',
      code: 'HR-01',
      title: '인사규정',
      description: '설명',
      metadata: undefined,
      effectiveDate: effective,
    });
  });

  it('미리 정한 id 로 장 → 절 → 조문을 잇는다 — 절은 그 장의 것만', () => {
    const r = buildNewPolicyRecords(plan(), input());
    expect(r.chapters.map((c) => [c.id, c.policyId, c.number])).toEqual([
      ['id2', 'id1', 1],
      ['id4', 'id1', 2],
    ]);
    expect(r.sections).toEqual([{ id: 'id3', chapterId: 'id2', number: 1, title: '통칙' }]);
    expect(r.articles.map((a) => [a.chapterId, a.sectionId, a.number, a.branchNumber, a.clauseNumber, a.itemNumber, a.title])).toEqual([
      ['id2', 'id3', 1, null, null, null, '목적'],
      ['id2', null, 2, null, null, null, '적용범위'],
      ['id2', 'id3', 2, null, 1, null, ''],
      ['id4', null, 2, 2, null, null, '특례'],
    ]);
    // 장에 없는 절 자리를 가리키면 절 없이 둔다(예전과 같다)
    const stray = buildNewPolicyRecords(plan({ rows: [row({ chapterIndex: 1, sectionIndex: 0, content: 'x' })] }), input());
    expect(stray.articles[0].sectionId).toBeNull();
  });

  it('장 머리글 규칙 — 숨김 장은 제목이 비면 "본문", 보이는 장은 제목이 없으면 400', () => {
    const r = buildNewPolicyRecords(plan(), input());
    expect(r.chapters.map((c) => [c.title, c.suppressHeader])).toEqual([
      ['총칙', false],
      ['본문', true],
    ]);
    const visibleUntitled = plan({ chapters: [{ number: 1, title: '  ', suppressHeader: false, sections: [] }], rows: [row({ content: 'x' })] });
    expect(() => buildNewPolicyRecords(visibleUntitled, input())).toThrow(BadRequestException);
  });

  it('절 제목이 비면 400, 조문이 없는 장을 가리키면 400 — 아무것도 넣기 전에 막는다', () => {
    const blankSection = plan({ chapters: [{ number: 1, title: '총칙', suppressHeader: false, sections: [{ number: 1, title: ' ' }] }] });
    expect(() => buildNewPolicyRecords(blankSection, input())).toThrow('절 제목을 입력하세요.');
    expect(() => buildNewPolicyRecords(plan({ rows: [row({ chapterIndex: 5, content: 'x' })] }), input())).toThrow(BadRequestException);
  });

  it('첫 버전은 본문이 있는 행에만, 바로 발행 — 시행일·승인·발행 시각·만든 사람·출처 메모', () => {
    const r = buildNewPolicyRecords(plan(), input());
    expect(r.versions.map((v) => v.articleId)).toEqual([r.articles[0].id, r.articles[2].id, r.articles[3].id]);
    expect(r.versions[0]).toEqual({
      articleId: r.articles[0].id,
      versionNum: 1,
      content: '이 규정은 목적을 정한다.',
      status: 'published',
      approvedBy: 'user-1',
      approvedAt: now,
      publishedAt: now,
      effectiveDate: effective,
      changeNote: 'PDF 파싱 커밋 자동 게시',
      createdBy: 'user-1',
    });
  });

  it('시행일이 없으면(편집자의 텍스트 가져오기) 첫 버전은 초안 — 승인·시행일 없이 만든 사람만, 규정 시행일도 비운다', () => {
    const r = buildNewPolicyRecords(plan(), input({ effective: null, metadata: { department: '인사팀' } }));
    expect(r.policy.effectiveDate).toBeUndefined();
    expect(r.policy.metadata).toEqual({ department: '인사팀' });
    expect(r.versions.map((v) => v.status)).toEqual(['draft', 'draft', 'draft']);
    expect(r.versions[0]).toEqual({ articleId: r.articles[0].id, versionNum: 1, content: '이 규정은 목적을 정한다.', status: 'draft', createdBy: 'user-1' });
  });

  it('감사 기록은 하나씩 만들던 때와 같은 이벤트(규정·장·절) — 가져오기 단위 정보를 덧붙인다', () => {
    const r = buildNewPolicyRecords(plan(), input());
    const audits = newPolicyAudits(r, { tenantId: 'tenant-1', userId: 'user-1', details: { sessionId: 's-1' } });
    expect(audits.map((a) => [a.action, a.entityId, a.details])).toEqual([
      ['policy.create', 'id1', { code: 'HR-01', sessionId: 's-1' }],
      ['chapter.create', 'id2', { policyId: 'id1', sessionId: 's-1' }],
      ['chapter.create', 'id4', { policyId: 'id1', sessionId: 's-1' }],
      ['section.create', 'id3', { policyId: 'id1', chapterId: 'id2', sessionId: 's-1' }],
    ]);
    expect(audits.every((a) => a.tenantId === 'tenant-1' && a.userId === 'user-1')).toBe(true);
  });

  it('부칙·별표는 차례대로, 제목은 200자에서 자른 뒤 앞뒤 공백을 지운다', () => {
    const r = buildNewPolicyRecords(plan(), input());
    expect(r.appendices.map((a) => [a.policyId, a.kind, a.sortOrder, a.body])).toEqual([
      ['id1', 'supplementary', 0, '이 규정은 공포한 날부터 시행한다.'],
      ['id1', 'annex', 1, ''],
    ]);
    expect(r.appendices[0].title).toBe(`${'부'.repeat(198)}`);
  });

  it('id 를 주지 않으면 UUID 로 — 첨부 폴더 이름이 되므로 UUID 여야 한다', () => {
    const r = buildNewPolicyRecords(plan(), input({ newId: undefined }));
    const ids = [r.policy.id, ...r.chapters.map((c) => c.id), ...r.sections.map((s) => s.id), ...r.articles.map((a) => a.id)];
    for (const id of ids) expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
