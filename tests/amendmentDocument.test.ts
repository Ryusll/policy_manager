import { describe, it, expect } from 'vitest';
import {
  buildAmendmentDocument,
  koreanDate,
  markedSide,
  objectParticle,
  reasonSentence,
  type DocCandidate,
} from '../apps/api/src/amendments/amendment-document';

const cand = (o: Partial<DocCandidate> & { number: number }): DocCandidate => ({
  id: `c${o.number}`,
  reviewState: 'review',
  revision: 1,
  baseContent: '근로자는 난임치료를 받기 위하여 연간 2일의 유급휴가를 쓸 수 있다.',
  candidateContent: '근로자는 난임치료를 받기 위하여 연간 4일의 유급휴가를 쓸 수 있다.',
  plannedEffectiveDate: '2026-11-27',
  approvedNote: null,
  ...o,
  article: { number: o.number, branchNumber: null, clauseNumber: null, itemNumber: null, title: '난임치료휴가', ...(o.article ?? {}) },
  law: {
    eventId: 'e1',
    lawName: '남녀고용평등과 일·가정 양립 지원에 관한 법률',
    label: '제18조의3제1항',
    changeType: 'modified',
    promulgatedDate: '2026-05-26',
    lawEffectiveDate: '2026-11-27',
    lawType: '법률',
    promulgationNo: '21700',
    beforeContent: '사업주는 연간 3일 이내의 휴가를 주어야 한다.',
    afterContent: '사업주는 연간 6일 이내의 휴가를 주어야 한다.',
    ...(o.law ?? {}),
  },
});

const doc = (candidates: DocCandidate[]) =>
  buildAmendmentDocument({ policy: { code: 'HR-01', title: '취업규칙' }, candidates, today: '2026-10-30' });

