import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * T-215 14차 적대적 검토 반영 — 진행은 다시 받기가 끝난 뒤에 푼다(#4 규정 정보·상태 전환, #5 첨부): 먼저 풀면 다시 그린 화면이 옛 값으로
 * 풀려 같은 작업을 다시 누르거나 그 사이 고친 값이 덮였다. 보낸 알림 설정도 그린다(#6). 조 순서 창 문구도 키로(#9).
 */
const api = vi.hoisted(() => ({ upload: vi.fn(), del: vi.fn() }));
vi.mock('../apps/web/src/api/policies', () => ({ filesApi: { upload: api.upload, delete: api.del }, policiesApi: {} }));
const { useAttachmentActions } = await import('../apps/web/src/components/policy-detail/useAttachmentActions');
const { usePolicyRunsStore } = await import('../apps/web/src/stores/policyRunsStore');
const { messages } = await import('../apps/web/src/i18n/messages');

function capture<T>(hook: () => T, client: QueryClient): T {
  let out: T | undefined;
  const C = () => {
    out = hook();
    return null;
  };
  const el: ReactElement = createElement(QueryClientProvider, { client }, createElement(C));
  renderToStaticMarkup(el);
  return out as T;
}
const flush = () => new Promise((r) => setTimeout(r, 0));
const src = (p: string) => readFileSync(join(__dirname, '..', p), 'utf8');
afterEach(() => {
  usePolicyRunsStore.getState().clear();
  vi.restoreAllMocks();
});

describe('진행은 다시 받기가 끝난 뒤에 푼다 (T-215 14차 #4·#5)', () => {
  it('첨부 지우기 — 목록을 다시 받는 동안은 지우는 중이 이어지고, 받고 나서 풀린다', async () => {
    const client = new QueryClient();
    let refetched: () => void = () => undefined;
    vi.spyOn(client, 'invalidateQueries').mockReturnValue(new Promise<void>((r) => (refetched = r)));
    api.del.mockResolvedValueOnce(undefined);
    capture(() => useAttachmentActions({ id: 'A', label: 'A-01', modalOpen: true, shown: { id: 'A', mounted: true }, report: vi.fn(), setError: vi.fn(), t: (k: string) => k }), client).remove('f-1');
    await flush();
    await flush();
    expect(usePolicyRunsStore.getState().running).toEqual(['deleteFile:A']);
    refetched();
    await flush();
    await flush();
    expect(usePolicyRunsStore.getState().running).toEqual([]);
  });

  it('규정 정보 저장·상태 전환 — 성공하면 이 규정을 다시 받은 뒤에 알린다(진행을 푸는 onSettled 는 onSuccess 를 기다린다 — 15차 #7, 16차: 본 조회만·로그아웃 뒤에는 알리지 않음)', () => {
    const page = src('apps/web/src/pages/PolicyDetailPage.tsx');
    // 17차 — 다시 받지 못했으면 화면이 옛 값이라고 덧붙인다. 18차 — 4초 뒤 사라지는 알림이 아니라 남는 자리(reportResult: 도구 줄,
    // 떠났으면 이름 붙은 알림)에
    expect(page).toMatch(
      /onSuccess: async \(_res, v\) => \{\s*(\/\/[^\n]*\n\s*)*const inScope = authScopeGuard\(\);\s*const fresh = await fetchPolicyNow\(qc, v\.routeId, inScope\);\s*if \(!inScope\(\)\) return;\s*if \(fresh\) reportInfo\(v, t\('policyDetail\.info\.saved'\), 'success'\);\s*(\/\/[^\n]*\n\s*)*else reportResult\(v\.routeId, v\.label, `\$\{t\('policyDetail\.info\.saved'\)\} \$\{t\('policyDetail\.result\.refreshFailed'\)\}`, 'error'\);/,
    );
    expect(page).toMatch(
      /const inScope = authScopeGuard\(\);\s*const fresh = await fetchPolicyNow\(qc, v\.routeId, inScope\);\s*if \(!inScope\(\)\) return;\s*if \(resultTarget\(v\.routeId, shownPolicy\) === 'toolbar'\) setActiveToggleTarget\(null\);\s*const done = t\(v\.next \? 'policyDetail\.status\.madeActive' : 'policyDetail\.status\.madeInactive'\);\s*if \(fresh\) reportInfo\(v, done, 'success', 3000\);\s*else reportResult\(v\.routeId, v\.label, `\$\{done\} \$\{t\('policyDetail\.result\.refreshFailed'\)\}`, 'error'\);/,
    );
  });

  it('보낸 알림 설정도 저장소에 두고 저장 중이면 그 값을 그린다(#6)', () => {
    const page = src('apps/web/src/pages/PolicyDetailPage.tsx');
    expect(page).toContain('effectiveDate: policyEffectiveDate || null, notify: revisionNotify };');
    expect(page).toContain('notify={infoSent?.notify ?? revisionNotify}');
  });
});

describe('조 순서 창 문구 키 (T-215 14차 #9)', () => {
  it('창의 문구는 키로 — 법령식 조·장 번호(제N조·제N장)만 남고, ko·en 이 짝을 이룬다', () => {
    const panel = src('apps/web/src/components/ArticleReorderPanel.tsx');
    for (const s of ['>조 순서 재정렬<', 'aria-label="닫기"', '끌어서 놓거나', '재정렬할 조가 없습니다', '개 조의 번호가 바뀝니다', "'바뀐 것이 없습니다'", '되돌리기\n', '취소\n', "'저장 중…'"]) expect(panel, s).not.toContain(s);
    const keys = ['open', 'close', 'howTo', 'crossChapter', 'numbering', 'linkWarn', 'linkWarnStrong', 'empty', 'noChapterTitle', 'up', 'down', 'moved', 'unchanged', 'revert', 'cancel', 'save', 'saving'];
    for (const k of keys) {
      const key = `policyDetail.reorder.${k}`;
      expect(messages.ko[key], key).toBeTruthy();
      expect(messages.en[key], key).toBeTruthy();
      expect(panel, key).toContain(`'${key}'`);
    }
    // 이미 있던 Chrome 묶음이 쓰는 한국어 이름은 그대로(제N조 아래로·저장·취소)
    expect(messages.ko['policyDetail.reorder.down']).toBe('제{n}조 아래로');
  });
});
