import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { deliverResult, dialogErrorTarget, isRunning, runKey, useToolStatus, type ToolStatus } from '../apps/web/src/lib/policyResult';
import { PublishDraftsDialog } from '../apps/web/src/components/policy-detail/PublishDraftsDialog';
import { ActiveToggleDialog } from '../apps/web/src/components/policy-detail/ActiveToggleDialog';
import { messages } from '../apps/web/src/i18n/messages';

/**
 * T-215 9차 검토 — 도구 줄에 남긴 실패를 나중에 끝난 다른 결과가 덮지 않기(#1), 초안 일괄 시행을 규정별로 막고 창을 연 규정에 묶기
 * (#2·#4·#8), 규정 정보 편집의 저장·상태 전환을 시작한 규정에 묶기(#3), 옮길 때 비우기를 그린 직후에(#6), 판단을 순수 함수로(#7).
 */
const ko = messages.ko as Record<string, string>;
const t = (k: string, v?: Record<string, string | number>) => (ko[k] ?? k).replace(/\{(\w+)\}/g, (_, n) => String(v?.[n] ?? `{${n}}`));
const src = (rel: string) => readFileSync(join(__dirname, '..', rel), 'utf8');
/** 훅을 SSR 로 한 번 그려 돌려받은 값 — 상자는 보통 객체라 그린 뒤에도 불러 볼 수 있다 */
function capture<T>(hook: () => T): T {
  let out: T | undefined;
  const C = () => {
    out = hook();
    return null;
  };
  renderToStaticMarkup(createElement(C));
  return out as T;
}

describe('도구 줄에 남긴 실패 (T-215 9차 #1)', () => {
  it('실패는 남긴 것으로 적고, 사용자 동작(진행 문구·잠깐 알림)과 비우기는 그 표시를 푼다', () => {
    const setMsg = vi.fn();
    const flash = vi.fn();
    const status = capture(() => useToolStatus(setMsg, flash));
    status.fail('한/글 문서를 만들지 못했습니다.');
    expect(status.isSticky()).toBe(true);
    expect(setMsg).toHaveBeenLastCalledWith('한/글 문서를 만들지 못했습니다.');
    status.show('PDF를 만드는 중입니다…');
    expect(status.isSticky()).toBe(false);
    status.fail('x');
    status.flash('본문 글자 크기 110%', 2500);
    expect(status.isSticky()).toBe(false);
    expect(flash).toHaveBeenCalledWith('본문 글자 크기 110%', 2500);
    status.fail('x');
    status.clear();
    expect(status.isSticky()).toBe(false);
    expect(setMsg).toHaveBeenLastCalledWith('');
  });

  it('같은 실패는 한 번만 덧붙고, 사용자 동작의 실패(failNow)는 남은 실패를 바꾼다 — 누를 때마다 길어지지 않는다 (11차 #5)', () => {
    let msg = '';
    const setMsg = vi.fn((v: string | ((cur: string) => string)) => {
      msg = typeof v === 'function' ? v(msg) : v;
    });
    const status = capture(() => useToolStatus(setMsg, vi.fn()));
    status.fail('a');
    status.fail('b');
    status.fail('b');
    expect(msg).toBe('a / b');
    status.failNow('주소를 복사하지 못했습니다.');
    status.failNow('주소를 복사하지 못했습니다.');
    expect(msg).toBe('주소를 복사하지 못했습니다.');
    expect(status.isSticky()).toBe(true);
  });

  it('같은 규정에서 한/글이 먼저 실패하고 PDF 가 뒤에 성공하면 — 실패는 도구 줄에 남고, 성공은 이름 붙은 알림, 뒤에 끝난 실패는 덧붙는다 (10차 #4)', () => {
    let msg = '';
    const setMsg = vi.fn((v: string | ((cur: string) => string)) => {
      msg = typeof v === 'function' ? v(msg) : v;
    });
    const flash = vi.fn();
    const toast = vi.fn();
    const status: ToolStatus = capture(() => useToolStatus(setMsg, flash));
    const sinks = { flash: status.flash, fail: status.fail, isSticky: status.isSticky, holds: status.holds, toast }; // holds — 칸을 남긴 실패·진행 문구가 쓰는가(T-224)
    const here = { id: 'A', mounted: true };
    deliverResult(here, sinks, t, { startedId: 'A', label: 'HR-01 취업규칙', message: '한/글 문서를 만들지 못했습니다.', kind: 'error' });
    deliverResult(here, sinks, t, { startedId: 'A', label: 'HR-01 취업규칙', message: 'PDF를 내려받았습니다.', kind: 'success', flashMs: 3000 });
    expect(setMsg).toHaveBeenCalledTimes(1);
    expect(msg).toBe('한/글 문서를 만들지 못했습니다.');
    expect(flash).not.toHaveBeenCalled();
    expect(toast).toHaveBeenCalledWith('HR-01 취업규칙 — PDF를 내려받았습니다.', 'success');
    // 뒤에 끝난 실패는 앞의 실패를 덮지 않고 도구 줄에 덧붙는다 — 둘 다 남는다(4초짜리 알림으로 보내면 까닭이 사라졌다)
    deliverResult(here, sinks, t, { startedId: 'A', label: 'HR-01 취업규칙', message: 'PDF를 만들지 못했습니다.', kind: 'error' });
    expect(msg).toBe('한/글 문서를 만들지 못했습니다. / PDF를 만들지 못했습니다.');
    expect(toast).toHaveBeenCalledTimes(1);
    expect(status.isSticky()).toBe(true);
  });
});

