import { QueryClient, QueryObserver } from '@tanstack/react-query';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * T-224 단계 B(설계 D3·E1~E10) — 본문 안 쓰기 하나(runWrite): 같은 규정·같은 종류가 돌면 시작하지 않고(①), 끝나면 규정 본문과 기다릴
 * 조회(판 목록)를 다시 받은 뒤에(③) 결과를 알리고 진행을 푼다. 성공은 같은 번호의 창을 닫고(진행을 풀기 전) 대상 붙은 완료 문구, 거절은
 * 그 창이 열려 있으면 창 안에, 응답 없음·5xx 는 다시 받은 값으로 반영 여부를 본다. 결과 자리는 조문 배너 → 도구 줄 → 이름 붙은 알림(②).
 */
const api = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('../apps/web/src/api/policies', () => ({ policiesApi: { get: api.get } }));
const { runWrite, koreanReason, readMs } = await import('../apps/web/src/lib/policyWrite');
const { nextDialogToken, registerWriteDialog } = await import('../apps/web/src/lib/writeDialogs');
const { registerBanner } = await import('../apps/web/src/lib/articleBanner');
const { useToolStatus, subscribeClearStale } = await import('../apps/web/src/lib/toolStatus');
const { registerToolbar } = await import('../apps/web/src/lib/policyResult');
const { endAuthScope } = await import('../apps/web/src/lib/authScope');
const { useToastStore } = await import('../apps/web/src/stores/toastStore');

const t = (k: string, v?: Record<string, string | number>) =>
  k === 'policyDetail.result.forPolicy' ? `${v?.label} — ${v?.message}` : v ? `${k}:${JSON.stringify(v)}` : k;
const VERS = ['versions', 'a1'];
const SUBJECT = (m: string) => `제3조 v4 — ${m}`;

function statusOf(order?: string[]) {
  const setMsg = vi.fn();
  const flash = vi.fn(() => order?.push('flash'));
  let status!: ReturnType<typeof useToolStatus>;
  const C = () => {
    status = useToolStatus(setMsg, flash);
    return null;
  };
  renderToStaticMarkup(createElement(C));
  return { status, flash, last: () => setMsg.mock.calls.at(-1)?.[0] };
}

function harness(shown = { id: 'P1', mounted: true }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const order: string[] = [];
  const bar = statusOf(order);
  const running = new Set<string>();
  const deps = {
    qc,
    shown,
    toolbar: bar.status,
    t,
    start: (k: string, p: string) => {
      if (running.has(`${k}:${p}`)) return false;
      running.add(`${k}:${p}`);
      order.push('start');
      return true;
    },
    end: (k: string, p: string) => {
      running.delete(`${k}:${p}`);
      order.push('end');
    },
  };
  return { qc, order, bar, running, deps };
}

/** 판 목록을 보는 화면처럼 조회를 붙잡아 둔다(다시 받기가 실제로 다시 받게) — server 는 받을 때의 서버 상태 */
async function watchVersions(qc: QueryClient, server: () => unknown[]) {
  const off = new QueryObserver(qc, { queryKey: VERS, queryFn: () => Promise.resolve(server()), retry: false }).subscribe(() => undefined);
  await vi.waitFor(() => expect(qc.getQueryData(VERS)).toBeDefined());
  return off;
}

function spec(over: Record<string, unknown> = {}) {
  return {
    kind: 'version' as never,
    policyId: 'P1',
    label: 'HR-01 취업규칙',
    target: 'approve:V1',
    articleId: 'a1',
    source: 'version:V1' as const,
    action: '시행 승인',
    call: vi.fn().mockResolvedValue({}),
    waitKeys: [VERS],
    sideKeys: () => [['policies']],
    subject: SUBJECT,
    done: () => '시행 승인했습니다.',
    refusedText: (err: unknown) => koreanReason(err) ?? '승인하지 못했습니다.',
    landed: (qc: QueryClient) => {
      const v = qc.getQueryData<{ id: string; status: string }[]>(VERS)?.find((x) => x.id === 'V1');
      return v ? v.status === 'published' : undefined;
    },
    ...over,
  };
}
const dialog = (order: string[]) => {
  const token = nextDialogToken();
  const controls = { token, setError: vi.fn(() => order.push('setError')), close: vi.fn(() => order.push('close')) };
  return { token, controls, off: registerWriteDialog('P1', 'approve', controls) };
};

