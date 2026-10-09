import { describe, it, expect } from 'vitest';
import { parseProposal, parseSnapshot, sameStructure, type StructureSnapshot } from '../apps/api/src/common/article-structure';
import { placeAsOf } from '../apps/api/src/policies/as-of-structure';
import { planApply, proposalFor, type PlanArticle, type PlanItem, type ParsedJson } from '../apps/api/src/regulation-parse/reparse-apply-plan';
import { findBoundaryConflicts, type BoundaryArticle } from '../apps/api/src/regulation-parse/reparse-boundary';

const snap = (number: number, chapter = { id: 'c1', number: 1, title: '총칙', hidden: false }, extra: Partial<StructureSnapshot> = {}): StructureSnapshot => ({
  v: 1,
  chapter,
  section: null,
  number,
  branchNumber: null,
  clauseNumber: null,
  itemNumber: null,
  title: `제목${number}`,
  ...extra,
});

describe('버전별 계층 — 얼린 값 읽기 (T-110 ②, PAT-04)', () => {
  it('얼린 계층과 제안 계층을 가르고, 모양이 틀리면 버린다', () => {
    expect(parseSnapshot(snap(3))).toMatchObject({ number: 3 });
    expect(parseSnapshot({ ...snap(3), v: 2 })).toBeNull();
    expect(parseSnapshot({ ...snap(3), number: '3' })).toBeNull();
    const proposal = { v: 1, kind: 'proposal', chapter: { id: 'c1', key: null }, section: null, number: 4, branchNumber: null, clauseNumber: null, itemNumber: null, title: 'x', base: snap(3) };
    expect(parseSnapshot(proposal)).toBeNull();
    // 모양이 얼린 계층과 같아도 제안이라고 적혀 있으면 얼린 계층으로 읽지 않는다
    expect(parseSnapshot({ ...snap(4), kind: 'proposal' })).toBeNull();
    expect(parseProposal(proposal)).toMatchObject({ number: 4 });
    expect(parseProposal({ ...proposal, base: null })).toBeNull();
  });

  it('같은 계층 — 장·절 id, 자리, 제목', () => {
    expect(sameStructure(snap(3), snap(3))).toBe(true);
    expect(sameStructure(snap(3), snap(4))).toBe(false);
    expect(sameStructure(snap(3), snap(3, undefined, { title: '다른 제목' }))).toBe(false);
    expect(sameStructure(snap(3), snap(3, { id: 'c2', number: 1, title: '총칙', hidden: false }))).toBe(false);
  });
});

describe('placeAsOf — 시점 조회를 그때의 계층으로 (T-110 ②)', () => {
  const article = (id: string, number: number, chapterId: string, version: { status: string; structure?: unknown }) => ({
    id,
    chapterId,
    sectionId: null,
    number,
    branchNumber: null,
    clauseNumber: null,
    itemNumber: null,
    title: `지금${number}`,
    versions: [version],
  });
  const chapter = (id: string, number: number, title: string, articles: any[]) => ({ id, number, title, suppressHeader: false, sections: [], articles });

  it('얼린 계층이 있으면 그 자리·제목과 그때의 장으로 옮기고, 없으면 지금 값', () => {
    const out = placeAsOf([
      chapter('c1', 1, '총칙', [article('a', 5, 'c1', { status: 'archived', structure: snap(4, { id: 'c1', number: 1, title: '총칙', hidden: false }) })]),
      chapter('c2', 2, '휴가', [article('b', 7, 'c2', { status: 'published', structure: null })]),
    ]);
    expect(out.map((c) => [c.id, c.number, c.articles.map((a: any) => [a.id, a.number, a.title])])).toEqual([
      ['c1', 1, [['a', 4, '제목4']]],
      ['c2', 2, [['b', 7, '지금7']]],
    ]);
  });

  it('그 뒤에 지워진 장은 그때의 번호·제목으로 다시 세우고, 장의 조문이 모두 얼린 값이면 그때의 장 번호·제목', () => {
    const old = { id: 'gone', number: 2, title: '옛 장', hidden: false };
    const out = placeAsOf([
      chapter('c1', 1, '총칙', [article('a', 3, 'c1', { status: 'archived', structure: snap(2, old) })]),
      chapter('c3', 4, '지금 장', [article('b', 9, 'c3', { status: 'archived', structure: snap(9, { id: 'c3', number: 3, title: '그때 이름', hidden: false }) })]),
    ]);
    expect(out.map((c) => [c.id, c.number, c.title, c.articles.length])).toEqual([
      ['c1', 1, '총칙', 0],
      ['gone', 2, '옛 장', 1],
      ['c3', 3, '그때 이름', 1],
    ]);
  });

  it('장에 지금 계층의 조문과 얼린 조문이 섞이면 장 번호·제목은 지금 값', () => {
    const out = placeAsOf([
      chapter('c1', 1, '총칙(개정)', [
        article('a', 1, 'c1', { status: 'published' }),
        article('b', 2, 'c1', { status: 'archived', structure: snap(2, { id: 'c1', number: 1, title: '총칙', hidden: false }) }),
      ]),
    ]);
    expect(out.map((c) => [c.number, c.title, c.articles.length])).toEqual([[1, '총칙(개정)', 2]]);
  });

  it('장 안 순서는 조·가지·항·목', () => {
    const out = placeAsOf([
      chapter('c1', 1, '총칙', [
        article('x', 1, 'c1', { status: 'archived', structure: snap(3) }),
        article('y', 2, 'c1', { status: 'published' }),
        article('z', 3, 'c1', { status: 'archived', structure: snap(1) }),
      ]),
    ]);
    expect(out[0].articles.map((a: any) => [a.id, a.number])).toEqual([
      ['z', 1],
      ['y', 2],
      ['x', 3],
    ]);
  });
});

