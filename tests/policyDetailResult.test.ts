import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { deliverResult, exportBusyFor, pendingJumpAction, policyLabel, resultTarget, runKey } from '../apps/web/src/lib/policyResult';
import { exportButtonLabel, exportFailedMessage, exportMenu } from '../apps/web/src/lib/policyToolMenus';
import { usePolicyRunsStore } from '../apps/web/src/stores/policyRunsStore';
import { messages } from '../apps/web/src/i18n/messages';

/**
 * T-215 8차 검토 — 규정 상세에서 시작한 비동기 작업의 진행 표시와 결과를 시작한 규정에 묶는다(lib/policyResult).
 * 같은 화면을 규정만 바꿔 다시 쓰므로, 묶지 않으면 앞 규정의 'PDF 만드는 중'이 새 규정의 버튼을 막고, 지금 규정이 아니라고 결과를
 * 버리면 실패가 어디에도 알려지지 않는다.
 */
const ko = messages.ko as Record<string, string>;
const t = (k: string, v?: Record<string, string | number>) => (ko[k] ?? k).replace(/\{(\w+)\}/g, (_, n) => String(v?.[n] ?? `{${n}}`));
const src = (rel: string) => readFileSync(join(__dirname, '..', rel), 'utf8');
const noop = () => undefined;

describe('결과를 알릴 자리 (T-215 8차)', () => {
  it.each([
    ['시작한 규정을 보고 있다', { id: 'A', mounted: true }, 'toolbar'],
    ['다른 규정으로 옮겼다', { id: 'B', mounted: true }, 'toast'],
    ['화면을 떠났다(내려감)', { id: 'A', mounted: false }, 'toast'],
    ['아직 그리기 전', { id: undefined, mounted: false }, 'toast'],
  ] as const)('%s → %s', (_what, shown, want) => {
    expect(resultTarget('A', shown)).toBe(want);
  });

  it('도구 줄이면 성공은 잠깐(시간을 넘긴다), 실패는 남긴다 — 떠났으면 규정 이름을 붙여 화면 전체 알림, 성공·실패 종류도 그대로', () => {
    const sinks = () => ({ flash: vi.fn(), fail: vi.fn(), isSticky: () => false, toast: vi.fn() });
    const here = { id: 'A', mounted: true };
    const s1 = sinks();
    deliverResult(here, s1, t, { startedId: 'A', label: 'HR-01 취업규칙', message: 'PDF를 내려받았습니다.', kind: 'success', flashMs: 4000 });
    expect(s1.flash).toHaveBeenCalledWith('PDF를 내려받았습니다.', 4000);
    expect(s1.fail).not.toHaveBeenCalled();
    expect(s1.toast).not.toHaveBeenCalled();
    const s2 = sinks();
    deliverResult(here, s2, t, { startedId: 'A', label: 'HR-01 취업규칙', message: '실패', kind: 'error' });
    expect(s2.fail).toHaveBeenCalledWith('실패');
    expect(s2.flash).not.toHaveBeenCalled();
    expect(s2.toast).not.toHaveBeenCalled();
    const s3 = sinks();
    deliverResult({ id: 'B', mounted: true }, s3, t, { startedId: 'A', label: 'HR-01 취업규칙', message: 'PDF를 만들지 못했습니다.', kind: 'error' });
    expect(s3.toast).toHaveBeenCalledWith('HR-01 취업규칙 — PDF를 만들지 못했습니다.', 'error');
    expect(s3.fail).not.toHaveBeenCalled();
    expect(s3.flash).not.toHaveBeenCalled();
    // 떠난 뒤 끝난 성공도 뺀 것(시행 전 초안 등) 안내와 함께 알린다
    const s4 = sinks();
    const done = `${ko['policyDetail.export.pdfDone']} ${t('policyDetail.export.leftOutDrafts', { n: 2 })}`;
    deliverResult({ id: 'A', mounted: false }, s4, t, { startedId: 'A', label: 'HR-01 취업규칙', message: done, kind: 'success' });
    expect(s4.toast).toHaveBeenCalledWith(`HR-01 취업규칙 — ${done}`, 'success');
    expect(s4.flash).not.toHaveBeenCalled();
  });

  it('규정 이름은 코드와 제목 — 코드가 없으면 제목만', () => {
    expect(policyLabel({ code: 'HR-01', title: '취업규칙' })).toBe('HR-01 취업규칙');
    expect(policyLabel({ code: null, title: '취업규칙' })).toBe('취업규칙');
    expect(policyLabel(undefined)).toBe('');
  });
});

