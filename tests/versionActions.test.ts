import { QueryClient } from '@tanstack/react-query';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * T-224 단계 B(설계 E1·E2·E4·E11·E13) — 판 전환 다섯(시행 승인·반려·폐지·폐지 예정 취소·시행 예정 철회)을 useVersionActions 로 옮겼다.
 * 누를 때의 규정·조문·판을 잡아 끝까지 쓰고, 결과 글에 조문 표기와 판 번호를 붙이며, 초안 일괄 시행과 서로 막는다. 응답 없음·5xx 뒤
 * 반영 여부는 다시 받은 판의 상태로 본다.
 */
const api = vi.hoisted(() => ({ get: vi.fn(), list: vi.fn(), approve: vi.fn(), reject: vi.fn(), archive: vi.fn(), cancelRepeal: vi.fn(), withdraw: vi.fn() }));
vi.mock('../apps/web/src/api/policies', () => ({
  policiesApi: { get: api.get },
  versionsApi: { list: api.list, approve: api.approve, reject: api.reject, archive: api.archive, cancelRepeal: api.cancelRepeal, withdraw: api.withdraw },
}));
const { useVersionActions, versionLocked, landedState, archivedText } = await import('../apps/web/src/components/policy-detail/useVersionActions');
const { useToolStatus } = await import('../apps/web/src/lib/toolStatus');
const { usePolicyRunsStore } = await import('../apps/web/src/stores/policyRunsStore');
const { runKey } = await import('../apps/web/src/lib/policyResult');
const { nextDialogToken, registerWriteDialog } = await import('../apps/web/src/lib/writeDialogs');
const { serviceToday } = await import('../apps/web/src/lib/serviceDate');
const { messages } = await import('../apps/web/src/i18n/messages');