describe('planApply — 반영은 검토 대상 만들기 (T-110 ②)', () => {
  const C1 = { id: 'c1', number: 1, title: '총칙', hidden: false };
  const parsed = (index: number, number: number, content: string, title = `제목${number}`, chapter: ParsedJson['chapter'] = { index: 0, number: 1, title: '총칙', hidden: false, storedId: 'c1' }): ParsedJson => ({
    index,
    label: `제${number}조`,
    number,
    branch: null,
    clause: null,
    item: null,
    title,
    content,
    chapter,
    section: null,
  });
  const art = (id: string, number: number, content: string, extra: Partial<PlanArticle> = {}): PlanArticle => ({
    id,
    live: snap(number, C1),
    base: { versionId: `v-${id}`, status: 'published', content },
    inForce: true,
    repealed: false,
    pending: null,
    ...extra,
  });
  const item = (id: string, kind: string, decision: string | null, articleId: string | null, p: ParsedJson | null, targetArticleId: string | null = null): PlanItem => ({
    id,
    kind,
    decision,
    articleId,
    targetArticleId,
    parsed: p,
    label: p?.label ?? id,
  });
  const chapters = [{ ...C1, sections: [] }];

  it('옮김은 본문을 그대로 두고 제안 계층만, 개정은 원문 본문 + (자리가 바뀌면) 제안 계층', () => {
    const articles = new Map([
      ['a2', art('a2', 2, '정의 본문')],
      ['a3', art('a3', 3, '휴가는 15일')],
    ]);
    const plan = planApply(
      [item('i1', 'moved', 'accept', 'a2', parsed(1, 3, '정의  본문')), item('i2', 'changed', 'amend', 'a3', parsed(2, 3, '휴가는 20일'))],
      articles,
      chapters,
      [],
    );
    expect(plan.drafts).toEqual([
      expect.objectContaining({ itemId: 'i1', articleId: 'a2', content: '정의 본문', reason: 'structure', proposal: expect.objectContaining({ number: 3, base: snap(2, C1) }) }),
      expect.objectContaining({ itemId: 'i2', articleId: 'a3', content: '휴가는 20일', reason: 'amend', proposal: null }),
    ]);
  });

  it('새 조문은 행을 만들지 않고 계획에만, 새 장은 승인 때 만들 장 계획으로', () => {
    const newChapter = { index: 1, number: 2, title: '보칙', hidden: false, storedId: null };
    const plan = planApply([item('i1', 'new', 'new', null, parsed(0, 9, '새 조 본문', '보칙', newChapter))], new Map(), chapters, []);
    expect(plan.newArticles).toEqual([expect.objectContaining({ itemId: 'i1', chapter: { id: null, key: 'c1' }, number: 9, content: '새 조 본문' })]);
    expect(plan.chapters.create).toEqual([{ key: 'c1', number: 2, title: '보칙', hidden: false }]);
    expect(plan.drafts).toEqual([]);
  });

  it('새 조문으로 돌린 짝의 기존 조문은 원문에 없음으로 남기고, 폐지 결정은 승인 때로', () => {
    const articles = new Map([['a3', art('a3', 3, '옛 본문')], ['a5', art('a5', 5, '빠진 조')]]);
    const plan = planApply(
      [item('i1', 'changed', 'new', 'a3', parsed(0, 3, '전혀 다른 조')), item('i2', 'missing', 'repeal', 'a5', null)],
      articles,
      chapters,
      [],
    );
    expect(plan.newArticles).toHaveLength(1);
    expect(plan.released).toEqual([{ itemId: 'i1', articleId: 'a3' }]);
    expect(plan.repeals).toEqual([{ itemId: 'i2', articleId: 'a5' }]);
    expect(plan.drafts).toEqual([]);
  });

  it('묶음이 아닌 초안·검토 중 버전이 남은 조문은 반영하지 못한다(충돌) — 보류하면 빠진다', () => {
    const articles = new Map([['a3', art('a3', 3, '옛 본문', { pending: { versionId: 'd1', status: 'draft' } })]]);
    const plan = planApply([item('i1', 'changed', 'amend', 'a3', parsed(0, 3, '새 본문'))], articles, chapters, []);
    expect(plan.conflicts).toEqual([{ itemId: 'i1', articleId: 'a3', label: '제3조', status: 'draft' }]);
    expect(plan.drafts).toEqual([]);
    const held = planApply([item('i1', 'changed', 'hold', 'a3', parsed(0, 3, '새 본문'))], articles, chapters, []);
    expect(held.conflicts).toEqual([]);
    expect(held.untouched).toEqual([{ itemId: 'i1', why: 'hold' }]);
  });

  it('장 번호·제목이 바뀌면 그 장의 시행 중인 조문은 모두 계층만 바꾸는 초안을 받는다(그대로·보류·유지한 원문에 없음도, 폐지할 조문은 빼고)', () => {
    const articles = new Map([
      ['a1', art('a1', 1, '목적')],
      ['a2', art('a2', 2, '정의')],
      ['a3', art('a3', 3, '빠진 조')],
      ['a4', art('a4', 4, '폐지할 조')],
      ['a5', art('a5', 5, '초안만', { inForce: false, base: { versionId: 'd', status: 'draft', content: '초안만' } })],
    ]);
    const plan = planApply(
      [
        item('i1', 'same', null, 'a1', parsed(0, 1, '목적')),
        item('i2', 'changed', 'hold', 'a2', parsed(1, 2, '고친 정의')),
        item('i3', 'missing', null, 'a3', null),
        item('i4', 'missing', 'repeal', 'a4', null),
        item('i5', 'same', null, 'a5', parsed(2, 5, '초안만')),
      ],
      articles,
      chapters,
      [{ parsed: { index: 0, number: 2, title: '총칙', hidden: false }, storedId: 'c1', change: 'renumbered' }],
    );
    expect(plan.chapters.update).toEqual([{ id: 'c1', number: 2, title: '총칙', hidden: false }]);
    expect(plan.drafts.map((d) => [d.articleId, d.reason, d.itemId])).toEqual([
      ['a1', 'chapter', 'i1'],
      ['a2', 'chapter', 'i2'],
      ['a3', 'chapter', 'i3'],
    ]);
    expect(plan.untouched.map((u) => u.itemId)).toEqual(['i5']);
  });

  it('새 조문으로 돌린 짝의 기존 조문이 바뀌는 장에 있으면 그 초안은 그 조문의 원문에 없음 항목이 맡는다', () => {
    const articles = new Map([['a3', art('a3', 3, '옛 본문')]]);
    const plan = planApply(
      [item('i1', 'changed', 'new', 'a3', parsed(0, 3, '다른 조')), item('g1', 'missing', null, 'a3', null)],
      articles,
      chapters,
      [{ parsed: { index: 0, number: 2, title: '총칙', hidden: false }, storedId: 'c1', change: 'renumbered' }],
    );
    expect(plan.drafts).toEqual([expect.objectContaining({ articleId: 'a3', reason: 'chapter', itemId: 'g1' })]);
    expect(plan.released).toEqual([{ itemId: 'i1', articleId: 'a3' }]);
  });

  it('버전이 없는 조 머리 행(본문 없이 제목만)은 초안 없이 승인 때 행만 옮긴다', () => {
    const articles = new Map([['h2', art('h2', 2, '', { base: null, inForce: false })]]);
    const plan = planApply([item('i1', 'moved', 'accept', 'h2', parsed(0, 3, '', '정의'))], articles, chapters, []);
    expect(plan.drafts).toEqual([]);
    expect(plan.rowUpdates).toEqual([expect.objectContaining({ itemId: 'i1', articleId: 'h2', proposal: expect.objectContaining({ number: 3, title: '정의' }) })]);
  });

  it('절 — 대응된 절의 번호·제목이 바뀌면 고치고, 대응 없는 절은 승인 때 만들 계획으로', () => {
    const withSection = [{ ...C1, sections: [{ id: 's1', number: 1, title: '옛 절' }] }];
    const live = { ...snap(3, C1), section: { id: 's1', number: 1, title: '옛 절' } };
    const articles = new Map([['a3', art('a3', 3, '본문', { live })]]);
    const renamed = planApply(
      [item('i1', 'same', null, 'a3', { ...parsed(0, 3, '본문'), section: { index: 0, number: 1, title: '새 절 이름', storedId: 's1' } })],
      articles,
      withSection,
      [],
    );
    expect(renamed.sections.update).toEqual([{ id: 's1', number: 1, title: '새 절 이름' }]);
    expect(renamed.drafts).toEqual([expect.objectContaining({ articleId: 'a3', reason: 'chapter' })]);
    const created = planApply(
      [item('i1', 'new', 'new', null, { ...parsed(0, 4, '새 본문'), section: { index: 1, number: 2, title: '둘째 절', storedId: null } })],
      new Map(),
      withSection,
      [],
    );
    expect(created.sections.create).toEqual([{ key: 'c0s1', chapter: { id: 'c1', key: null }, number: 2, title: '둘째 절' }]);
  });

  it('폐지된 조문에 잇는 것은 본문·자리가 같아도 다시 시행하는 초안', () => {
    const articles = new Map([['a3', art('a3', 3, '같은 본문', { repealed: true, inForce: false, base: { versionId: 'v', status: 'archived', content: '같은 본문' } })]]);
    const plan = planApply([item('i1', 'ambiguous', 'pick', null, parsed(0, 3, '같은 본문'), 'a3')], articles, chapters, []);
    expect(plan.drafts).toEqual([expect.objectContaining({ articleId: 'a3', reason: 'amend' })]);
  });

  it('제안 계층 — 같으면 없음, 다른 장·새 절·번호·제목이면 있음', () => {
    expect(proposalFor(parsed(0, 3, 'x', '제목3'), snap(3, C1))).toBeNull();
    expect(proposalFor(parsed(0, 3, 'x', '바뀐 제목'), snap(3, C1))).toMatchObject({ title: '바뀐 제목' });
    expect(proposalFor({ ...parsed(0, 3, 'x', '제목3'), section: { index: 0, number: 1, title: '새 절', storedId: null } }, snap(3, C1))).toMatchObject({
      section: { id: null, key: 'c0s0' },
    });
  });
});

