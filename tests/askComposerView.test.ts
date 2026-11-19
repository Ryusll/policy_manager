/**
 * 규정 질문 입력 카드·예시 질문 그리기와 화면 문구 (T-217, SRS SEARCH-9).
 * 처음에는 가운데 큰 카드(hero), 답이 생기면 위쪽 작은 카드(compact). 고지는 두 모양 모두 입력 카드 바로 아래.
 * 브라우저 없이 그려 HTML 을 본다(askAnswerView 와 같은 방식).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { AiQaNotice } from '../apps/web/src/api/ask';
import { AskComposer } from '../apps/web/src/components/AskComposer';
import { AskExamples } from '../apps/web/src/components/AskExamples';
import { ASK_EXAMPLE_KEYS } from '../apps/web/src/lib/askExamples';
import { messages } from '../apps/web/src/i18n/messages';

const ko = messages.ko as Record<string, string>;
const en = messages.en as Record<string, string>;

const notice: AiQaNotice = {
  version: 3,
  recipient: 'Anthropic, PBC',
  country: '미국',
  sent: ['직원이 쓴 질문'],
  notSent: '',
  retention: [],
  training: '',
  control: '',
  caution: '민감한 개인정보를 적지 마세요',
  summary: '질문이 외부 AI 로 전송됩니다.',
  consentStatement: '',
};

interface ComposerCase {
  variant?: 'hero' | 'compact';
  value?: string;
  pending?: boolean;
  slot?: ReactElement;
}

const composer = ({ variant = 'hero', value = '', pending = false, slot }: ComposerCase) =>
  renderToStaticMarkup(
    createElement(AskComposer, { variant, value, pending, notice, onChange: () => {}, onSubmit: () => {} }, slot),
  );

describe('입력 카드 두 모양 (T-217)', () => {
  it('처음 모양: 가운데 큰 카드와 머리말, 카드 바로 아래 고지, 그 아래 예시', () => {
    const html = composer({ slot: createElement('div', { 'data-testid': 'slot' }) });
    expect(html).toContain('data-variant="hero"');
    expect(html).toContain(ko['ask.hero.title']);
    const form = html.indexOf('</form>');
    const footer = html.indexOf('data-testid="ask-notice-footer"');
    const slot = html.indexOf('data-testid="slot"');
    expect(form).toBeGreaterThan(0);
    expect(footer).toBeGreaterThan(form);
    expect(slot).toBeGreaterThan(footer);
  });

  it('답이 생긴 뒤 모양: 위쪽 작은 카드, 머리말 없이 고지는 카드 안 아래', () => {
    const html = composer({ variant: 'compact' });
    expect(html).toContain('data-variant="compact"');
    expect(html).not.toContain(ko['ask.hero.title']);
    expect(html.indexOf('data-testid="ask-notice-footer"')).toBeLessThan(html.indexOf('</form>'));
  });

  it('보내는 중이거나 질문이 짧으면 묻기 버튼이 꺼진다', () => {
    const pending = composer({ value: '경조금 기준은?', pending: true });
    expect(pending).toMatch(/<button type="submit"[^>]*disabled/);
    expect(pending).toContain(ko['ask.submitting']);
    expect(composer({ value: '가' })).toMatch(/<button type="submit"[^>]*disabled/);
    expect(composer({ value: '경조금 기준은?' })).not.toMatch(/<button type="submit"[^>]*disabled/);
  });

  it('입력칸은 500자에서 막힌다', () => {
    expect(composer({})).toContain('maxLength="500"');
  });

  it('두 모양 모두 같은 자리에 입력칸을 둔다 — 보내는 순간 모양이 바뀌어도 입력칸이 새로 만들어지지 않는다', () => {
    // React 는 같은 자리·같은 종류의 요소를 그대로 둔다: 뿌리 section → 둘째 자리 form → 첫째 자리 textarea
    const shape = (html: string) => {
      const root = html.match(/^<(\w+)/)?.[1];
      const formAt = html.indexOf('<form');
      const textareaRight = html.slice(formAt).replace(/^<form[^>]*>/, '').startsWith('<textarea');
      return { root, textareaRight };
    };
    expect(shape(composer({ variant: 'hero' }))).toEqual({ root: 'section', textareaRight: true });
    expect(shape(composer({ variant: 'compact' }))).toEqual({ root: 'section', textareaRight: true });
  });
});

describe('예시 질문 그리기 (T-217)', () => {
  const examples = (role: string) => renderToStaticMarkup(createElement(AskExamples, { role, onPick: () => {} }));

  it('열람자: 탭 없이 직원용 3개', () => {
    const html = examples('viewer');
    expect(html).not.toContain('data-testid="ask-examples-tab"');
    expect(html).not.toContain(ko['ask.examples.tab.manager']);
    for (const key of ASK_EXAMPLE_KEYS.staff.slice(0, 3)) expect(html).toContain(ko[key]);
    expect(html).not.toContain(ko[ASK_EXAMPLE_KEYS.staff[3]]);
    expect(html).toContain('data-testid="ask-examples-more"');
  });

  it('관리자: 담당자용 탭이 먼저 눌려 있고 담당자용 예시가 보인다', () => {
    const html = examples('admin');
    const tabs = [...html.matchAll(/<button[^>]*data-testid="ask-examples-tab"[^>]*>/g)].map((m) => m[0]);
    expect(tabs).toHaveLength(2);
    expect(tabs[0]).toContain('aria-pressed="true"');
    expect(tabs[1]).toContain('aria-pressed="false"');
    expect(html.indexOf(ko['ask.examples.tab.manager'])).toBeLessThan(html.indexOf(ko['ask.examples.tab.staff']));
    expect(html).toContain(ko[ASK_EXAMPLE_KEYS.manager[0]]);
    expect(html).not.toContain(ko[ASK_EXAMPLE_KEYS.staff[0]]);
  });
});

describe('질문 화면의 문구는 사전에 있다 (T-217)', () => {
  const FILES = [
    'apps/web/src/pages/AskPage.tsx',
    'apps/web/src/components/AskComposer.tsx',
    'apps/web/src/components/AskExamples.tsx',
    'apps/web/src/components/AskTurn.tsx',
    'apps/web/src/components/DashboardAskEntry.tsx',
    'apps/web/src/components/TenantNameLabel.tsx',
    'apps/web/src/components/AskHistoryPanel.tsx',
    'apps/web/src/components/AskHistoryView.tsx',
    'apps/web/src/components/AskScopePicker.tsx',
    'apps/web/src/components/AskHeaderActions.tsx',
    'apps/web/src/components/AskScopeLine.tsx',
    'apps/web/src/components/AskFollowUpChip.tsx',
  ];
  const read = (rel: string) => readFileSync(join(__dirname, '..', rel), 'utf8');
  const withoutComments = (code: string) => code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

  it('부르는 키가 한·영 사전에 모두 있다(동적 키 포함)', () => {
    const keys = new Set<string>();
    for (const file of FILES) for (const m of read(file).matchAll(/\bt\('([^']+)'/g)) keys.add(m[1]);
    for (const reason of ['no_regulations', 'no_candidates', 'no_basis', 'refused']) keys.add(`ask.reason.${reason}`);
    for (const group of ['manager', 'staff']) keys.add(`ask.examples.tab.${group}`);
    for (const key of [...ASK_EXAMPLE_KEYS.manager, ...ASK_EXAMPLE_KEYS.staff]) keys.add(key);
    // 지난 질문(T-218): 기간·결과 종류·오류 갈래
    for (const kind of ['today', 'yesterday', 'week', 'month']) keys.add(`ask.history.period.${kind}`);
    for (const outcome of ['no_regulations', 'no_candidates', 'no_basis', 'refused', 'failed', 'unfinished']) keys.add(`ask.history.outcome.${outcome}`);
    for (const outcome of ['failed', 'unfinished']) keys.add(`ask.history.detail.${outcome}`);
    // 범위(T-219): 답 카드가 변수로 고르는 키
    keys.add('ask.reason.no_regulations_scope');
    expect(keys.size).toBeGreaterThan(30);
    expect([...keys].filter((k) => !ko[k])).toEqual([]);
    expect([...keys].filter((k) => !en[k])).toEqual([]);
  });

  it('화면 파일에 직접 쓴 한글 문구가 없다(주석 밖)', () => {
    for (const file of FILES) {
      const hangul = withoutComments(read(file)).match(/[가-힣]+/g) ?? [];
      expect(hangul, file).toEqual([]);
    }
  });
});