describe('창에서 시작한 작업의 실패 자리 (T-215 9차 #2·#3)', () => {
  it.each([
    ['그 규정을 보고 있고 그 규정의 창이 열려 있다', { id: 'A', mounted: true }, 'A', 'dialog'],
    ['창을 닫았다', { id: 'A', mounted: true }, null, 'report'],
    ['다른 규정의 창이 열려 있다', { id: 'A', mounted: true }, 'B', 'report'],
    ['다른 규정으로 옮겼다', { id: 'B', mounted: true }, 'B', 'report'],
    ['화면을 떠났다', { id: 'A', mounted: false }, 'A', 'report'],
  ] as const)('%s → %s', (_what, shown, dialogFor, want) => {
    expect(dialogErrorTarget('A', shown, dialogFor)).toBe(want);
  });

  it('초안 일괄 시행 진행도 규정별 — 다른 규정의 시행은 이 규정을 막지 않는다', () => {
    const running = [runKey('publish', 'A')];
    expect(isRunning(running, 'publish', 'A')).toBe(true);
    expect(isRunning(running, 'publish', 'B')).toBe(false);
    expect(isRunning(running, 'pdf', 'A')).toBe(false);
    expect(isRunning(running, 'publish', undefined)).toBe(false);
  });
});

describe('초안 일괄 시행 창 (T-215 9차 #8)', () => {
  const render = (over: Partial<Parameters<typeof PublishDraftsDialog>[0]> = {}) =>
    renderToStaticMarkup(
      createElement(PublishDraftsDialog, {
        count: 3,
        form: { changeNote: '제정', effectiveDate: '2026-01-01' },
        onChange: () => undefined,
        busy: false,
        error: null,
        onSubmit: () => undefined,
        onCancel: () => undefined,
        ...over,
      }),
    );
  it('문구는 messages 키 — 제목·건수·실패 문구(창 밖 알림과 같은 글)·시행 중에는 막힌 버튼', () => {
    const idle = render();
    expect(idle).toContain(ko['policyDetail.publishDrafts.title']);
    expect(idle).toContain(t('policyDetail.publishDrafts.count', { n: 3 }));
    expect(idle).toContain(t('policyDetail.publishDrafts.submit', { n: 3 }));
    const busy = render({ busy: true, error: '초안을 시행하지 못했습니다. 시행일이 폐지일보다 빠릅니다.' });
    expect(busy).toContain(ko['policyDetail.publishDrafts.busy']);
    expect(busy).toMatch(/<button[^>]*disabled=""[^>]*>[^<]*시행 중…/);
    expect(busy).toContain('초안을 시행하지 못했습니다. 시행일이 폐지일보다 빠릅니다.');
    // 나중에 생기는 실패 문구는 화면 읽기 프로그램이 알리게(11차)
    expect(busy).toMatch(/<p role="alert"[^>]*>초안을 시행하지 못했습니다/);
  });
});

