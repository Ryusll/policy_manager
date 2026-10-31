import { describe, it, expect } from 'vitest';
import {
  adjustParticle,
  generateRuleCandidate,
  RULESET_VERSION,
  type RuleEngineInput,
} from '../apps/api/src/amendments/amendment-rules';

const LAW_15 = '사용자는 근로자에게 15일의 유급휴가를 주어야 한다. <개정 2012.2.1>';
const LAW_20 = '사용자는 근로자에게 20일의 유급휴가를 주어야 한다. <개정 2012.2.1, 2027.1.1>';

const run = (over: Partial<RuleEngineInput>) =>
  generateRuleCandidate({
    lawBefore: LAW_15,
    lawAfter: LAW_20,
    baseContent: '',
    relationType: 'delegation',
    scope: null,
    evidenceText: null,
    ...over,
  });

describe('generateRuleCandidate — 기준값 규칙 (특허 도 10 단계 1021·1022)', () => {
  it('우리 조문의 같은 값을 새 값으로 — 문장 구조는 그대로', () => {
    const r = run({ baseContent: '직원에게는 매년 15일의 연차휴가를 준다.' });
    expect(r.substantive).toBe(true);
    expect(r.content).toBe('직원에게는 매년 20일의 연차휴가를 준다.');
    expect(r.applications).toHaveLength(1);
    expect(r.applications[0]).toMatchObject({
      ruleId: 'VALUE_CHANGE',
      ruleVersion: 1,
      templateId: 'INLINE_REPLACE',
      templateVersion: 1,
      base: { text: '15일' },
      candidate: { text: '20일' },
    });
    expect(r.flags).toEqual([]);
    expect(r.confidence).toMatchObject({ level: 'high', coverage: { applied: 1, total: 1, targetUnclear: false } });
    expect(r.diff.unexplained).toBe(0);
    expect(r.diff.parts.filter((p) => p.op !== 'equal')).toEqual([
      { op: 'delete', text: '15' },
      { op: 'insert', text: '20' },
    ]);
  });

  it('같은 값이 여러 곳이고 근거 문구로 좁힐 수 없으면 고치지 않는다', () => {
    const base = '연차휴가는 15일로 한다. 급여는 매월 15일에 지급한다.';
    const r = run({ baseContent: base });
    expect(r.content).toBe(base);
    expect(r.flags).toEqual(expect.arrayContaining(['ambiguous_match', 'unmapped_law_change', 'manual_draft_required']));
    expect(r.unmapped[0]).toMatchObject({ reason: 'ambiguous' });
    expect(r.confidence.level).toBe('low');
  });

  it('근거 문구가 가리키는 문장 안의 하나로 좁혀지면 그것만 고친다', () => {
    const base = '연차휴가는 15일로 한다. 급여는 매월 15일에 지급한다.';
    const r = run({ baseContent: base, evidenceText: '연차휴가는 15일로 한다' });
    expect(r.content).toBe('연차휴가는 20일로 한다. 급여는 매월 15일에 지급한다.');
    expect(r.confidence.level).toBe('high');
  });

  it('근거 문장 안에도 같은 값이 둘이면 고치지 않는다', () => {
    const base = '휴가는 15일로 하되 15일을 넘겨 쓸 수 없다.';
    const r = run({ baseContent: base, evidenceText: base });
    expect(r.content).toBe(base);
    expect(r.unmapped[0].reason).toBe('ambiguous');
  });

  it('우리 조문에 대응 문구가 없으면 본문은 그대로 — 사람이 직접 고쳐야 한다', () => {
    const base = '연차휴가는 근로기준법에 따른다.';
    const r = run({ baseContent: base });
    expect(r.content).toBe(base);
    expect(r.applications).toEqual([]);
    expect(r.unmapped).toEqual([{ lawChangeIndex: 0, reason: 'no_correspondence', detail: undefined }]);
    expect(r.flags).toEqual(expect.arrayContaining(['manual_draft_required', 'unmapped_law_change']));
    expect(r.confidence).toMatchObject({ level: 'low', reasons: ['none_applied'] });
  });

  it('숫자 경계 — "15일"이 "115일"·"1.15일"에 걸리지 않는다', () => {
    const base = '보관 기간은 115일이다.';
    expect(run({ baseContent: base }).content).toBe(base);
  });
});

