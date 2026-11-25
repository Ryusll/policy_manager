/**
 * 서버에 AI 가 없을 때의 안내 (T-172 — 열람자도 규정 질문 화면에 온다).
 * 설정은 운영자 몫이라 보는 사람마다 할 일을 다르게 적는다. 직원에게 "아스트룸에 문의"를 보이지 않는다.
 */
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AskNotConfigured } from '../apps/web/src/components/AskNotice';
import { messages } from '../apps/web/src/i18n/messages';

const ko = messages.ko as Record<string, string>;
const en = messages.en as Record<string, string>;
const render = (props: { role?: string; platformRole?: string }) => renderToStaticMarkup(createElement(AskNotConfigured, props));

describe('AI 미설정 안내 (T-172)', () => {
  it('열람자·편집자에게는 회사 관리자에게 문의하라고 한다', () => {
    for (const role of ['viewer', 'editor']) {
      const html = render({ role });
      expect(html, role).toContain(ko['ask.notConfigured.title']);
      expect(html, role).toContain(ko['ask.notConfigured.staffHint']);
      expect(html, role).not.toContain('아스트룸');
    }
  });

  it('회사 관리자에게는 아스트룸 문의, 플랫폼 관리자에게는 설정 방법', () => {
    expect(render({ role: 'admin' })).toContain(ko['ask.notConfigured.adminHint']);
    const platform = render({ role: 'admin', platformRole: 'global_admin' });
    expect(platform).toContain('AI_QA_PROVIDER');
    expect(platform).not.toContain(ko['ask.notConfigured.adminHint']);
  });

  it('문구는 한·영 사전에 모두 있다', () => {
    for (const key of ['ask.notConfigured.title', 'ask.notConfigured.adminHint', 'ask.notConfigured.staffHint', 'ask.notConfigured.platformHint']) {
      expect(ko[key], key).toBeTruthy();
      expect(en[key], key).toBeTruthy();
    }
  });
});
