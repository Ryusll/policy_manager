import { describe, it, expect } from 'vitest';
import { buildLawContext, type LinkedLawArticle } from '../apps/api/src/ask/ask-law-context';
import type { InForceArticle } from '../apps/api/src/laws/law-in-force';

/**
 * T-209 규정 질문의 법령 근거 — 확정 연결의 오늘 시행 중 문구를 L 번호와 함께 준다(SRS SEARCH-4).
 * DB 조회(확정 연결만·회사 경계)는 통합 시험이 본다. 여기서는 글 만들기 규칙만.
 */

const art = (nodeKey: string, label: string, content: string | null, over: Partial<InForceArticle> = {}): InForceArticle => ({
  id: `id-${nodeKey}`,
  nodeKey,
  articleNo: Number(nodeKey.split('/')[0]),
  clauseNo: null,
  itemNo: null,
  label,
  title: null,
  content,
  sortOrder: 0,
  effectiveNotes: null,
  scheduled: null,
  ...over,
});

const privacy: InForceArticle[] = [
  art('29//', '제29조', '', { title: '안전조치의무' }),
  art('29/1/', '제29조제1항', '① 개인정보처리자는 안전성 확보에 필요한 조치를 하여야 한다.'),
  art('29/2/', '제29조제2항', '② 조치의 세부 기준은 대통령령으로 정한다.', {
    scheduled: { eventId: 'e', changeType: 'modified', content: '…', effectiveDate: '2027-03-01', versionId: null, laterCount: 0, orderMismatch: false },
  }),
  art('30//', '제30조', '개인정보 처리방침을 정하여야 한다.', { title: '개인정보 처리방침' }),
  art('34//', '제34조의2', null, { title: '신설 예정' }),
];
const inForce = new Map([['law-p', privacy]]);
const link = (nodeKey: string, lawId = 'law-p', lawName = '개인정보 보호법'): LinkedLawArticle => ({
  lawId,
  lawName,
  lawArticleId: `x-${nodeKey}`,
  nodeKey,
});

describe('법령 근거 글 (T-209)', () => {
  it('조 머리에 걸린 연결은 본문이 비어도 아래 항까지 붙여 준다 — L 번호와 시행 예정 개정 날짜 (T-209)', () => {
    const out = buildLawContext([link('29//')], inForce);
    expect(out.refs).toHaveLength(1);
    expect(out.refs[0]).toMatchObject({ ref: 'L1', lawId: 'law-p', lawName: '개인정보 보호법', label: '제29조', title: '안전조치의무', scheduledOn: '2027-03-01' });
    expect(out.refs[0].content).toContain('안전성 확보');
    expect(out.refs[0].content).toContain('대통령령');
    expect(out.text).toBe(
      '<법령 이름="개인정보 보호법">\n[L1] 제29조(안전조치의무) ① 개인정보처리자는 안전성 확보에 필요한 조치를 하여야 한다. ② 조치의 세부 기준은 대통령령으로 정한다. (2027-03-01 시행 예정 개정이 있다)\n</법령>',
    );
  });

  it('오늘 시행 중 문구가 없는 조항(시행일에 신설)과 현행 목록에 없는 조항은 뺀다 (T-209)', () => {
    const out = buildLawContext([link('34//'), link('99//'), link('30//')], inForce);
    expect(out.refs.map((r) => r.label)).toEqual(['제30조']);
    expect(out.refs[0].ref).toBe('L1');
  });

  it('같은 조항이 여러 조문에 걸려 있어도 한 번만 준다 (T-209)', () => {
    expect(buildLawContext([link('30//'), link('30//')], inForce).refs).toHaveLength(1);
  });

  it('조문 하나·전체 길이 상한 — 넘치면 뒤쪽을 빼고 첫 조문은 늘 넣는다 (T-209)', () => {
    const long = new Map([['law-p', [art('1//', '제1조', '가'.repeat(5000)), art('2//', '제2조', '나'.repeat(100))]]]);
    const out = buildLawContext([link('1//'), link('2//')], long, 300, 200);
    expect(out.refs).toHaveLength(1);
    expect(out.refs[0].content.length).toBeLessThanOrEqual(200);
    expect(out.refs[0].content.endsWith('…')).toBe(true);
  });

  it('법령별로 묶되 참조 번호는 고른 순서 그대로 (T-209)', () => {
    const labor = [art('60//', '제60조', '연차 유급휴가를 주어야 한다.', { title: '연차 유급휴가' })];
    const both = new Map([...inForce, ['law-l', labor]]);
    const out = buildLawContext([link('30//'), link('60//', 'law-l', '근로기준법')], both);
    expect(out.refs.map((r) => `${r.ref}:${r.lawName}`)).toEqual(['L1:개인정보 보호법', 'L2:근로기준법']);
    expect(out.text).toContain('<법령 이름="근로기준법">\n[L2] 제60조(연차 유급휴가)');
  });

  it('연결이 없으면 빈 글 (T-209)', () => {
    expect(buildLawContext([], inForce)).toEqual({ text: '', refs: [] });
  });
});
