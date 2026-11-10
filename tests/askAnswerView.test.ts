import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { AskAnswer } from '../apps/web/src/components/AskAnswer';
import { renderInline } from '../apps/web/src/lib/inlineBold';
import type { AskResult } from '../apps/web/src/api/ask';

/**
 * T-207 규정 질문 답 화면 — 서버가 고정된 순서로 보낸 블록을 검토 보고서 모양으로 그린다(SRS SEARCH-7).
 * 굵게는 `**` 만 <strong> 으로, AI 문장에 섞인 태그는 글자로만 보인다(HTML 로 바꾸지 않는다).
 */

const result: AskResult = {
  answerable: true,
  blocks: [
    { type: 'paragraph', text: '기본 방향은 **대체로 부합**합니다. <img src=x onerror=alert(1)>' },
    {
      type: 'review',
      rows: [
        { area: '적용 범위', law: '개인정보 보호법 제29조', current: '제2조: 모든 임직원', verdict: '대체로 부합', advice: '현행 유지' },
        { area: '침해사고 대응', law: '정보통신망법', current: '규정에 없음', verdict: '보완 필요', advice: '신고 절차를 둔다' },
      ],
    },
    { type: 'priorities', kind: 'amend', items: [{ title: '침해사고 대응 절차', detail: '**보고 기한**을 정한다.' }] },
    { type: 'paragraph', text: '골격은 갖췄지만 **세부 절차**가 약합니다.' },
    { type: 'paragraph', text: '근거 규정은 정보보안 규정 제2조입니다.' },
  ],
  citations: [
    {
      ref: 'R1',
      articleId: 'a1',
      policyId: 'p1',
      policyTitle: '정보보안 규정',
      policyCode: 'SEC-1',
      label: '제2조',
      joTitle: '적용범위',
      number: 2,
      branchNumber: null,
      clauseNumber: null,
      itemNumber: null,
      content: '이 규정은 모든 임직원에게 적용한다.',
    },
  ],
  lawCitations: [
    {
      ref: 'L1',
      lawId: 'law1',
      lawName: '개인정보 보호법',
      lawArticleId: 'la1',
      label: '제29조',
      title: '안전조치의무',
      content: '개인정보처리자는 …',
      scheduledOn: '2027-03-01',
    },
  ],
  consulted: [{ policyId: 'p1', policyTitle: '정보보안 규정', number: 2, branchNumber: null, label: '제2조(적용범위)' }],
  usage: { used: 1, limit: 300, userUsed: 1, userLimit: 60 },
};

const html = renderToStaticMarkup(createElement(MemoryRouter, null, createElement(AskAnswer, { result, canOpenLaws: true })));

describe('검토 보고서 모양으로 그린다 (T-207)', () => {
  it('직답의 굵게는 <strong>, 별표는 글자로 남지 않는다 (T-207)', () => {
    expect(html).toContain('<strong class="font-semibold text-gray-900">대체로 부합</strong>');
    expect(html).not.toContain('**');
  });

  it('AI 문장에 섞인 태그는 글자로만 보인다 — HTML 로 바꾸지 않는다 (T-207)', () => {
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
  });

  it('검토 표는 다섯 머리(검토 영역·관련 법령·기준·현재 규정 상태·판단·개정·보완 권고)와 판단 표시를 그린다 (T-207)', () => {
    for (const h of ['검토 영역', '관련 법령·기준', '현재 규정 상태', '판단', '개정·보완 권고']) expect(html).toContain(`>${h}</th>`);
    expect(html).toMatch(/class="badge-published">대체로 부합</);
    expect(html).toMatch(/bg-red-50[^"]*">보완 필요</);
  });

  it('우선 개정 권고는 건수 제목과 번호 목록으로 그린다 (T-207)', () => {
    expect(html).toContain('우선 개정 권고 1건');
    expect(html).toContain('<ol');
    expect(html).toContain('침해사고 대응 절차');
    expect(html).toContain('<strong class="font-semibold text-gray-900">보고 기한</strong>');
  });

  it('맨 위 "규정 검토 · 조문 N개", 아래 근거 조문 바로가기와 법령 근거 바로가기(시행 예정 표시)를 붙인다 (T-207·T-209)', () => {
    expect(html).toContain('규정 검토 · 조문 1개');
    expect(html).toContain('href="/policies/p1');
    expect(html).toContain('근거 조문 1건');
    expect(html).toContain('href="/laws/law1"');
    expect(html).toContain('개인정보 보호법 제29조(안전조치의무)');
    expect(html).toContain('2027-03-01 시행 예정 개정 있음');
    expect(html).toContain('판단과 권고는 AI의 참고 의견입니다');
  });

  it('블록 순서를 바꾸지 않는다 — 직답이 표보다, 표가 권고보다, 권고가 종합 의견보다 먼저 (T-207)', () => {
    const at = (s: string) => html.indexOf(s);
    expect(at('대체로 부합</strong>')).toBeLessThan(at('<table'));
    expect(at('<table')).toBeLessThan(at('우선 개정 권고'));
    expect(at('우선 개정 권고')).toBeLessThan(at('세부 절차'));
    expect(at('세부 절차')).toBeLessThan(at('근거 규정은'));
  });
});

describe('굵게 나누기 (T-207)', () => {
  it('짝이 맞는 ** 만 굵게 — 없으면 글자 그대로 (T-207)', () => {
    expect(renderInline('굵게 없음')).toBe('굵게 없음');
    const md = renderToStaticMarkup(createElement('p', null, renderInline('a **b** c **d**')));
    expect(md).toBe('<p>a <strong class="font-semibold text-gray-900">b</strong> c <strong class="font-semibold text-gray-900">d</strong></p>');
  });
});

describe('법령 근거 바로가기는 법령 화면에 들어갈 수 있는 역할만 (T-209)', () => {
  it('열람자에게는 바로가기 없이 글만 — 법령 화면은 열람자 접근 불가 (T-209)', () => {
    const viewerHtml = renderToStaticMarkup(createElement(MemoryRouter, null, createElement(AskAnswer, { result })));
    expect(viewerHtml).not.toContain('href="/laws/');
    expect(viewerHtml).toContain('개인정보 보호법 제29조(안전조치의무)');
    expect(viewerHtml).toContain('href="/policies/p1'); // 규정 바로가기는 그대로(열람자도 규정 상세는 본다)
  });
});