describe('개정안 문서 조립 (T-162)', () => {
  it('바뀐 곳은 밑줄 — 현행 칸은 없어지는 글자, 개정안 칸은 새 글자만(화면과 같은 비교 단위)', () => {
    const html = doc([cand({ number: 12 })]).html;
    const row = html.slice(html.indexOf('<tbody><tr><td>'));
    const [cur, next] = row.split('</td><td>');
    expect(cur).toContain('<u>2</u>일');
    expect(cur).not.toContain('4일');
    expect(next).toContain('<u>4</u>일');
    expect(next).not.toContain('2일');
    // 화면의 취소선 태그를 쓰지 않는다 — PDF sanitizer 가 del 을 지워 글자가 섞인다
    expect(html).not.toMatch(/<(del|ins|s)>/);
  });

  it('신구조문대비표는 현행·개정안·비고 세 칸이고 조문 차례(조 → 가지 → 항)로 놓는다', () => {
    const html = doc([
      cand({ id: 'b', number: 12, article: { number: 12, branchNumber: 2, clauseNumber: null, itemNumber: null, title: null } }),
      cand({ id: 'c', number: 3 }),
      cand({ id: 'a', number: 12 }),
    ]).html;
    expect(html).toContain('<th class="amend-text">현행</th><th class="amend-text">개정안</th><th class="amend-note">비고</th>');
    const order = ['제3조(난임치료휴가)', '제12조(난임치료휴가)', '제12조의2'].map((l) => html.indexOf(`<b>${l}`));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((x, y) => x - y)).toEqual(order);
  });

  it('비고에 법령 근거·법령 시행일·사내 시행 예정일·상태와 판을 적는다', () => {
    const html = doc([cand({ number: 12, revision: 3 })]).html;
    const note = html.slice(html.indexOf('<td class="amend-note">'));
    expect(note).toContain('제18조의3제1항 개정');
    expect(note).toContain('법령 시행 2026. 11. 27.');
    expect(note).toContain('사내 시행 예정 2026. 11. 27.');
    expect(note).toContain('검토 중 (3판)');
  });

  it('개정 이유는 사실만 — 법령명·공포번호·공포일·시행일과 바꾸는 조문, 판단 문구 없음 (LAW-21)', () => {
    const s = reasonSentence(cand({ number: 12 }));
    expect(s).toBe(
      '「남녀고용평등과 일·가정 양립 지원에 관한 법률」 제18조의3제1항 개정(법률 제21700호, 2026. 5. 26. 공포, 2026. 11. 27. 시행)에 따라 제12조를 바꿈',
    );
    expect(s).not.toMatch(/필요|해야/);
    expect(reasonSentence(cand({ number: 3, article: { number: 3, branchNumber: null, clauseNumber: 2, itemNumber: null, title: null } }))).toContain('제3조제2항을 바꿈');
    expect(reasonSentence(cand({ number: 5, candidateContent: '' }))).toMatch(/제5조를 삭제함$/);
    // 공포번호가 없는 판(T-151 전 기록)은 날짜만
    expect(reasonSentence(cand({ number: 1, law: { promulgationNo: null } as DocCandidate['law'] }))).toContain('개정(2026. 5. 26. 공포, 2026. 11. 27. 시행)');
  });

  it('승인 사유가 있으면 개정 이유 밑에 붙인다', () => {
    const html = doc([cand({ number: 12, reviewState: 'approved', approvedNote: '법 개정 반영' })]).html;
    expect(html).toContain('승인 사유: 법 개정 반영');
  });

  it('법령 근거는 변경 이벤트마다 한 번 — 변경 전·후 문구를 밑줄로', () => {
    const html = doc([cand({ number: 12 }), cand({ id: 'x', number: 13 })]).html;
    const basis = html.slice(html.indexOf('3. 법령 근거'));
    expect(basis.match(/<h3>/g)).toHaveLength(1);
    expect(basis).toContain('<u>3</u>일');
    expect(basis).toContain('<u>6</u>일');
  });

  it('본문의 HTML 은 글자로 — 태그를 심어도 표가 깨지지 않는다', () => {
    const d = doc([cand({ number: 1, candidateContent: '<script>x</script> & <b>굵게</b>' })]);
    expect(d.html).not.toContain('<script>');
    expect(d.html).toContain('&lt;script&gt;');
    const t = buildAmendmentDocument({ policy: { code: 'A&B', title: '<규정>' }, candidates: [cand({ number: 1 })], today: '2026-10-30' });
    expect(t.title).toBe('&lt;규정&gt; 개정안');
    expect(t.metaLine).toContain('A&amp;B');
  });

  it('조문 전체 삭제는 개정안 칸에 <삭 제>, 줄바꿈은 그대로', () => {
    const html = doc([cand({ number: 7, baseContent: '첫 줄\n둘째 줄', candidateContent: '' })]).html;
    expect(html).toContain('&lt;삭 제&gt;');
    expect(html).toContain('첫 줄<br>둘째 줄');
  });

  it('머리말에 상태별 건수, 꼬리말은 승인 안 된 조문이 있을 때만 확정이 아니라고 적는다', () => {
    const mixed = doc([cand({ number: 1, reviewState: 'approved' }), cand({ id: 'd', number: 2, reviewState: 'draft' })]);
    expect(mixed.metaLine).toBe('규정 코드 HR-01 · 작성일 2026. 10. 30. · 개정 조문 2개 (승인 1 · 작성 중 1)');
    expect(mixed.footerText).toContain('승인되지 않은 조문 1개');
    const settled = doc([cand({ number: 1, reviewState: 'approved' })]);
    expect(settled.footerText).not.toContain('승인되지 않은');
  });

  it('목적격 조사는 읽는 소리로 — 조는 를, 항·목은 을, 가지번호는 끝 숫자 소리 (T-162)', () => {
    expect(objectParticle('제3조')).toBe('를');
    expect(objectParticle('제3조제2항')).toBe('을');
    expect(objectParticle('제3조제2항제1목')).toBe('을');
    expect(objectParticle('제3조의2')).toBe('를'); // 이
    expect(objectParticle('제3조의3')).toBe('을'); // 삼
    expect(objectParticle('제3조의4')).toBe('를'); // 사
    expect(objectParticle('제3조의6')).toBe('을'); // 육
    expect(objectParticle('제3조의10')).toBe('을'); // 십
    expect(objectParticle('제3조의12')).toBe('를'); // 십이
    expect(reasonSentence(cand({ number: 3, article: { number: 3, branchNumber: 3, clauseNumber: null, itemNumber: null, title: null } }))).toContain('제3조의3을 바꿈');
  });

  it('승인으로 발행된 후보는 비고에 계획이 아니라 실제 사내 시행일 (T-162)', () => {
    const html = doc([cand({ number: 12, reviewState: 'approved', issuedEffectiveDate: '2026-12-01' })]).html;
    const note = html.slice(html.indexOf('<td class="amend-note">'));
    expect(note).toContain('사내 시행 2026. 12. 1.');
    expect(note).not.toContain('사내 시행 예정');
    expect(note).toContain('승인 (1판)');
  });

  it('도우미 — 날짜 표기와 밑줄 칸', () => {
    expect(koreanDate('2026-05-06')).toBe('2026. 5. 6.');
    expect(koreanDate(null)).toBe('');
    expect(markedSide([{ op: 'equal', text: 'a ' }, { op: 'insert', text: ' ' }, { op: 'insert', text: 'b' }], 'insert')).toBe('a  <u>b</u>');
  });
});
