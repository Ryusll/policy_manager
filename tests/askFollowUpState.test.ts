/**
 * 이어서 묻기 화면 상태 (T-220, SRS SEARCH-12) — 잇기 칩이 답·오류에 따라 바뀌는 규칙, 지난 답에서 이을 수 있는 기록,
 * 답을 기다리는 동안 칩 ✕·새 질문 잠금(답이 오면 비운 화면에 그 답과 잇기가 다시 생기므로).
 */
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';
import { canFollowUpFrom, followUpAfterAnswer, followUpAfterError } from '../apps/web/src/lib/askFollowUp';
import { AskFollowUpChip } from '../apps/web/src/components/AskFollowUpChip';
import { AskHistoryPanel } from '../apps/web/src/components/AskHistoryPanel';

const prev = { id: 'p1', question: '경조휴가 며칠' };

describe('잇기 칩의 바뀜 (T-220)', () => {
  it('답을 냈으면 그 답으로 옮기고, 답하지 못했으면 앞 잇기를 그대로 둔다', () => {
    expect(followUpAfterAnswer(prev, { answerable: true, id: 'n1' }, '그건 유급인가요')).toEqual({ id: 'n1', question: '그건 유급인가요' });
    expect(followUpAfterAnswer(null, { answerable: true, id: 'n1' }, '경조금')).toEqual({ id: 'n1', question: '경조금' });
    expect(followUpAfterAnswer(prev, { answerable: false, id: 'n2' }, '그건?')).toBe(prev);
    expect(followUpAfterAnswer(null, { answerable: false, id: 'n2' }, '그건?')).toBeNull();
  });

  it('앞 질문을 쓸 수 없게 되면(400 AI_QA_PARENT_INVALID) 걷고, 다른 오류에는 그대로 둔다', () => {
    expect(followUpAfterError(prev, 'AI_QA_PARENT_INVALID')).toBeNull();
    for (const code of ['AI_QA_MONTHLY_LIMIT', 'AI_QA_SCOPE_INVALID', 'AI_QA_DISABLED', undefined]) {
      expect(followUpAfterError(prev, code)).toBe(prev);
    }
  });

  it('지난 답에서 이을 수 있는 기록 — 답을 냈고, 물은 때 근거를 남겼고, 회사 조문 근거가 있을 때만', () => {
    const answered = { answerable: true, citations: [{ ref: 'R1' }] };
    expect(canFollowUpFrom({ snapshot: true, result: answered })).toBe(true);
    expect(canFollowUpFrom({ snapshot: false, result: answered })).toBe(false); // 근거를 남기기 전 옛 기록
    expect(canFollowUpFrom({ snapshot: true, result: { answerable: true, citations: [] } })).toBe(false);
    expect(canFollowUpFrom({ snapshot: true, result: { answerable: false, citations: [] } })).toBe(false);
    expect(canFollowUpFrom({ snapshot: true, result: null })).toBe(false); // 답을 받지 못한 질문
  });
});

describe('답을 기다리는 동안 잠금 (T-220)', () => {
  it('칩의 ✕(이어서 묻지 않기)', () => {
    const chip = (disabled: boolean) => renderToStaticMarkup(createElement(AskFollowUpChip, { question: '경조휴가 며칠', onClear: () => {}, disabled }));
    expect(chip(true)).toMatch(/<button[^>]*disabled=""[^>]*data-testid="ask-follow-up-clear"/);
    expect(chip(false)).not.toMatch(/disabled=""/);
    expect(chip(false)).toContain('이어서 묻기: 경조휴가 며칠');
  });

  it('새 질문', () => {
    const panel = (newDisabled: boolean) =>
      renderToStaticMarkup(
        createElement(
          QueryClientProvider,
          { client: new QueryClient() },
          createElement(AskHistoryPanel, { selectedId: null, onSelect: () => {}, onNew: () => {}, newDisabled }),
        ),
      );
    expect(panel(true)).toMatch(/<button[^>]*disabled=""[^>]*data-testid="ask-history-new"/);
    expect(panel(false)).not.toMatch(/<button[^>]*disabled=""[^>]*data-testid="ask-history-new"/);
  });
});