beforeEach(() => vi.stubGlobal('window', globalThis)); // 알림 저장소는 window.setTimeout 을 쓴다(시험은 node)
afterEach(() => {
  vi.unstubAllGlobals();
  api.get.mockReset();
  useToastStore.getState().clear();
});

describe('쓰기 하나 — 시작·성공 (T-224 단계 B — runWrite)', () => {
  it('같은 규정·같은 종류가 돌고 있으면 시작하지 않는다 — 보내지도 않는다(①)', async () => {
    const h = harness();
    h.running.add('version:P1');
    const s = spec();
    expect(await runWrite(h.deps, s)).toBe(false);
    expect(s.call).not.toHaveBeenCalled();
  });

  it('성공 — 다시 받은 뒤 같은 번호의 창을 닫고(진행을 풀기 전) 대상 붙은 완료 문구, 곁 조회는 무효화만', async () => {
    const h = harness();
    let server = [{ id: 'V1', status: 'review' }];
    const off = await watchVersions(h.qc, () => server);
    api.get.mockResolvedValue({ id: 'P1' });
    const d = dialog(h.order);
    const invalidate = vi.spyOn(h.qc, 'invalidateQueries');
    const s = spec({ dialog: { kind: 'approve', token: d.token }, call: vi.fn(() => {
      server = [{ id: 'V1', status: 'published' }];
      h.order.push('call');
      return Promise.resolve({});
    }) });
    expect(await runWrite(h.deps, s)).toBe(true);
    expect(h.order).toEqual(['start', 'call', 'close', 'flash', 'end']);
    expect(h.bar.flash).toHaveBeenCalledWith('제3조 v4 — 시행 승인했습니다.', expect.any(Number));
    expect(api.get).toHaveBeenCalledWith('P1');
    expect(h.qc.getQueryData(VERS)).toEqual([{ id: 'V1', status: 'published' }]); // 판 목록도 다시 받았다
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['policies'] });
    d.off();
    off();
  });

  it('그 조문을 분절 보기로 보이는 배너가 있으면 결과는 배너에 — 도구 줄은 그대로', async () => {
    const h = harness();
    api.get.mockResolvedValue({ id: 'P1' });
    const banner = statusOf();
    const offBanner = registerBanner('P1', 'a1', banner.status);
    await runWrite(h.deps, spec({ waitKeys: [] }));
    expect(banner.flash).toHaveBeenCalledWith('제3조 v4 — 시행 승인했습니다.', expect.any(Number));
    expect(h.bar.flash).not.toHaveBeenCalled();
    offBanner();
  });

  it('성공하면 같은 판의 옛 실패 줄을 다른 자리(도구 줄·보이지 않는 배너)에서도 걷는다 — 결과가 간 자리만이 아니라(B1 검토)', async () => {
    const h = harness();
    api.get.mockResolvedValue({ id: 'P1' });
    h.bar.status.fail('제3조 v4 — 확인하지 못했습니다.', 'version:V1'); // 앞서 조문을 떠난 사이 끝난 실패
    h.bar.status.fail('PDF 를 만들지 못했습니다.');
    const banner = statusOf();
    const offBanner = registerBanner('P1', 'a1', banner.status);
    await runWrite(h.deps, spec({ waitKeys: [] }));
    expect(banner.flash).toHaveBeenCalledWith('제3조 v4 — 시행 승인했습니다.', expect.any(Number));
    expect(h.bar.last()).toBe('PDF 를 만들지 못했습니다.'); // 그 판의 줄만 걷혔다
    offBanner();
    const hidden = statusOf();
    hidden.status.fail('제3조 v4 — 승인하지 못했습니다.', 'version:V1'); // 분절 보기에서 남은 실패, 지금은 전문 보기(배너가 보이지 않는다)
    const offHidden = registerBanner('P1', 'a1', hidden.status, false);
    await runWrite(h.deps, spec({ waitKeys: [] }));
    expect(h.bar.status.isSticky()).toBe(true); // PDF 줄이 있어 성공은 알림으로
    expect(hidden.last()).toBe('');
    offHidden();
  });

  it('반영된 갈래는 모두(성공했지만 받지 못함, 5xx 뒤 반영 확인) 같은 판의 옛 줄을 다른 자리에서 걷고, 그 조문의 보이지 않는 배너는 비운다(B1 재검토 #1·#2)', async () => {
    const h = harness();
    const banner = statusOf();
    const offBanner = registerBanner('P1', 'a1', banner.status);
    const offSub = subscribeClearStale(h.qc, banner.status); // 화면의 배너처럼 받기 성공을 듣는다(useArticleBanner)
    h.bar.status.fail('제3조 v4 — 확인하지 못했습니다.', 'version:V1');
    api.get.mockRejectedValueOnce(new Error('down')); // 성공했지만 규정을 받지 못한다
    await runWrite(h.deps, spec({ waitKeys: [] }));
    expect(banner.last()).toBe('제3조 v4 — 시행 승인했습니다. policyDetail.result.refreshFailed');
    expect(h.bar.last()).toBe('');
    h.bar.status.fail('제3조 v4 — 확인하지 못했습니다.', 'version:V1');
    api.get.mockResolvedValue({ id: 'P1' });
    await runWrite(h.deps, spec({ waitKeys: [], landed: () => true, call: vi.fn().mockRejectedValue({ response: { status: 502 } }) }));
    expect(banner.last()).toBe('제3조 v4 — policyWrites.landed:{"action":"시행 승인"}'); // 다시 받아 앞 받기 실패 줄은 걷혔다
    expect(h.bar.last()).toBe('');
    offSub();
    offBanner();
    const hidden = statusOf();
    hidden.status.flash('제3조 v4 — 폐지 예정으로 정했습니다.', 0); // 보이지 않는 배너에 남은 옛 성공 글(줄이 아니다)
    const offHidden = registerBanner('P1', 'a1', hidden.status, false);
    await runWrite(h.deps, spec({ waitKeys: [] }));
    expect(hidden.last()).toBe('');
    offHidden();
  });

  it('실패는 다른 자리의 그 판 줄을 건드리지 않는다 — 앞 성공의 받기 실패 안내가 새 실패에 묻히지 않게', async () => {
    const h = harness();
    api.get.mockResolvedValue({ id: 'P1' });
    h.bar.status.failStale('제3조 v4 — 시행 승인했습니다. 다만 받아 오지 못했습니다.', [['policy', 'P1']], 'version:V1');
    const banner = statusOf();
    const off = registerBanner('P1', 'a1', banner.status);
    await runWrite(h.deps, spec({ waitKeys: [], call: vi.fn().mockRejectedValue({ response: { status: 400, data: { message: '이미 시행된 판입니다.' } } }) }));
    expect(banner.last()).toBe('제3조 v4 — 이미 시행된 판입니다.');
    expect(h.bar.last()).toBe('제3조 v4 — 시행 승인했습니다. 다만 받아 오지 못했습니다.');
    off();
  });

  it('반영 여부를 보는 사이 로그아웃했으면 알리지 않는다', async () => {
    const h = harness();
    api.get.mockResolvedValue({ id: 'P1' });
    const landed = vi.fn(() => {
      endAuthScope();
      return Promise.resolve(true);
    });
    await runWrite(h.deps, spec({ waitKeys: [], landed, call: vi.fn().mockRejectedValue({ response: { status: 502 } }) }));
    expect(landed).toHaveBeenCalled();
    expect(h.bar.last()).toBeUndefined();
    expect(h.order).toEqual(['start', 'end']);
  });

  it('성공했지만 규정을 다시 받지 못하면 낡음 표시(받지 못한 조회만) — 그 뒤 받으면 걷힌다', async () => {
    const h = harness();
    const offSub = subscribeClearStale(h.qc, h.bar.status); // 화면이 떠 있는 동안처럼
    const off = await watchVersions(h.qc, () => [{ id: 'V1', status: 'published' }]);
    api.get.mockRejectedValueOnce(new Error('down'));
    await runWrite(h.deps, spec());
    expect(h.bar.last()).toBe('제3조 v4 — 시행 승인했습니다. policyDetail.result.refreshFailed');
    expect(h.bar.status.isSticky()).toBe(true);
    await h.qc.fetchQuery({ queryKey: ['policy', 'P1'], queryFn: () => Promise.resolve({ id: 'P1' }) });
    expect(h.bar.status.isSticky()).toBe(false);
    off();
    offSub();
  });
});

