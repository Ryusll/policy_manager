import { describe, it, expect } from 'vitest';
import { claimOf, undecidedCount, validateDecisions, type DecisionItem } from '../apps/api/src/regulation-parse/reparse-decisions';

const item = (id: string, kind: string, extra: Partial<DecisionItem> = {}): DecisionItem => ({
  id,
  kind,
  articleId: null,
  candidates: [],
  decision: null,
  targetArticleId: null,
  label: id,
  ...extra,
});

describe('validateDecisions — 재파싱 검토 결정 규칙 (T-110, 도 6 S640~S641)', () => {
  const base = [
    item('same', 'same', { articleId: 'a1' }),
    item('moved', 'moved', { articleId: 'a2', decision: 'accept' }),
    item('changed', 'changed', { articleId: 'a3' }),
    item('amb', 'ambiguous', { candidates: ['a4', 'a5'] }),
    item('new', 'new', { decision: 'new' }),
    item('gone4', 'missing', { articleId: 'a4' }),
    item('gone5', 'missing', { articleId: 'a5' }),
    item('gone6', 'missing', { articleId: 'a6' }),
  ];
  const withChange = (id: string, patch: Partial<DecisionItem>) => base.map((i) => (i.id === id ? { ...i, ...patch } : i));

  it('기본 상태는 맞다 — 남은 결정은 옮김·개정·판정 보류·새 조문만 센다(원문에 없음은 미결로 남을 수 있다)', () => {
    expect(validateDecisions(base, 'editor')).toEqual([]);
    expect(undecidedCount(base)).toBe(2);
  });

  it('종류마다 할 수 있는 결정만', () => {
    expect(validateDecisions(withChange('same', { decision: 'accept' }), 'admin')).toHaveLength(1);
    expect(validateDecisions(withChange('moved', { decision: 'amend' }), 'admin')).toHaveLength(1);
    expect(validateDecisions(withChange('changed', { decision: 'accept' }), 'admin')).toHaveLength(1);
    expect(validateDecisions(withChange('changed', { decision: 'amend' }), 'admin')).toEqual([]);
    expect(validateDecisions(withChange('gone6', { decision: 'new' }), 'admin')).toHaveLength(1);
  });

  it('고르기는 후보 중에서, 잇기는 원문에 없는 조문 중에서', () => {
    expect(validateDecisions(withChange('amb', { decision: 'pick', targetArticleId: 'a4' }), 'editor')).toEqual([]);
    expect(validateDecisions(withChange('amb', { decision: 'pick', targetArticleId: 'a6' }), 'editor')).toHaveLength(1);
    expect(validateDecisions(withChange('amb', { decision: 'pick' }), 'editor')).toHaveLength(1);
    expect(validateDecisions(withChange('new', { decision: 'link', targetArticleId: 'a6' }), 'editor')).toEqual([]);
    expect(validateDecisions(withChange('new', { decision: 'link', targetArticleId: 'a1' }), 'editor')).toHaveLength(1);
    // 아무도 차지하지 않은 조문이어도 원문에 없는 조문이 아니면 잇지 않는다
    expect(validateDecisions(withChange('new', { decision: 'link', targetArticleId: 'zz' }), 'editor')).toEqual([
      { itemId: 'new', message: 'new: 원문에 없는 기존 조문 중에서 이어야 합니다.' },
    ]);
    expect(validateDecisions(withChange('new', { decision: 'link' }), 'editor')).toHaveLength(1);
    expect(validateDecisions(withChange('new', { decision: 'new', targetArticleId: 'a6' }), 'editor')).toHaveLength(1);
  });

  it('한 기존 조문은 한 항목만 — 두 항목이 같은 조문을 가리키면 거부', () => {
    const both = base.map((i) =>
      i.id === 'amb' ? { ...i, decision: 'pick', targetArticleId: 'a4' } : i.id === 'new' ? { ...i, decision: 'link', targetArticleId: 'a4' } : i,
    );
    const errors = validateDecisions(both, 'admin');
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toContain('이미 가리킵니다');
  });

  it('새 조문으로 돌린 짝은 그 조문을 놓아 준다', () => {
    expect(claimOf(item('m', 'moved', { articleId: 'a2', decision: 'new' }))).toBeNull();
    expect(claimOf(item('m', 'moved', { articleId: 'a2', decision: 'accept' }))).toBe('a2');
    expect(claimOf(item('s', 'same', { articleId: 'a1' }))).toBe('a1');
    expect(claimOf(item('g', 'missing', { articleId: 'a9' }))).toBeNull();
  });

  it('이어진 원문에 없는 조문은 그대로 둠·폐지를 따로 정하지 않는다', () => {
    const linked = base.map((i) =>
      i.id === 'new' ? { ...i, decision: 'link', targetArticleId: 'a6' } : i.id === 'gone6' ? { ...i, decision: 'keep' } : i,
    );
    expect(validateDecisions(linked, 'admin')).toHaveLength(1);
  });

  it('폐지는 관리자만 정한다 — 이미 정해 둔 폐지가 있어도 편집자가 다른 항목은 정할 수 있다', () => {
    expect(validateDecisions(withChange('gone6', { decision: 'repeal' }), 'editor')).toHaveLength(1);
    expect(validateDecisions(withChange('gone6', { decision: 'repeal' }), 'editor', new Set(['gone6']))).toHaveLength(1);
    expect(validateDecisions(withChange('gone6', { decision: 'repeal' }), 'editor', new Set(['changed']))).toEqual([]);
    expect(validateDecisions(withChange('gone6', { decision: 'repeal' }), 'admin')).toEqual([]);
    expect(validateDecisions(withChange('gone6', { decision: 'keep' }), 'editor')).toEqual([]);
  });
});