describe('보류한 조문 이동 (T-215 8차)', () => {
  const s = (over: Partial<{ asOfBlocked: boolean; fullView: boolean; id: string | undefined }> = {}) => ({ asOfBlocked: false, fullView: true, id: 'A', ...over });
  it.each([
    ['보류 없음', null, s(), 'none'],
    ['시점 본문을 받는 중', { policyId: 'A' }, s({ asOfBlocked: true }), 'wait'],
    ['받았다', { policyId: 'A' }, s(), 'run'],
    ['다른 규정으로 옮겼다(그 규정은 받는 중)', { policyId: 'A' }, s({ id: 'B', asOfBlocked: true }), 'drop'],
    ['다른 규정으로 옮겼다(그 규정의 시점 본문이 캐시에 있어 바로 풀림)', { policyId: 'A' }, s({ id: 'B' }), 'drop'],
    ['분절 보기로 갔다', { policyId: 'A' }, s({ fullView: false }), 'drop'],
  ] as const)('%s → %s', (_what, pending, state, want) => {
    expect(pendingJumpAction(pending, state)).toBe(want);
  });
});

describe('규정별 내보내기 진행 (T-215 8차)', () => {
  it('A 의 PDF 를 만드는 중이어도 B 의 버튼 글·PDF 항목은 그대로 — A 로 돌아오면 다시 진행 중으로 보인다', () => {
    const running = [runKey('pdf', 'A')];
    const pdf = (policyId: string) =>
      exportMenu({ t, asOfBlocked: false, busy: exportBusyFor(running, policyId), onPdf: noop, onHwpx: noop, onTxt: noop, onFullscreen: noop, onCopyUrl: noop }).find(
        (i) => i.key === 'pdf',
      ) as { label: string; disabled?: boolean };
    expect(exportBusyFor(running, 'B')).toEqual({ pdf: false, hwpx: false });
    expect(exportButtonLabel(t, exportBusyFor(running, 'B'))).toBe(ko['policyDetail.menu.export']);
    expect(pdf('B')).toMatchObject({ label: ko['policyDetail.export.pdf'], disabled: false });
    expect(exportBusyFor(running, 'A')).toEqual({ pdf: true, hwpx: false });
    expect(exportButtonLabel(t, exportBusyFor(running, 'A'))).toBe(ko['policyDetail.export.pdfBusy']);
    expect(pdf('A')).toMatchObject({ label: ko['policyDetail.export.pdfBusy'], disabled: true });
    expect(exportBusyFor(running, undefined)).toEqual({ pdf: false, hwpx: false });
  });

  it('같은 규정·같은 형식만 겹치지 않는다 — 다른 규정의 같은 형식은 시작할 수 있다', () => {
    const flight = usePolicyRunsStore.getState();
    flight.clear();
    expect(flight.start(runKey('pdf', 'A'))).toBe(true);
    expect(flight.start(runKey('pdf', 'A'))).toBe(false);
    expect(flight.start(runKey('pdf', 'B'))).toBe(true);
    expect(flight.start(runKey('hwpx', 'A'))).toBe(true);
    flight.clear();
  });

  it('훅: 진행은 화면 밖 저장소에 둔다 — useRuns 가 시작하면 목록에 들고, 끝나면 그 이름만 빠진다', () => {
    const lib = src('apps/web/src/lib/policyResult.ts');
    expect(lib).toContain('const start = useCallback((kind: RunKind, policyId: string, target?: string) => startKey(runKey(kind, policyId), target), [startKey]);');
    expect(lib).toContain('const end = useCallback((kind: RunKind, policyId: string) => endKey(runKey(kind, policyId)), [endKey]);');
    expect(lib).not.toMatch(/useState<string\[\]>/);
  });
});

