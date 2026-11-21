import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import PolicyToolbar from '../apps/web/src/components/policy-detail/PolicyToolbar';
import { useToolStatus } from '../apps/web/src/lib/policyResult';

/** T-227 — 규정 상세 도구 줄 상태 칸의 실패 색(C-116 ⑥): 남긴 실패는 붉은 계열, 진행·잠깐 알림은 지금의 초록 — 글의 종류를 함께 알린다 */
function capture<T>(hook: () => T): T {
  let out: T | undefined;
  const C = () => {
    out = hook();
    return null;
  };
  renderToStaticMarkup(createElement(C));
  return out as T;
}

describe('도구 줄 실패 색 (T-227 — useToolStatus·PolicyToolbar)', () => {
  it('실패(fail·failNow)는 error, 진행 문구·잠깐 알림·지우기는 info 로 글의 종류를 알린다', () => {
    const setKind = vi.fn();
    const status = capture(() => useToolStatus(vi.fn(), vi.fn(), setKind));
    status.fail('PDF를 만들지 못했습니다.');
    expect(setKind).toHaveBeenLastCalledWith('error');
    status.show('PDF 만드는 중…');
    expect(setKind).toHaveBeenLastCalledWith('info');
    status.failNow('복사하지 못했습니다.');
    expect(setKind).toHaveBeenLastCalledWith('error');
    status.flash('복사했습니다.', 3000);
    expect(setKind).toHaveBeenLastCalledWith('info');
    status.fail('PDF를 만들지 못했습니다.');
    status.clear();
    expect(setKind).toHaveBeenLastCalledWith('info');
  });

  const noop = () => undefined;
  const statusSpan = (lawToolMsg: string | null, lawToolKind?: 'info' | 'error') => {
    const html = renderToStaticMarkup(
      createElement(
        MemoryRouter,
        null,
        createElement(PolicyToolbar, {
          lawToolMsg,
          lawToolKind,
          view: { mode: 'full', canSegment: false, onChange: noop },
          jump: { value: '', options: [], onJump: noop },
          compare: { hasDates: false, onOldNew: noop, onThreeWay: noop },
          menus: { exportLabel: '내보내기', exportItems: [], viewItems: [], moreItems: [] },
          asOf: null,
          a11yPanel: null,
        }),
      ),
    );
    return html.match(/<span role="status"[^>]*>/)?.[0] ?? '';
  };

  it('실패 글은 붉은 계열, 그 밖의 글은 초록으로 칠한다 — 종류를 주지 않으면 초록, 글이 없으면 칠하지 않는다', () => {
    const failed = statusSpan('PDF를 만들지 못했습니다.', 'error');
    expect(failed).toContain('data-kind="error"');
    expect(failed).toContain('text-red-700');
    expect(failed).not.toContain('emerald');
    const info = statusSpan('복사했습니다.', 'info');
    expect(info).toContain('data-kind="info"');
    expect(info).toContain('text-emerald-800');
    expect(info).not.toContain('red');
    expect(statusSpan('PDF 만드는 중…')).toContain('data-kind="info"');
    const empty = statusSpan(null, 'error');
    expect(empty).not.toContain('data-kind');
    expect(empty).not.toContain('red');
  });
});
