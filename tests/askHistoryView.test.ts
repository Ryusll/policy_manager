/**
 * 지난 질문 다시 보기 화면 (T-218, SRS SEARCH-10 ③) — 물은 때의 답과 근거를 그대로 그리고, 근거를 남기기 전(T-218 전)의
 * 답은 본문과 그 안내 한 줄만 보인다(빈 근거 조문 칸을 그리지 않는다).
 */
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';
import { AskHistoryView } from '../apps/web/src/components/AskHistoryView';
import { ASK_HISTORY_KEY } from '../apps/web/src/components/AskHistoryPanel';

const citation = {
  ref: 'R1',
  articleId: 'a-1',
  policyId: 'p-1',
  policyTitle: '경조사 지원 규정',
  policyCode: 'HR-01',
  label: '제2조',
  joTitle: '경조금',
  number: 2,
  branchNumber: null,
  clauseNumber: null,
  itemNumber: null,
  content: '본인 결혼 시 경조금 50만원을 지급한다.',
};

const detail = (snapshot: boolean) => ({
  id: 'h-1',
  question: '결혼하면 경조금은 얼마인가요?',
  createdAt: '2026-11-18T03:00:00Z',
  outcome: 'answered',
  snapshot,
  result: {
    answerable: true,
    blocks: [{ type: 'paragraph', text: '본인 결혼이면 50만원입니다.' }],
    citations: snapshot ? [citation] : [],
    lawCitations: [],
    consulted: [],
  },
});

function renderWith(client: QueryClient) {
  return renderToStaticMarkup(
    createElement(QueryClientProvider, { client }, createElement(MemoryRouter, null, createElement(AskHistoryView, { id: 'h-1', canOpenLaws: false }))),
  );
}

function render(data: unknown) {
  const client = new QueryClient();
  client.setQueryData([...ASK_HISTORY_KEY, 'h-1'], data);
  return renderWith(client);
}

/** 불러오기에 실패한 상태로 그린다 — 다시 부르지 않게(retryOnMount 끔) 해 오류 화면 그대로 본다 */
function renderError(status?: number) {
  const client = new QueryClient({ defaultOptions: { queries: { retryOnMount: false } } });
  const error = status === undefined ? new Error('Network Error') : Object.assign(new Error('Request failed'), { response: { status } });
  client
    .getQueryCache()
    .build(client, { queryKey: [...ASK_HISTORY_KEY, 'h-1'] })
    .setState({ status: 'error', error, fetchStatus: 'idle' } as never);
  return renderWith(client);
}

describe('지난 질문 다시 보기 화면 (T-218)', () => {
  it('근거를 남긴 답: 언제 받은 답인지, 질문·답·물은 때의 근거 조문', () => {
    const html = render(detail(true));
    expect(html).toContain('data-testid="ask-history-when"');
    expect(html).toContain('받은 답입니다');
    expect(html).toContain('결혼하면 경조금은 얼마인가요?');
    expect(html).toContain('본인 결혼이면 50만원입니다.');
    expect(html).toContain('data-testid="ask-citations"');
    expect(html).toContain('경조사 지원 규정 · 제2조');
    expect(html).not.toContain('근거를 함께 남기기 전에');
  });

  it('근거를 남기기 전의 답: 본문과 그 안내만 — 빈 근거 조문 칸은 그리지 않는다', () => {
    const html = render(detail(false));
    expect(html).toContain('본인 결혼이면 50만원입니다.');
    expect(html).toContain('근거를 함께 남기기 전에');
    expect(html).not.toContain('data-testid="ask-citations"');
  });

  it('보관 기간이 지나 없어졌으면(404) 더 볼 수 없다는 안내만 — 다시 시도 단추는 없다', () => {
    const html = renderError(404);
    expect(html).toContain('data-testid="ask-history-error"');
    expect(html).toContain('보관 기간(90일)이 지나 더 볼 수 없는 질문입니다.');
    expect(html).not.toContain('<button');
  });

  it('그 밖의 실패(403·5xx·끊김)는 다시 시도 안내와 단추', () => {
    for (const status of [403, 500, undefined]) {
      const html = renderError(status);
      expect(html, String(status)).toContain('이 질문을 불러오지 못했습니다');
      expect(html, String(status)).toContain('<button');
      expect(html, String(status)).not.toContain('보관 기간(90일)이 지나');
    }
  });

  it('범위를 골라 물은 질문은 답을 받지 못했어도 범위 줄이 보인다 (T-219)', () => {
    const scope = [{ id: 'p1', title: '여비 규정', code: 'FN-01' }];
    for (const data of [{ ...detail(true), scope }, { ...detail(true), scope, outcome: 'failed', result: null }]) {
      const html = render(data);
      expect(html).toContain('data-testid="ask-turn-scope"');
      expect(html).toContain('FN-01 여비 규정');
    }
  });

  it('답을 받지 못한 질문: 질문과 그 사실만', () => {
    const html = render({ ...detail(true), outcome: 'failed', result: null });
    expect(html).toContain('결혼하면 경조금은 얼마인가요?');
    expect(html).toContain('에 한 질문입니다.');
    expect(html).toContain('오류로 답을 받지 못했습니다');
    expect(html).not.toContain('data-testid="ask-answer"');
  });
});