describe('generateRuleCandidate — 용어 규칙과 조사', () => {
  const TERM_BEFORE = '사업주는 근로자에게 알려야 한다.';
  const TERM_AFTER = '사업주는 노동자에게 알려야 한다.';

  it('조사가 받침과 무관하면 낱말만 바꾼다', () => {
    const r = run({ lawBefore: TERM_BEFORE, lawAfter: TERM_AFTER, baseContent: '회사는 근로자에게 매년 교육한다.' });
    expect(r.content).toBe('회사는 노동자에게 매년 교육한다.');
    expect(r.applications[0]).toMatchObject({ ruleId: 'TERM_CHANGE', base: { text: '근로자' } });
  });

  it('받침이 달라지면 우리 조문의 뒤 조사를 맞춘다(법은 "사업주에게", 우리는 "사업주는"·"사업주를")', () => {
    const r = run({
      lawBefore: '사업주에게 신고하여야 한다.',
      lawAfter: '사용인에게 신고하여야 한다.',
      baseContent: '사업주는 매년 교육을 한다.',
    });
    expect(r.content).toBe('사용인은 매년 교육을 한다.');
    expect(r.applications[0].base.text).toBe('사업주는');
    expect(r.applications[0].candidate.text).toBe('사용인은');
    expect(
      run({ lawBefore: '사업주에게 신고한다.', lawAfter: '사용인에게 신고한다.', baseContent: '회사는 사업주를 둔다.' }).content,
    ).toBe('회사는 사용인을 둔다.');
  });

  it('법령 쪽 조사가 받침 때문에 바뀌어도 낱말만 비교한다("사업주는"→"사용인은")', () => {
    const r = run({
      lawBefore: '사업주는 신고하여야 한다.',
      lawAfter: '사용인은 신고하여야 한다.',
      baseContent: '사업주가 정한다.',
    });
    expect(r.content).toBe('사용인이 정한다.');
  });

  it('복수 "들" 뒤의 조사는 그대로 둔다', () => {
    const r = run({ lawBefore: TERM_BEFORE, lawAfter: TERM_AFTER, baseContent: '회사는 근로자들에게 알린다.' });
    expect(r.content).toBe('회사는 노동자들에게 알린다.');
  });

  it('합성어("근로자대표")는 문맥을 확인할 수 없어 고치지 않는다', () => {
    const base = '근로자대표와 협의한다.';
    const r = run({ lawBefore: TERM_BEFORE, lawAfter: TERM_AFTER, baseContent: base });
    expect(r.content).toBe(base);
    expect(r.flags).toContain('context_unclear');
    expect(r.unmapped[0].reason).toBe('context_unclear');
  });

  it('다른 낱말 안에 든 용어("비근로자")는 대응 문구가 아니다', () => {
    const base = '비근로자는 제외한다.';
    expect(run({ lawBefore: TERM_BEFORE, lawAfter: TERM_AFTER, baseContent: base }).unmapped[0].reason).toBe(
      'no_correspondence',
    );
  });

  it('같은 용어 변경이 법 조항에 두 번 나오면 한 번 적용하고 근거는 둘 다 잇는다', () => {
    const r = run({
      lawBefore: '근로자는 근로자의 권리를 가진다.',
      lawAfter: '노동자는 노동자의 권리를 가진다.',
      baseContent: '모든 근로자에게 적용한다.',
    });
    expect(r.applications).toHaveLength(1);
    expect(r.applications[0].lawChangeIndexes).toEqual([0, 1]);
    expect(r.confidence.coverage).toMatchObject({ applied: 2, total: 2 });
  });
});

describe('adjustParticle — 받침에 따라 갈리는 조사', () => {
  it('받침 유무·ㄹ 받침', () => {
    expect(adjustParticle('법인', '는')).toBe('은');
    expect(adjustParticle('회사', '을')).toBe('를');
    expect(adjustParticle('회사', '과')).toBe('와');
    expect(adjustParticle('부산', '로')).toBe('으로');
    expect(adjustParticle('서울', '으로')).toBe('로');
    expect(adjustParticle('회사', '으로서')).toBe('로서');
  });

  it('받침과 무관한 조사는 그대로, 영문으로 끝나면 판단하지 않는다', () => {
    expect(adjustParticle('법인', '에게')).toBe('에게');
    expect(adjustParticle('법인', '')).toBe('');
    expect(adjustParticle('ABC', '는')).toBeNull();
  });
});

