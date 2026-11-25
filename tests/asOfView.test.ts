import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { asOfViewState } from '../apps/web/src/lib/asOfView';
import TemplateRenderer from '../apps/web/src/components/policy-template/TemplateRenderer';
import { buildTemplateTokenData } from '../apps/web/src/components/policy-template/templateTokens';

/**
 * T-180 (PAT-22) 시점 조회 화면 판정. 고른 날짜의 응답을 받은 뒤에만 그 날짜 본문을 그리고, 받는 중·실패면 현행 본문으로 대신하지 않고
 * 본문·인쇄·내보내기를 막는다. 머리말의 날짜는 응답의 날짜. 시점 본문의 양식 머리에는 현행 규정의 개정일·시행일이 없다.
 */
const policy = { id: 'p', current: { date: '2026-10-25' }, chapters: ['현행'] };
const asOf = (date: string) => ({ id: 'p', chapters: ['그 시점'], asOf: { date, omittedArticles: 0, repealedArticles: [], hasEffectiveDates: true } });
const state = (over: Partial<Parameters<typeof asOfViewState>[0]>) =>
  asOfViewState({ asOfDate: '', policy, asOfPolicy: undefined, isError: false, isFetching: false, today: '2026-10-26', ...over });

describe('시점 조회 화면 판정 (T-180)', () => {
  it.each([
    ['현행 — 날짜 없음', {}, { blocked: false, failed: false, view: '현행', basis: '기준일: 2026-10-25 현행 본문' }],
    ['받는 중 — 응답 없음', { asOfDate: '2021-06-01', isFetching: true }, { blocked: true, failed: false, view: null, basis: '기준일: 2026-10-25 현행 본문' }],
    ['다시 받는 중(실패 뒤 재시도)은 실패로 치지 않는다', { asOfDate: '2021-06-01', isError: true, isFetching: true }, { blocked: true, failed: false, view: null, basis: '기준일: 2026-10-25 현행 본문' }],
    ['실패', { asOfDate: '2021-06-01', isError: true }, { blocked: true, failed: true, view: null, basis: '기준일: 2026-10-25 현행 본문' }],
    ['앞 날짜 응답이 남아 있어도 그 날짜가 아니면 막는다', { asOfDate: '2021-06-01', asOfPolicy: asOf('2020-01-01') }, { blocked: true, failed: false, view: null, basis: '기준일: 2026-10-25 현행 본문' }],
    ['받음 — 그 날짜 본문, 머리말은 응답 날짜', { asOfDate: '2021-06-01', asOfPolicy: asOf('2021-06-01') }, { blocked: false, failed: false, view: '그 시점', basis: '기준일: 2021-06-01 시점 본문' }],
  ] as const)('%s (T-180)', (_name, over, want) => {
    const s = state(over);
    expect({ blocked: s.blocked, failed: s.failed, view: s.viewPolicy ? (s.viewPolicy as any).chapters[0] : null, basis: s.basisLine }).toEqual(want);
    // 막힌 동안에는 시점 정보가 없다 — 라벨·파일명에 쓸 날짜가 응답에서만 나온다
    expect(s.info?.date ?? null).toBe(s.blocked || !(over as any).asOfDate ? null : (over as any).asOfDate);
  });

  it('현행 규정을 아직 못 받았으면 머리말 날짜는 오늘 (T-180)', () => {
    expect(asOfViewState({ asOfDate: '', policy: undefined, asOfPolicy: undefined, isError: false, isFetching: true, today: '2026-10-26' }).basisLine).toBe(
      '기준일: 2026-10-26 현행 본문',
    );
  });
});

describe('기본 양식 머리 — 시점 본문에는 현행 개정일·시행일이 없다 (T-180)', () => {
  const template = { layoutJson: { mode: 'basic', basicConfig: { showRevisionDate: true, showEffectiveDate: true } } };
  const render = (asOfDate: string | null, revisionDate: string | null) =>
    renderToStaticMarkup(
      createElement(TemplateRenderer as any, {
        template,
        data: buildTemplateTokenData({ policyTitle: '인사규정', policyCode: 'HR-1', revisionDate, effectiveDate: '2024-02-01', today: '2026. 10. 25.', asOf: asOfDate }),
        fullViewGroups: [],
      }),
    );

  it('현행은 개정일·시행일을, 개정일이 비면 출력일을 싣는다 — 지금 그대로 (T-180)', () => {
    expect(render(null, '2024-01-01')).toMatch(/개정일: 2024\. 1\. 1\..*시행일: 2024\. 2\. 1\./);
    expect(render(null, null)).toContain('개정일: 2026. 10. 25.');
  });

  it('시점 본문이면 개정일·시행일을 싣지 않고, 빈 개정일을 출력일로 채우지도 않는다 (T-180)', () => {
    for (const html of [render('2021-06-01', '2024-01-01'), render('2021-06-01', null)]) {
      expect(html).toContain('HR-1');
      expect(html).not.toContain('개정일');
      expect(html).not.toContain('시행일');
    }
  });
});