describe('내보내기 실패 문구 — 할 일을 알린다 (T-215 8차)', () => {
  it.each([
    [500, 'policyDetail.export.pdfFailed'],
    [504, 'policyDetail.export.pdfFailed'],
    [404, 'policyDetail.export.notFound'],
    [408, 'policyDetail.export.pdfTryLater'],
    [429, 'policyDetail.export.pdfTryLater'],
    [413, 'policyDetail.export.pdfRejected'],
    [403, 'policyDetail.export.pdfRejected'],
    [undefined, 'policyDetail.export.pdfRequestFailed'],
  ] as const)('PDF %s → %s', (status, key) => {
    expect(exportFailedMessage(t, 'pdf', status)).toBe(t(key, { status: status ?? '' }));
  });

  it('한/글도 같은 갈래 — 잠시 뒤 다시는 오류 번호와 함께', () => {
    expect(exportFailedMessage(t, 'hwpx', 429)).toBe(t('policyDetail.export.hwpxTryLater', { status: 429 }));
    expect(exportFailedMessage(t, 'hwpx', 429)).toContain('429');
    expect(exportFailedMessage(t, 'hwpx', 404)).toBe(ko['policyDetail.export.notFound']);
  });
});

describe('지금 보는 규정 상자와 초안 일괄 시행·양식 저장 — 페이지 연결 (T-215 8차)', () => {
  it('상자는 그린 직후(같은 동기 구간)에 바꾸고, 화면이 내려가면 떠났다고 적는다', () => {
    const lib = src('apps/web/src/lib/policyResult.ts');
    expect(lib).toMatch(/useLayoutEffect\(\(\) => \{\s*box\.id = id;\s*\}\);/);
    expect(lib).toMatch(/useLayoutEffect\(\(\) => \{\s*box\.mounted = true;\s*return \(\) => \{\s*box\.mounted = false;\s*\};\s*\}, \[box\]\);/);
  });

  it('초안 일괄 시행은 시작한 규정(v.policyId)으로 다시 읽고 알린다 — 진행 중 콜백이 나중 그리기의 옵션으로 불려도', () => {
    const page = src('apps/web/src/pages/PolicyDetailPage.tsx');
    expect(page).toContain('versionsApi.publishDrafts(v.policyId, {');
    // 다시 읽기는 16차부터 lib/policyRefresh(본 조회만·로그아웃 뒤에는 알리지 않음) — 시작한 규정(v.policyId)으로 읽는 것은 그대로
    expect(page).toContain('await fetchPolicyNow(qc, v.policyId, inScope);');
    expect(page).toContain('setPublishDraftsForm((f) => (f?.policyId === v.policyId ? null : f));');
    expect(page).toContain("const done = t('policyDetail.publishDrafts.done', { n: res.published });");
    expect(page).toContain("if (fresh) reportResult(v.policyId, v.label, done, 'success', 4000);");
    expect(page).toMatch(
      /onError: \(err, v\) => \{\s*if \(dialogErrorTarget\(v\.policyId, shownPolicy, publishFormOf\.current\) === 'dialog'\) return;\s*reportResult\(v\.policyId, v\.label, publishFailedText\(err\), 'error'\);/,
    );
    // 시행 창은 연 규정에서만 그린다
    expect(page).toContain('{publishDraftsForm && publishDraftsForm.policyId === id && (');
    expect(page).toContain("setPublishDraftsForm({ policyId: id!, changeNote: '제정', effectiveDate: '' });");
    expect(page).toContain('publishDraftsMutation.mutate({ ...publishDraftsForm, label: policyLabel(policy) })');
    // 양식 저장 실패도 떠났으면 규정 이름을 붙인다
    expect(page).toContain(
      "toast(resultTarget(id ?? '', shownPolicy) === 'toolbar' ? message : t('policyDetail.result.forPolicy', { label: policyLabel(policy), message }), 'error');",
    );
  });
});