describe('findBoundaryConflicts — 승인 시행일부터 모든 경계에서 자리 겹침 (T-110 ②)', () => {
  const pos = (number: number) => ({ number, branchNumber: null, clauseNumber: null, itemNumber: null });
  const a = (id: string, _before: number, after: number, versions: BoundaryArticle['versions'], extra: Partial<BoundaryArticle> = {}): BoundaryArticle => ({
    id,
    label: id,
    after: pos(after),
    versions,
    ...extra,
  });

  it('옛 제5조가 제6조로, 새 제5조가 같은 날 — 겹치지 않는다', () => {
    const conflicts = findBoundaryConflicts(
      [
        a('old5', 5, 6, [{ versionNum: 1, effectiveDate: '2024-01-01', repealedOn: null, frozen: null }, { versionNum: 2, effectiveDate: '2026-11-01', repealedOn: null, frozen: null, bundle: true }]),
        a('new5', 5, 5, [{ versionNum: 1, effectiveDate: '2026-11-01', repealedOn: null, frozen: null, bundle: true }]),
      ],
      '2026-11-01',
    );
    expect(conflicts).toEqual([]);
  });

  it('유지로 둔 원문에 없는 조문의 자리에 새 조문이 오면 겹친다', () => {
    const conflicts = findBoundaryConflicts(
      [
        a('kept5', 5, 5, [{ versionNum: 1, effectiveDate: '2024-01-01', repealedOn: null, frozen: null }]),
        a('new5', 5, 5, [{ versionNum: 1, effectiveDate: '2026-11-01', repealedOn: null, frozen: null, bundle: true }]),
      ],
      '2026-11-01',
    );
    expect(conflicts).toEqual([{ date: '2026-11-01', position: '5|0|0|0', labels: ['kept5', 'new5'] }]);
  });

  it('이번 승인에서 그 날로 폐지하면 겹치지 않는다', () => {
    const conflicts = findBoundaryConflicts(
      [
        a('gone5', 5, 5, [{ versionNum: 1, effectiveDate: '2024-01-01', repealedOn: null, frozen: null }], { repealAt: '2026-10-01' }),
        a('new5', 5, 5, [{ versionNum: 1, effectiveDate: '2026-10-01', repealedOn: null, frozen: null, bundle: true }]),
      ],
      '2026-10-01',
    );
    expect(conflicts).toEqual([]);
  });

  it('시행일 뒤의 다른 시행 예정 버전(얼린 계층)도 경계로 본다', () => {
    const conflicts = findBoundaryConflicts(
      [
        a('x', 3, 3, [
          { versionNum: 1, effectiveDate: '2024-01-01', repealedOn: null, frozen: pos(3) },
          { versionNum: 2, effectiveDate: '2026-12-01', repealedOn: null, frozen: pos(7) },
        ]),
        a('y', 6, 7, [
          { versionNum: 1, effectiveDate: '2024-01-01', repealedOn: null, frozen: null },
          { versionNum: 2, effectiveDate: '2026-11-01', repealedOn: null, frozen: null, bundle: true },
        ]),
      ],
      '2026-11-01',
    );
    expect(conflicts).toEqual([{ date: '2026-12-01', position: '7|0|0|0', labels: ['x', 'y'] }]);
  });

  it('같은 날 시행분이 둘이면 나중 버전(묶음)이 이긴다', () => {
    const conflicts = findBoundaryConflicts(
      [
        a('x', 5, 6, [
          { versionNum: 1, effectiveDate: '2026-11-01', repealedOn: null, frozen: pos(5) },
          { versionNum: 2, effectiveDate: '2026-11-01', repealedOn: null, frozen: null, bundle: true },
        ]),
        a('new5', 5, 5, [{ versionNum: 1, effectiveDate: '2026-11-01', repealedOn: null, frozen: null, bundle: true }]),
      ],
      '2026-11-01',
    );
    expect(conflicts).toEqual([]);
  });

  it('승인 시행일부터만 본다 — 옮긴 조문의 옛 자리에 있던 조문이 그날 폐지되면 겹치지 않는다', () => {
    const conflicts = findBoundaryConflicts(
      [
        a('moved', 5, 6, [
          { versionNum: 1, effectiveDate: '2024-01-01', repealedOn: null, frozen: null },
          { versionNum: 2, effectiveDate: '2026-11-01', repealedOn: null, frozen: null, bundle: true },
        ]),
        a('other6', 6, 6, [{ versionNum: 1, effectiveDate: '2024-01-01', repealedOn: '2026-11-01', frozen: null }]),
      ],
      '2026-11-01',
    );
    expect(conflicts).toEqual([]);
  });
});

describe('structureHash — 저장 전후 키 순서가 달라도 같은 지문', () => {
  it('jsonb 처럼 키 순서가 바뀌어도 같고, 값이 다르면 다르다', async () => {
    const { structureHash, canonicalJson } = await import('../apps/api/src/common/article-structure');
    expect(structureHash({ b: 1, a: { d: [1, { y: 2, x: 1 }], c: null } })).toBe(structureHash({ a: { c: null, d: [1, { x: 1, y: 2 }] }, b: 1 }));
    expect(structureHash({ a: 1 })).not.toBe(structureHash({ a: 2 }));
    expect(structureHash(null)).toBe('');
    expect(canonicalJson({ b: undefined, a: 1 })).toBe('{"a":1}');
  });
});