describe('generateRuleCandidate — 인용 문장 규칙', () => {
  it('법 문장을 그대로 옮겨 적었으면 그 문장을 새 문장으로 바꾼다', () => {
    const base = '회사는 다음 법 규정을 따른다. 사용자는 근로자에게 휴가를 주어야 한다.';
    const r = run({
      relationType: 'citation',
      lawBefore: '사용자는 근로자에게 휴가를 주어야 한다.',
      lawAfter: '사용자는 근로자의 청구에 따라 휴가를 주어야 한다.',
      baseContent: base,
    });
    expect(r.content).toBe('회사는 다음 법 규정을 따른다. 사용자는 근로자의 청구에 따라 휴가를 주어야 한다.');
    expect(r.applications).toHaveLength(1);
    expect(r.applications[0]).toMatchObject({ ruleId: 'QUOTED_SENTENCE', templateId: 'SENTENCE_REPLACE' });
    expect(r.confidence.level).toBe('high');
  });

  it('문장 안의 기준값 변경도 인용 문장 교체 하나로 반영된다(충돌로 보지 않는다)', () => {
    const r = run({
      relationType: 'citation',
      baseContent: '사용자는 근로자에게 15일의 유급휴가를 주어야 한다.',
    });
    expect(r.content).toBe('사용자는 근로자에게 20일의 유급휴가를 주어야 한다.');
    expect(r.applications).toHaveLength(1);
    expect(r.flags).toEqual([]);
  });

  it('"삭제"로 바뀐 조항은 인용 문장이라도 "삭제"로 바꾸지 않는다', () => {
    const base = '사용자는 근로자에게 15일의 유급휴가를 주어야 한다.';
    const r = run({ lawAfter: '삭제 <2027.1.1>', baseContent: base, relationType: 'citation' });
    expect(r.content).toBe(base);
    expect(r.flags).toEqual(expect.arrayContaining(['law_provision_repealed', 'manual_draft_required']));
    expect(r.unmapped.every((u) => u.reason === 'repealed')).toBe(true);
  });
});

describe('generateRuleCandidate — 사람에게 넘기는 경우', () => {
  const base = '직원에게는 매년 15일의 연차휴가를 준다.';

  it('참고 관계는 자동으로 고치지 않는다', () => {
    const r = run({ baseContent: base, relationType: 'reference' });
    expect(r.content).toBe(base);
    expect(r.flags).toEqual(expect.arrayContaining(['relation_review_only', 'manual_draft_required']));
    expect(r.confidence.coverage.targetUnclear).toBe(true);
    expect(r.confidence.level).toBe('low');
  });

  it('적용 범위가 적힌 연결은 자동으로 고치지 않는다', () => {
    const r = run({ baseContent: base, scope: '정규직에 한함' });
    expect(r.content).toBe(base);
    expect(r.flags).toContain('scope_review');
    expect(r.unmapped[0]).toMatchObject({ reason: 'scope_review', detail: '정규직에 한함' });
  });

  it('법 문장 추가는 본문에 덧붙이지 않고 반영하지 못한 변경으로 남긴다', () => {
    const r = run({
      lawBefore: '휴가를 주어야 한다.',
      lawAfter: '휴가를 주어야 한다. 다만, 근로자가 원하면 그러하지 아니하다.',
      baseContent: '휴가를 준다.',
    });
    expect(r.content).toBe('휴가를 준다.');
    expect(r.unmapped[0].reason).toBe('unsupported');
    expect(r.flags).toContain('manual_draft_required');
  });

  it('규칙끼리 같은 자리에 다른 문구를 내면 그 자리는 고치지 않고 두 제안을 모두 남긴다', () => {
    const r = run({
      lawBefore: '갑은 15일, 을은 15일 이내에 신고한다.',
      lawAfter: '갑은 20일, 을은 30일 이내에 신고한다.',
      baseContent: '신고는 15일 이내에 한다.',
    });
    expect(r.content).toBe('신고는 15일 이내에 한다.');
    expect(r.flags).toContain('rule_conflict');
    expect(r.conflicts).toHaveLength(1);
    expect(r.conflicts[0].proposals.map((p) => p.replacement).sort()).toEqual(['20일', '30일']);
    expect(r.unmapped.map((u) => u.reason)).toEqual(['conflict', 'conflict']);
  });

  it('연혁 표기만 바뀌면 실질 변경이 아니다 — 후보를 만들지 않는다', () => {
    const r = run({ lawAfter: '사용자는 근로자에게 15일의 유급휴가를 주어야 한다. <개정 2027.1.1>', baseContent: base });
    expect(r.substantive).toBe(false);
    expect(r.content).toBe(base);
  });

  it('일부만 반영되면 보통 — 반영률을 따로 남긴다', () => {
    const r = run({
      lawBefore: '15일의 휴가를 주고 3개월마다 교육한다.',
      lawAfter: '20일의 휴가를 주고 6개월마다 교육한다.',
      baseContent: '직원에게 15일의 휴가를 준다.',
    });
    expect(r.content).toBe('직원에게 20일의 휴가를 준다.');
    expect(r.confidence).toMatchObject({ level: 'medium', reasons: ['partially_applied'], coverage: { applied: 1, total: 2 } });
  });

  it('규칙 세트 버전이 정해져 있다', () => {
    expect(RULESET_VERSION).toBe('rule/2');
  });
});