describe('페이지 연결 (T-215 9차)', () => {
  const page = src('apps/web/src/pages/PolicyDetailPage.tsx');
  it('초안 일괄 시행 — 진행 중에는 다시 열거나 또 시행하지 않고, 끝나면 풀고, 실패는 창 밖이면 알린다', () => {
    expect(page).toContain("const publishBusy = isRunning(runs, 'publish', id);");
    // 같은 규정의 판 쓰기가 도는 동안도 열거나 시작하지 않는다(T-224 E11 — 판 쓰기 쪽도 일괄 시행이 돌면 시작하지 않는다)
    expect(page).toMatch(/const openPublishDrafts = \(\) => \{\s*if \(publishBusy \|\| publishLockedByVersion\) return;\s*publishDraftsMutation\.reset\(\);/);
    expect(page).toContain("if (!publishDraftsForm || runningNow('version', publishDraftsForm.policyId) || !startRun('publish', publishDraftsForm.policyId)) return;");
    expect(page).toContain("onSettled: (_res, _err, v) => endRun('publish', v.policyId),");
    expect(page).toMatch(/onClick=\{openPublishDrafts\}\s*disabled=\{publishBusy \|\| publishLockedByVersion\}\s*title=\{publishLockedByVersion \? t\('policyWrites\.lockedVersion'\) : undefined\}/);
    expect(page).toContain('error={publishDraftsMutation.isError ? publishFailedText(publishDraftsMutation.error) : null}');
    expect(page).toContain('busy={publishBusy}');
  });

  it('규정 정보 편집 — 저장·상태 전환은 시작한 규정으로 다시 읽고, 결과는 도구 줄 하나(떠났으면 이름 붙은 알림), 상태 전환 실패도 알린다(T-224 ④)', () => {
    // 다시 읽기는 16차부터 lib/policyRefresh — 시작한 규정(v.routeId)으로 읽는 것은 그대로(저장·상태 전환 둘). 받기를 시작한 때(since)를
    // 함께 받는다(T-224 검토 #2 — 받는 중이던 첫 받기를 기다린 뒤에 잰다)
    expect(page.match(/const \{ fresh, since \} = await fetchPolicyNowSince\(qc, v\.routeId, inScope\);/g) ?? []).toHaveLength(2);
    expect(page).not.toMatch(/const since = Date\.now\(\);/);
    // 결과 자리는 도구 줄 하나 — 성공·낡음 표시는 reportAfterRefresh, 실패는 reportResult(편집 칸 상태 줄·4초 알림으로 나누지 않는다).
    // 실패·낡음 표시 줄은 작업 이름을 달아 같은 작업이 뒤에 성공하면 걷힌다(검토 #1 — 저장 실패가 다시 저장해 성공한 뒤에도 남지 않게)
    expect(page).toContain("reportAfterRefresh(qc, reportResult, t, { startedId: v.routeId, label: v.label, done: t('policyDetail.info.saved'), received: fresh !== null, since, source: 'info' });");
    expect(page).toContain("reportAfterRefresh(qc, reportResult, t, { startedId: v.routeId, label: v.label, done, received: fresh !== null, since, source: 'toggle' });");
    expect(page).toContain("onError: (err, v) => reportResult(v.routeId, v.label, apiErrorMessage(err, t('policyDetail.info.saveFailed')), 'error', { source: 'info' }),");
    expect(page).toMatch(/if \(dialogErrorTarget\(v\.routeId, shownPolicy, toggleDialogOf\.current\) === 'dialog'\) return;\s*reportResult\(v\.routeId, v\.label, apiErrorMessage\(err, t\('policyDetail\.status\.toggleFailed'\)\), 'error', \{ source: 'toggle' \}\);/);
    // 도구 줄은 여러 작업이 함께 쓰는 칸이라 무엇을 저장했는지 적는다(검토 #5)
    expect(ko['policyDetail.info.saved']).toBe('규정 정보를 저장했습니다.');
    expect(page).toContain("if (resultTarget(v.routeId, shownPolicy) === 'toolbar') flushSync(() => setActiveToggleTarget(null));");
    expect(page).toContain('toggleActiveMutation.mutate({ ...infoTarget(), next: activeToggleTarget })');
    expect(page).not.toMatch(/policyDatesMsg|flashInfoMsg|reportInfo/);
    // 낡음 표시는 그 조회를 그 뒤에 받으면 걷힌다 — 지금 떠 있는 도구 줄에 받기 성공을 잇는다
    expect(page).toMatch(/useShownToolbar\(id, toolStatus\);\s*(\/\/[^\n]*\n\s*)*useClearStaleOnReceive\(qc, toolStatus\);/);
  });
});

describe('상태 전환 확인 창·규정 정보 저장 — 그 규정의 진행·실패만 (T-215 10차 #1·#2·#3·#5)', () => {
  const page = src('apps/web/src/pages/PolicyDetailPage.tsx');
  it('확인 창 문구는 키 — 진행 중이면 변경이 막히고, 넘겨받은 실패만 보인다', () => {
    const render = (over: Partial<Parameters<typeof ActiveToggleDialog>[0]> = {}) =>
      renderToStaticMarkup(createElement(ActiveToggleDialog, { next: false, title: '취업규칙', busy: false, error: null, onConfirm: () => undefined, onCancel: () => undefined, ...over }));
    const idle = render();
    expect(idle).toContain(ko['policyDetail.status.titleInactive']);
    expect(idle).toContain(t('policyDetail.status.askBefore', { title: '취업규칙' }));
    expect(idle).toContain(ko['policyDetail.status.unchangedSearch']);
    expect(idle).not.toContain('text-red-700');
    const busy = render({ busy: true, error: '상태를 바꾸지 못했습니다.' });
    expect(busy).toMatch(/<button[^>]*disabled=""[^>]*>처리 중…/);
    expect(busy).toContain('상태를 바꾸지 못했습니다.');
    expect(busy).toMatch(/<p role="alert"[^>]*>상태를 바꾸지 못했습니다/);
  });

  it('페이지: 창을 열 때 그 규정의 전환이 진행 중이 아니면 지난 결과를 비우고, 실패는 그 규정의 것만, 진행은 규정별', () => {
    expect(page).toMatch(/onRequestToggleActive=\{\(\) => \{\s*\/\/[^\n]*\n\s*if \(!toggleBusy\) toggleActiveMutation\.reset\(\);\s*setActiveToggleTarget\(!policy\.isActive\);/);
    expect(page).toContain("const toggleBusy = isRunning(runs, 'toggle', id);");
    expect(page).toContain("error={toggleActiveMutation.isError && toggleActiveMutation.variables?.routeId === id ? apiErrorMessage(toggleActiveMutation.error, t('policyDetail.status.toggleFailed')) : null}");
    expect(page).toMatch(/onConfirm=\{\(\) => \{\s*if \(!startRun\('toggle', id!\)\) return;\s*toggleActiveMutation\.mutate/);
    expect(page).toContain("onSettled: (_res, _err, v) => endRun('toggle', v.routeId),");
    expect(page).toContain('busy={toggleBusy}');
  });

  it('페이지: 규정마다 화면을 새로 그린다(규정 id 로 key) — 열어 둔 쓰기 창·입력·진행·관찰자가 앞 규정의 것으로 남지 않는다 (11차)', () => {
    // 경로의 규정이 바뀌면 안쪽 화면을 새로 그린다 — 창을 하나씩 비우는 목록은 새 창이 생길 때마다 빠졌다(10·11차: 폐지·철회·조 순서 창)
    expect(page).toMatch(/export default function PolicyDetailPage\(\) \{\s*const \{ id \} = useParams<\{ id: string \}>\(\);\s*return <PolicyDetailView key=\{id\} \/>;\s*\}/);
    expect(page).toMatch(/\nfunction PolicyDetailView\(\) \{\s*const \{ id \} = useParams<\{ id: string \}>\(\);/);
    // 손으로 비우던 효과는 없다(남아 있으면 새로 그리기와 겹친다)
    expect(page).not.toMatch(/\}, \[id, toolStatus\]\);/);
  });

  it('페이지: 규정 정보 저장 중 표시는 그 규정 것만, 편집 칸은 규정마다 새로(key), 안내 띠 문구는 키', () => {
    expect(page).toContain("const infoBusy = isRunning(runs, 'info', id);");
    expect(page).toContain('saving={infoBusy}');
    // 13차부터 보낸 날짜를 진행과 함께 둔다(다시 그린 화면이 그 날짜를 그린다)
    expect(page).toMatch(/onSave=\{\(\) => \{\s*const sent = [^\n]+\n\s*if \(!startRun\('info', id!, JSON\.stringify\(sent\)\)\) return;\s*savePolicyDatesMutation\.mutate/);
    expect(page).toContain("onSettled: (_res, _err, v) => endRun('info', v.routeId),");
    expect(page).toMatch(/<PolicyInfoEdit\s+key=\{id\}/);
    expect(page).toContain("{t('policyDetail.drafts.count', { n: draftOnlyCount })}");
    expect(page).not.toMatch(/시행 전 초안 \{draftOnlyCount\}건|바뀌지 않는 것|으로 표시할까요/);
    expect(isRunning([runKey('info', 'A'), runKey('toggle', 'A')], 'info', 'B')).toBe(false);
  });
});