const ko = messages.ko as Record<string, string>;
const t = (k: string, v?: Record<string, string | number>) => (ko[k] ?? k).replace(/\{(\w+)\}/g, (_, n) => String(v?.[n] ?? `{${n}}`));
/** 창을 연 때의 조문 — 대상에 실어 넘긴다 */
const A1 = { articleId: 'a1', articleLabel: '제3조(수당)' };
const later = (days: number) => new Date(Date.parse(`${serviceToday()}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10);

function setup() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const setMsg = vi.fn();
  const flash = vi.fn();
  const store = usePolicyRunsStore.getState();
  const o = {
    policyId: 'P1',
    label: 'HR-01 취업규칙',
    qc,
    shown: { id: 'P1', mounted: true },
    toolbar: undefined as unknown as ReturnType<typeof useToolStatus>,
    t,
    start: (k: string, p: string, target?: string) => store.start(runKey(k as never, p), target),
    end: (k: string, p: string) => store.end(runKey(k as never, p)),
  };
  let actions!: ReturnType<typeof useVersionActions>;
  const C = () => {
    o.toolbar = useToolStatus(setMsg, flash);
    actions = useVersionActions(o);
    return null;
  };
  renderToStaticMarkup(createElement(C));
  return { qc, o, flash, last: () => setMsg.mock.calls.at(-1)?.[0], actions: () => actions, rerender: () => renderToStaticMarkup(createElement(C)) };
}

beforeEach(() => {
  vi.stubGlobal('window', globalThis);
  api.get.mockResolvedValue({ id: 'P1' });
});
afterEach(() => {
  vi.unstubAllGlobals();
  for (const f of Object.values(api)) f.mockReset();
  usePolicyRunsStore.getState().clear();
});

describe('판 전환 — 보내는 값과 완료 문구 (T-224 단계 B — useVersionActions)', () => {
  it('시행 승인 — 누를 때의 판으로 보내고, 결과 글에 조문 표기와 판 번호, 미래 시행일이면 그날부터 시행된다고', async () => {
    const s = setup();
    api.approve.mockResolvedValue({});
    await s.actions().approve({ versionId: 'V1', versionNum: 4, ...A1, changeNote: '사유', effectiveDate: undefined });
    expect(api.approve).toHaveBeenCalledWith('V1', { changeNote: '사유', effectiveDate: undefined });
    expect(s.flash).toHaveBeenLastCalledWith('제3조(수당) v4 — 시행 승인했습니다.', expect.any(Number));
    const day = later(10);
    await s.actions().approve({ versionId: 'V1', versionNum: 4, ...A1, changeNote: '사유', effectiveDate: day });
    expect(s.flash).toHaveBeenLastCalledWith(`제3조(수당) v4 — 시행 승인했습니다 — ${day}부터 시행되고, 그때까지는 지금 본문이 시행 중입니다.`, expect.any(Number));
  });

  it('반려·폐지 예정 취소·철회 — API 와 문구, 철회가 개정 후보를 되돌렸으면 그 안내를 붙이고 후보 화면·목록도 무효화', async () => {
    const s = setup();
    api.reject.mockResolvedValue({});
    await s.actions().reject({ versionId: 'V2', versionNum: 2, ...A1, reason: '고칠 것' });
    expect(api.reject).toHaveBeenCalledWith('V2', '고칠 것');
    expect(s.flash).toHaveBeenLastCalledWith('제3조(수당) v2 — 초안으로 되돌렸습니다. 반려 사유가 버전에 기록됩니다.', expect.any(Number));
    api.cancelRepeal.mockResolvedValue({});
    await s.actions().cancelRepeal({ versionId: 'V3', versionNum: 3, ...A1 });
    expect(api.cancelRepeal).toHaveBeenCalledWith('V3');
    expect(s.flash).toHaveBeenLastCalledWith('제3조(수당) v3 — 폐지 예정을 취소했습니다 — 이 조문은 그대로 시행됩니다.', expect.any(Number));
    const invalidate = vi.spyOn(s.qc, 'invalidateQueries');
    api.withdraw.mockResolvedValue({ restoredVersionId: null, candidateId: 'C9', withdrawnEffectiveDate: '2027-01-01' });
    await s.actions().withdraw({ versionId: 'V5', versionNum: 5, ...A1, reason: '재검토' });
    expect(api.withdraw).toHaveBeenCalledWith('V5', '재검토');
    expect(s.flash).toHaveBeenLastCalledWith(`제3조(수당) v5 — 시행 예정(2027-01-01)을 철회했습니다 — 그 버전은 초안으로 돌아갔고, 지금 본문이 그대로 시행됩니다. ${ko['versionWithdraw.candidateReopened']}`, expect.any(Number));
    for (const queryKey of [['policies'], ['amendments'], ['amendment', 'C9']]) expect(invalidate).toHaveBeenCalledWith({ queryKey });
  });

  it('폐지의 완료 문구 — 미래면 폐지 예정, 날짜가 있으면 그날부터 빠짐, 게시본이 남지 않았으면 덧붙임', () => {
    const day = later(5);
    expect(archivedText({ repealedOn: `${day}T00:00:00.000Z`, remainingPublished: 1 }, t)).toBe(t('policyWrites.version.archiveScheduled', { date: day }));
    expect(archivedText({ repealedOn: serviceToday(), remainingPublished: 1 }, t)).toBe(`폐지했습니다 — ${serviceToday()}부터 시행에서 빠집니다.`);
    expect(archivedText({ repealedOn: serviceToday(), remainingPublished: 0 }, t)).toBe(`폐지했습니다 — ${serviceToday()}부터 시행에서 빠집니다. ${ko['policyWrites.version.archivedLast']}`);
    expect(archivedText(undefined, t)).toBe('폐지했습니다.');
  });
});

describe('판 전환 — 누를 때의 값·막힘·반영 판정 (T-224 단계 B)', () => {
  it('대상에 실린 조문으로 보낸다 — 훅은 고른 조문을 읽지 않는다(다시 받는 판 목록·결과 글이 그 조문의 것)', async () => {
    const s = setup();
    let release!: (v: unknown) => void;
    api.approve.mockReturnValue(new Promise((r) => (release = r)));
    const invalidate = vi.spyOn(s.qc, 'invalidateQueries');
    const pending = s.actions().approve({ versionId: 'V1', versionNum: 4, ...A1, changeNote: '사유' });
    release({});
    await pending;
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['versions', 'a1'] });
    expect(invalidate).not.toHaveBeenCalledWith({ queryKey: ['versions', 'a2'] });
    expect(s.flash).toHaveBeenLastCalledWith('제3조(수당) v4 — 시행 승인했습니다.', expect.any(Number));
  });

  it('응답 없음·5xx 뒤 반영 판정은 그 조문의 판 목록을 새로 받아 본다 — 보는 화면이 없어 캐시에 누를 때의 값이 남아 있어도(B1 검토)', async () => {
    const s = setup();
    s.qc.setQueryData(['versions', 'a1'], [{ id: 'V1', status: 'review' }]); // 누를 때의 값(보는 화면이 없어 다시 받지 않는다)
    api.list.mockResolvedValue([{ id: 'V1', status: 'published' }]); // 서버는 반영했다
    api.approve.mockRejectedValue({ response: { status: 502 } });
    await s.actions().approve({ versionId: 'V1', versionNum: 4, ...A1, changeNote: '사유' });
    expect(api.list).toHaveBeenCalledWith('a1');
    expect(s.last()).toBe(`제3조(수당) v4 — ${t('policyWrites.landed', { action: '시행 승인' })}`);
    api.list.mockRejectedValue(new Error('down')); // 새로 받지 못하면 모른다
    await s.actions().approve({ versionId: 'V1', versionNum: 4, ...A1, changeNote: '사유' });
    expect(s.last()).toBe(`제3조(수당) v4 — ${t('policyWrites.unknown', { action: '시행 승인' })}`);
  });

  it('다시 보내면 창 안의 앞 거절 문구를 걷는다(B1 재검토 #5)', async () => {
    const s = setup();
    const token = nextDialogToken();
    const controls = { token, setError: vi.fn(), close: vi.fn() };
    const off = registerWriteDialog('P1', 'approve', controls);
    api.approve.mockResolvedValue({});
    await s.actions().approve({ versionId: 'V1', versionNum: 4, ...A1, token, changeNote: '사유' });
    expect(controls.setError.mock.calls[0]).toEqual([null]);
    off();
  });

  it('시작하지 못하면(다른 판 쓰기·초안 일괄 시행이 도는 중) 창 안에 까닭을 보인다 — 아무 말 없이 무시되지 않게(B1 검토)', async () => {
    const s = setup();
    const token = nextDialogToken();
    const controls = { token, setError: vi.fn(), close: vi.fn() };
    const off = registerWriteDialog('P1', 'approve', controls);
    usePolicyRunsStore.getState().start(runKey('publish', 'P1'));
    expect(await s.actions().approve({ versionId: 'V1', versionNum: 4, ...A1, token, changeNote: '사유' })).toBe(false);
    expect(controls.setError).toHaveBeenLastCalledWith(ko['policyWrites.lockedPublish']);
    usePolicyRunsStore.getState().end(runKey('publish', 'P1'));
    usePolicyRunsStore.getState().start(runKey('version', 'P1'), 'reject:V2');
    expect(await s.actions().approve({ versionId: 'V1', versionNum: 4, ...A1, token, changeNote: '사유' })).toBe(false);
    expect(controls.setError).toHaveBeenLastCalledWith(ko['policyWrites.locked']);
    expect(api.approve).not.toHaveBeenCalled();
    off();
  });

  it('한 규정에서 판 쓰기는 한 번에 하나, 초안 일괄 시행이 도는 동안은 시작하지 않는다 — 막힘은 여는 단추와 창이 같이 본다', async () => {
    const s = setup();
    usePolicyRunsStore.getState().start(runKey('publish', 'P1'));
    expect(await s.actions().approve({ versionId: 'V1', versionNum: 4, ...A1, changeNote: '사유' })).toBe(false);
    expect(api.approve).not.toHaveBeenCalled();
    expect(versionLocked(usePolicyRunsStore.getState().running, 'P1')).toBe(true);
    usePolicyRunsStore.getState().end(runKey('publish', 'P1'));
    usePolicyRunsStore.getState().start(runKey('version', 'P1'), 'reject:V2');
    expect(await s.actions().approve({ versionId: 'V1', versionNum: 4, ...A1, changeNote: '사유' })).toBe(false);
    expect(versionLocked(usePolicyRunsStore.getState().running, 'P1')).toBe(true);
    expect(versionLocked(usePolicyRunsStore.getState().running, 'P2')).toBe(false); // 다른 규정은 막지 않는다
  });

  it('거절 — 시작할 때 잡은 번호의 창이 열려 있으면 창 안에(영문 서버 문구는 쓰기의 대체 문구로)', async () => {
    const s = setup();
    const token = nextDialogToken();
    const controls = { token, setError: vi.fn(), close: vi.fn() };
    const off = registerWriteDialog('P1', 'archive', controls);
    api.archive.mockRejectedValue({ response: { status: 400, data: { message: 'Only published versions can be archived' } } });
    await s.actions().archive({ versionId: 'V1', versionNum: 4, ...A1, token });
    expect(controls.setError).toHaveBeenCalledWith(ko['policyWrites.version.archiveFailed']);
    expect(s.flash).not.toHaveBeenCalled();
    api.reject.mockRejectedValue({ response: { status: 400, data: { message: '반려 사유를 적어 주세요.' } } });
    const rejectToken = nextDialogToken();
    const offReject = registerWriteDialog('P1', 'reject', { token: rejectToken, setError: controls.setError, close: controls.close });
    await s.actions().reject({ versionId: 'V2', versionNum: 2, ...A1, reason: ' ', token: rejectToken });
    expect(controls.setError).toHaveBeenLastCalledWith('반려 사유를 적어 주세요.'); // 서버의 한국어 문구는 그대로
    offReject();
    off();
  });

  it('응답 없음·5xx 뒤 반영 판정은 다시 받은 판의 상태로 — 쓰기마다 기대 상태(E4)', () => {
    expect(landedState.approve({ id: 'V', status: 'published' })).toBe(true);
    expect(landedState.approve({ id: 'V', status: 'review' })).toBe(false);
    expect(landedState.approve({ id: 'V', status: 'draft' })).toBe(false); // 그 사이 반려됐다 — 우리 승인이 반영된 것이 아니다
    expect(landedState.reject({ id: 'V', status: 'draft' })).toBe(true);
    expect(landedState.reject({ id: 'V', status: 'review' })).toBe(false);
    expect(landedState.archive({ id: 'V', status: 'archived' })).toBe(true);
    expect(landedState.archive({ id: 'V', status: 'published' })).toBe(false);
    expect(landedState.cancelRepeal({ id: 'V', status: 'published', repealedOn: null })).toBe(true);
    expect(landedState.cancelRepeal({ id: 'V', status: 'archived', repealedOn: null })).toBe(true); // 다른 판이 시행 중이면 서버는 archived 를 둔다
    expect(landedState.cancelRepeal({ id: 'V', status: 'archived', repealedOn: '2027-01-01' })).toBe(false);
    expect(landedState.cancelRepeal({ id: 'V', status: 'published', repealedOn: '2027-01-01' })).toBe(false); // 폐지일이 남아 있다
    expect(landedState.withdraw({ id: 'V', status: 'draft' })).toBe(true);
    expect(landedState.withdraw({ id: 'V', status: 'published' })).toBe(false);
  });
});

describe('페이지 연결 (T-224 단계 B)', () => {
  const page = readFileSync(join(__dirname, '..', 'apps/web/src/pages/PolicyDetailPage.tsx'), 'utf8');
  it('판 전환 다섯은 페이지의 useMutation 이 아니고, 조문 배너는 훅 — 옛 띠 상태·창 상태가 남지 않는다', () => {
    for (const name of ['approveMutation', 'rejectMutation', 'archiveMutation', 'cancelRepealMutation', 'withdrawMutation', 'versionActionMsg', 'approveTargetId', 'rejectTargetId']) {
      expect(page, name).not.toContain(name);
    }
    expect(page).toContain("const banner = useArticleBanner(qc, id, selectedArticle?.id, articleViewMode === 'segment' && !!selectedArticle);");
    expect(page).toMatch(/const versionActions = useVersionActions\(\{\s*policyId: id,\s*label: policyLabel\(policy\),\s*qc,/);
    // 창 대상에는 창을 연 때의 조문을 싣는다(B1 검토 — 창이 열린 사이 고른 조문이 바뀌거나 풀려도)
    // 표기는 지금 받은 조문으로(B1 재검토 #6)
    expect(page).toContain('const article = liveSelectedArticle ?? selectedArticle;');
    expect(page).toContain("return { id: v.id, versionNum: v.versionNum, articleId: article?.id ?? '', articleLabel: article ? articleRowHeading(article) : '' };");
    for (const dlg of ['rejectDlg.open(versionTargetOf(v))', 'archiveDlg.open(versionTargetOf(version))', 'approveDlg.open({ ...versionTargetOf(v), minDate: approveMinDate })', 'approveDlg.open({ ...versionTargetOf(version), minDate: approveMinDate })']) {
      expect(page, dlg).toContain(dlg);
    }
    // 확인은 창 대상의 조문으로 보낸다 — 고른 조문(selectedArticle)을 읽지 않는다(B1 재검토 #7)
    expect(page).toContain('articleId: approveDlg.target.articleId,');
    for (const dlg of ['rejectDlg', 'withdrawDlg', 'archiveDlg']) expect(page, dlg).toContain(`...versionTargetArgs(${dlg}.target)`);
    // 승인 창의 최소 시행일도 연 때의 값(B1 재검토 #4)
    expect(page).toContain('minDate={approveDlgMin}');
    expect(page).toContain('const approveDlgMin = approveDlg.target?.minDate ?? null;');
    expect(page).toContain("t('versionDialog.cancelRepeal')");
    expect(page).toContain('const versionLock = versionLocked(runs, id);');
  });

  it('판 단추 일곱(현황 목록 승인·반려, 판 카드 승인·반려·철회·폐지 예정 취소·폐지)은 판 쓰기·초안 일괄 시행이 도는 동안 막히고 까닭을 알린다, 폐지 예정 취소의 확인 문구는 키', () => {
    expect(page.match(/disabled=\{versionLock\}\s*title=\{versionLockTitle\}/g) ?? []).toHaveLength(7);
    expect(page).toContain("t('policyWrites.version.cancelRepealConfirm', { date: String(version.repealedOn).slice(0, 10) })");
    expect(page).toContain("runningNow('version', publishDraftsForm.policyId)");
  });

  it('창 넷은 컴포넌트 — 진행·막힘·창 안 실패를 이 규정의 것으로 넘기고, 확인은 창을 연 번호와 함께 보낸다', () => {
    for (const [dlg, action] of [['approveDlg', 'approve'], ['rejectDlg', 'reject'], ['withdrawDlg', 'withdraw'], ['archiveDlg', 'archive']]) {
      expect(page, dlg).toContain(`busy={versionRun === \`${action}:\${${dlg}.target.id}\`}`);
      expect(page, dlg).toContain(`error={${dlg}.error}`);
      expect(page, dlg).toContain(`token: ${dlg}.token`);
    }
    expect(page.match(/locked=\{versionLock\}/g) ?? []).toHaveLength(4);
  });
});
