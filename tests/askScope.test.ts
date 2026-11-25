/**
 * 질문 범위 고르기 (T-219, SRS SEARCH-11) — 활성 규정만 고를 수 있고, 이름·코드로 찾고, 고를 수 없게 된 규정은 뺀다.
 * 범위 단추·답 카드의 범위 표시도 브라우저 없이 그려 본다.
 */
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';
import {
  ASK_SCOPE_MAX,
  filterScopeCandidates,
  pruneScope,
  scopeCandidates,
  toggleScope,
} from '../apps/web/src/lib/askScope';
import { AskScopePicker } from '../apps/web/src/components/AskScopePicker';
import { AskTurnView } from '../apps/web/src/components/AskTurn';
import { messages } from '../apps/web/src/i18n/messages';

const ko = messages.ko as Record<string, string>;
const list = [
  { id: 'p3', code: 'HR-02', title: '취업 규칙', isActive: true },
  { id: 'p1', code: 'FN-01', title: '여비 규정', isActive: true },
  { id: 'p2', code: 'HR-01', title: '경조사 지원 규정', isActive: false },
  { id: 'p4', code: 'IT-01', title: 'Security Policy', isActive: true },
];

describe('고를 수 있는 규정 (T-219)', () => {
  it('활성 규정만, 코드 순', () => {
    expect(scopeCandidates(list).map((p) => p.id)).toEqual(['p1', 'p3', 'p4']);
  });

  it('목록이 아니거나 모양이 다르면 빈 목록', () => {
    expect(scopeCandidates(undefined)).toEqual([]);
    expect(scopeCandidates([{ code: 'x' }, null, 3])).toEqual([]);
  });

  it('이름·코드로 찾는다 — 대소문자와 띄어쓰기는 가리지 않는다', () => {
    const c = scopeCandidates(list);
    expect(filterScopeCandidates(c, '취업규칙').map((p) => p.id)).toEqual(['p3']);
    expect(filterScopeCandidates(c, 'fn-01').map((p) => p.id)).toEqual(['p1']);
    expect(filterScopeCandidates(c, 'security').map((p) => p.id)).toEqual(['p4']);
    expect(filterScopeCandidates(c, '  ')).toHaveLength(3);
    expect(filterScopeCandidates(c, '없는 규정')).toEqual([]);
  });

  it('고를 수 없게 된 규정(비활성·지움)은 고른 것에서 뺀다 — 차례는 그대로', () => {
    expect(pruneScope(['p3', 'p2', 'gone', 'p1'], scopeCandidates(list))).toEqual(['p3', 'p1']);
  });

  it('켜고 끄기 — 상한을 넘기지 않는다', () => {
    expect(toggleScope(['p1'], 'p3')).toEqual(['p1', 'p3']);
    expect(toggleScope(['p1', 'p3'], 'p1')).toEqual(['p3']);
    const full = Array.from({ length: ASK_SCOPE_MAX }, (_, i) => `x${i}`);
    expect(toggleScope(full, 'new')).toHaveLength(ASK_SCOPE_MAX);
    expect(toggleScope(full, 'x0')).toHaveLength(ASK_SCOPE_MAX - 1);
  });
});

describe('범위 단추와 답 카드의 범위 (T-219)', () => {
  const picker = (selected: string[]) => {
    const client = new QueryClient();
    client.setQueryData(['policies'], list);
    return renderToStaticMarkup(
      createElement(QueryClientProvider, { client }, createElement(AskScopePicker, { selected, onChange: () => {} })),
    );
  };

  it('고르지 않았으면 전체, 골랐으면 개수', () => {
    expect(picker([])).toContain(ko['ask.scope.all']);
    expect(picker(['p1', 'p3'])).toContain(ko['ask.scope.count'].replace('{n}', '2'));
  });

  const result = { answerable: false, reason: 'no_regulations' as const, blocks: [], citations: [], lawCitations: [], consulted: [] };
  const turn = (scope: { id: string; title: string; code: string }[]) =>
    renderToStaticMarkup(createElement(MemoryRouter, null, createElement(AskTurnView, { question: '출장비', result, scope, canOpenLaws: false })));

  it('범위를 골라 물었으면 답 위에 범위 — 코드와 이름으로', () => {
    const html = turn([
      { id: 'p1', title: '여비 규정', code: 'FN-01' },
      { id: 'p2', title: '취업규칙', code: 'HR-02' },
    ]);
    expect(html).toContain('data-testid="ask-turn-scope"');
    expect(html).toContain(ko['ask.scope.line'].replace('{names}', 'FN-01 여비 규정 · HR-02 취업규칙'));
  });

  it('범위 줄은 셋까지 이름을 적고 나머지는 펼치기 단추로 — 터치·키보드로도 펼친다', () => {
    const many = Array.from({ length: 30 }, (_, i) => ({ id: `p${i}`, title: `규정${i}`, code: `C-${i}` }));
    const html = turn(many);
    expect(html).toContain(ko['ask.scope.line'].replace('{names}', 'C-0 규정0 · C-1 규정1 · C-2 규정2'));
    expect(html).not.toContain('C-3 규정3');
    expect(html).toMatch(/<button[^>]*aria-expanded="false"[^>]*data-testid="ask-turn-scope-more"[^>]*>/);
    expect(html).toContain(ko['ask.scope.lineMore'].replace('{n}', '27'));
    // 셋 이하면 단추가 없다
    expect(turn(many.slice(0, 3))).not.toContain('ask-turn-scope-more');
  });

  it('범위 안에 시행 중 조문이 없으면 범위를 넓히라고 하고, 범위 없이 물었으면 회사에 규정이 없다고 한다', () => {
    expect(turn([{ id: 'p1', title: '여비 규정', code: 'FN-01' }])).toContain(ko['ask.reason.no_regulations_scope']);
    const whole = turn([]);
    expect(whole).toContain(ko['ask.reason.no_regulations']);
    expect(whole).not.toContain('data-testid="ask-turn-scope"');
  });
});