describe('쓰기 하나 — 거절·응답 없음 (T-224 단계 B — runWrite)', () => {
  const refused = (message: string) => ({ response: { status: 400, data: { statusCode: 400, message } } });

  it('거절(4xx) — 같은 번호의 창이 열려 있으면 창 안에 서버의 한국어 문구, 창은 두고 결과 알림은 없다', async () => {
    const h = harness();
    api.get.mockResolvedValue({ id: 'P1' });
    const d = dialog(h.order);
    await runWrite(h.deps, spec({ dialog: { kind: 'approve', token: d.token }, waitKeys: [], call: vi.fn().mockRejectedValue(refused('검토 중인 버전만 승인할 수 있습니다.')) }));
    expect(d.controls.setError).toHaveBeenCalledWith('검토 중인 버전만 승인할 수 있습니다.');
    expect(d.controls.close).not.toHaveBeenCalled();
    expect(h.order).toEqual(['start', 'setError', 'end']);
    expect(h.bar.last()).toBeUndefined();
    d.off();
  });

  it('거절 — 창을 닫았거나 다시 열었으면(번호가 다르면) 대상 붙은 실패 줄, 영문 서버 문구는 쓰기의 대체 문구로', async () => {
    const h = harness();
    api.get.mockResolvedValue({ id: 'P1' });
    const d = dialog(h.order);
    await runWrite(h.deps, spec({ dialog: { kind: 'approve', token: d.token - 1 }, waitKeys: [], call: vi.fn().mockRejectedValue(refused('Only versions in review can be approved')) }));
    expect(d.controls.setError).not.toHaveBeenCalled();
    expect(h.bar.last()).toBe('제3조 v4 — 승인하지 못했습니다.');
    expect(h.bar.status.isSticky()).toBe(true);
    d.off();
  });

  it('응답 없음·5xx — 다시 받은 판이 기대 상태면 반영됐다고(창은 닫는다)', async () => {
    const h = harness();
    let server = [{ id: 'V1', status: 'review' }];
    const off = await watchVersions(h.qc, () => server);
    api.get.mockResolvedValue({ id: 'P1' });
    const d = dialog(h.order);
    await runWrite(h.deps, spec({ dialog: { kind: 'approve', token: d.token }, call: vi.fn(() => {
      server = [{ id: 'V1', status: 'published' }]; // 서버는 반영했는데 응답은 502
      return Promise.reject(Object.assign(new Error('bad gateway'), { response: { status: 502 } }));
    }) }));
    expect(d.controls.close).toHaveBeenCalled();
    expect(h.bar.last()).toBe('제3조 v4 — policyWrites.landed:{"action":"시행 승인"}');
    off();
    d.off();
  });

  it('응답 없음·5xx — 그대로면 확인하지 못했다고(서버 까닭과 함께), 다시 받지 못했어도 받기로 걷히는 줄이 아니다', async () => {
    const h = harness();
    const off = await watchVersions(h.qc, () => [{ id: 'V1', status: 'review' }]);
    api.get.mockResolvedValue({ id: 'P1' });
    await runWrite(h.deps, spec({ call: vi.fn().mockRejectedValue({ response: { status: 500, data: { message: '잠금을 기다리다 끝났습니다' } } }) }));
    expect(h.bar.last()).toBe('제3조 v4 — policyWrites.unknownWhy:{"action":"시행 승인","reason":"잠금을 기다리다 끝났습니다"}');
    const h2 = harness();
    const failStale = vi.spyOn(h2.bar.status, 'failStale');
    api.get.mockReset();
    api.get.mockRejectedValue(new Error('down'));
    await runWrite(h2.deps, spec({ waitKeys: [], call: vi.fn().mockRejectedValue(new Error('network')) }));
    expect(h2.bar.last()).toBe('제3조 v4 — policyWrites.unknown:{"action":"시행 승인"}');
    expect(failStale).not.toHaveBeenCalled();
    off();
  });

  it('응답 없음·5xx 뒤 규정 본문을 다시 받지 못했으면 반영 여부를 판정하지 않는다 — 판 목록이 기대 상태여도 확인하지 못했다고', async () => {
    const h = harness();
    const off = await watchVersions(h.qc, () => [{ id: 'V1', status: 'published' }]);
    api.get.mockRejectedValue(new Error('down'));
    await runWrite(h.deps, spec({ call: vi.fn().mockRejectedValue(new Error('network')) }));
    expect(h.bar.last()).toBe('제3조 v4 — policyWrites.unknown:{"action":"시행 승인"}');
    off();
  });

  it('보내는 사이 로그아웃했으면 받지도 알리지도 않고 진행만 푼다 — 곁 조회도 건드리지 않는다', async () => {
    const h = harness();
    api.get.mockResolvedValue({ id: 'P1' });
    const invalidate = vi.spyOn(h.qc, 'invalidateQueries');
    await runWrite(h.deps, spec({ waitKeys: [], call: vi.fn(() => {
      endAuthScope();
      return Promise.resolve({});
    }) }));
    expect(api.get).not.toHaveBeenCalled();
    expect(invalidate).not.toHaveBeenCalled(); // 다음 사용자의 캐시에 앞 사용자의 쓰기로 다시 받기를 걸지 않는다
    expect(h.order).toEqual(['start', 'end']);
    expect(h.bar.last()).toBeUndefined();
    expect(useToastStore.getState().items).toEqual([]);
  });

  it('시작한 화면이 내려갔으면 같은 규정을 다시 그린 화면의 도구 줄로, 그것도 없으면 규정 이름 붙은 알림', async () => {
    const h = harness({ id: 'P1', mounted: false });
    api.get.mockResolvedValue({ id: 'P1' });
    const redrawn = statusOf();
    const offBar = registerToolbar('P1', redrawn.status);
    const redrawnBanner = statusOf();
    const offBanner = registerBanner('P1', 'a1', redrawnBanner.status); // 다시 그린 화면이 그 조문을 분절 보기로 보이면 배너가 먼저
    await runWrite(h.deps, spec({ waitKeys: [] }));
    expect(redrawnBanner.flash).toHaveBeenCalledWith('제3조 v4 — 시행 승인했습니다.', expect.any(Number));
    expect(redrawn.flash).not.toHaveBeenCalled();
    offBanner();
    await runWrite(h.deps, spec({ waitKeys: [] }));
    expect(redrawn.flash).toHaveBeenCalledWith('제3조 v4 — 시행 승인했습니다.', expect.any(Number));
    offBar();
    await runWrite(h.deps, spec({ waitKeys: [] }));
    expect(useToastStore.getState().items.map((i) => i.message)).toEqual(['HR-01 취업규칙 — 제3조 v4 — 시행 승인했습니다.']);
    expect(h.bar.flash).not.toHaveBeenCalled();
  });

  it('머무는 시간은 글 길이에 따라 3~10초 — 긴 폐지·철회 안내를 다 읽게', () => {
    expect(readMs('짧은 글')).toBe(3000);
    expect(readMs('가'.repeat(60))).toBe(4500);
    expect(readMs('가'.repeat(400))).toBe(10000);
  });
});