describe('generateRuleCandidate — 변수 값 넣기 (T-109 ②, 특허 도 9)', () => {
  const BASE = '직원에게는 매년 15일의 연차휴가를 주고, 운영팀이 관리한다.';
  const at = BASE.indexOf('운영팀');

  it('법령 고침과 떨어진 자리는 함께 넣고, 변수 근거는 법령 근거와 따로 잇는다', () => {
    const r = run({ baseContent: BASE, variables: [{ ref: 0, start: at, end: at + 3, replacement: '관리팀' }] });
    expect(r.content).toBe('직원에게는 매년 20일의 연차휴가를 주고, 관리팀이 관리한다.');
    expect(r.applications).toHaveLength(1);
    expect(r.variableApplications).toEqual([
      { ref: 0, base: { start: at, end: at + 3, text: '운영팀' }, candidate: { start: at, end: at + 3, text: '관리팀' } },
    ]);
    expect(r.variableConflicts).toEqual([]);
    const varChange = r.diff.changes.find((c) => c.candidate.text === '관리팀')!;
    expect(varChange).toMatchObject({ rationaleRefs: [], variableRefs: [0] });
    const lawChange = r.diff.changes.find((c) => c.candidate.text === '20')!;
    expect(lawChange).toMatchObject({ rationaleRefs: [0], variableRefs: [] });
    expect(r.diff.unexplained).toBe(0);
    expect(r.flags).toEqual([]);
  });

  it('법령 고침과 같은 자리면 원문을 두고 양쪽 제안을 남긴다 — 법령 변경은 반영하지 못한 변경(충돌)', () => {
    const base = '직원에게는 매년 15일의 연차휴가를 준다.';
    const s = base.indexOf('15일');
    const r = run({ baseContent: base, variables: [{ ref: 0, start: s, end: s + 3, replacement: '18일' }] });
    expect(r.content).toBe(base);
    expect(r.variableApplications).toEqual([]);
    expect(r.variableConflicts).toEqual([0]);
    expect(r.flags).toEqual(expect.arrayContaining(['variable_conflict', 'unmapped_law_change', 'manual_draft_required']));
    expect(r.unmapped).toEqual([expect.objectContaining({ reason: 'conflict' })]);
    expect(r.conflicts).toEqual([
      expect.objectContaining({
        base: expect.objectContaining({ text: '15일' }),
        proposals: expect.arrayContaining([
          expect.objectContaining({ ruleId: 'VALUE_CHANGE' }),
          expect.objectContaining({ ruleId: 'variable_value', replacement: '18일', variableRef: 0 }),
        ]),
      }),
    ]);
    expect(r.confidence.level).toBe('low');
  });

  it('법령을 자동으로 고치지 않는 연결(참고)이어도 변수 값은 넣는다', () => {
    const r = run({ baseContent: BASE, relationType: 'reference', variables: [{ ref: 0, start: at, end: at + 3, replacement: '관리팀' }] });
    expect(r.content).toBe('직원에게는 매년 15일의 연차휴가를 주고, 관리팀이 관리한다.');
    expect(r.flags).toEqual(expect.arrayContaining(['relation_review_only']));
    expect(r.diff.unexplained).toBe(0);
  });
});
