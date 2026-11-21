import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import DropdownMenuItem, { type MenuLeaf } from '../apps/web/src/components/DropdownMenuItem';
import { DefaultPolicyRenderer } from '../apps/web/src/components/policy-template/TemplateRenderer';
import { buildEnterprisePolicyBodyHtml } from '../apps/web/src/components/policy-template/templateUtils';
import { TEMPLATE_ALLOWED_ATTRS } from '../apps/web/src/components/policy-template/templateSanitize';
import { seekAndScroll } from '../apps/web/src/components/policy-detail/useFullViewJump';
import { buildFullViewGroups } from '../apps/web/src/lib/fullViewGroups';
import { fullViewArticleSelector, planFullViewJump, resolveFullViewJump } from '../apps/web/src/lib/policyDetailLinks';
import { usePolicyRunsStore } from '../apps/web/src/stores/policyRunsStore';
import { flattenMenu } from '../apps/web/src/lib/menuKeys';
import { exportFailedMessage, exportMenu } from '../apps/web/src/lib/policyToolMenus';
import { messages } from '../apps/web/src/i18n/messages';

/**
 * T-215 적대적 검토 반영 — 열람자의 조문 이동(분절 보기 대신 전문 보기 스크롤), 적용 양식 저장 중 막기·'자동' 유지,
 * 시점 본문 실패 때 막힌 이유, 메뉴 항목 설명 연결, 내보내기 중복 실행 막기, 문구 키.
 */
const ROOT = join(__dirname, '..');
const src = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');
const ko = messages.ko as Record<string, string>;
const t = (k: string, v?: Record<string, string | number>) => (ko[k] ?? k).replace(/\{(\w+)\}/g, (_, n) => String(v?.[n] ?? `{${n}}`));
const noop = () => undefined;
type Leaf = { kind: string; key: string; disabled?: boolean; disabledReason?: string; checked?: boolean; onSelect?: () => void };
const leaves = (items: unknown[]) => flattenMenu(items as (Leaf | { kind: 'group'; items: Leaf[] })[]);
const byKey = (items: unknown[], key: string) => leaves(items).find((i) => i.key === key)!;

const pub = (content: string) => [{ status: 'published', content }];
const row = (over: Record<string, unknown>) => ({ branchNumber: null, clauseNumber: null, itemNumber: null, title: '', versions: [], ...over });
const groups = buildFullViewGroups([
  {
    id: 'c1',
    number: 1,
    title: '총칙',
    sections: [],
    articles: [
      row({ id: 'a3', number: 3, title: '정의', versions: pub('본 조') }),
      row({ id: 'a3-2', number: 3, branchNumber: 2, title: '특례', versions: pub('가지 조') }),
      row({ id: 'a4', number: 4, title: '요건' }),
      row({ id: 'a4-1', number: 4, clauseNumber: 1, versions: pub('첫째 항') }),
    ],
  },
]);

/** 클래스 선택자(`.tmpl-art-N`)에 맞는 여는 태그 — DOM 없이(클래스 토큰이 정확히 같아야 한다: tmpl-art-3 은 tmpl-art-3-2 가 아니다) */
function tagsMatching(markup: string, selector: string): string[] {
  const cls = selector.replace(/^\./, '');
  return [...markup.matchAll(/<[a-z]+\b[^>]*\bclass="([^"]*)"[^>]*>/g)].filter((m) => m[1].split(/\s+/).includes(cls)).map((m) => m[0]);
}

describe('조문 이동 — 전문 보기 안의 그 조로 (T-215 검토)', () => {
  const screen = renderToStaticMarkup(createElement(DefaultPolicyRenderer as never, { fullViewGroups: groups }));
  const exported = buildEnterprisePolicyBodyHtml(groups, '');

  it('선택자는 조 묶음 클래스 하나를 가리킨다 — 화면(React)과 HTML 양식이 같은 클래스를 달고, 양식 정화는 class 를 남긴다', () => {
    expect(fullViewArticleSelector({ number: 3 })).toBe('.tmpl-art-3');
    expect(fullViewArticleSelector({ number: 3, branchNumber: 2 })).toBe('.tmpl-art-3-2');
    expect(fullViewArticleSelector({ number: 0 })).toBeNull();
    for (const [name, markup] of [['화면', screen], ['HTML 양식', exported]] as const) {
      expect(tagsMatching(markup, fullViewArticleSelector({ number: 3 })!), name).toHaveLength(1);
      expect(tagsMatching(markup, fullViewArticleSelector({ number: 3, branchNumber: 2 })!), name).toHaveLength(1);
      // 항 행을 골라도 그 항이 든 조 묶음으로
      expect(tagsMatching(markup, fullViewArticleSelector({ number: 4, branchNumber: null })!), name).toHaveLength(1);
    }
    // 회사 HTML 양식은 정화(DOMPurify)를 거친다 — data-* 는 지우고(ALLOW_DATA_ATTR false) class 는 남긴다
    expect(TEMPLATE_ALLOWED_ATTRS).toContain('class');
  });

  it('갈 조는 지금 그려진 본문(시점 조회면 그 시점 본문)의 같은 행 번호로 — 그 본문에 없는 행이면 null(부르는 쪽이 알린다)', () => {
    const current = [{ articles: [{ id: 'r1', number: 3 }, { id: 'r2', number: 4 }, { id: 'new', number: 9 }] }];
    // 시점 본문 — 그 날짜에는 r1 이 제2조였고 new 는 없었다
    const asOf = [{ articles: [{ id: 'r1', number: 2 }, { id: 'r2', number: 4 }] }];
    expect(resolveFullViewJump('r1', current)).toEqual({ id: 'r1', number: 3, branchNumber: undefined });
    expect(resolveFullViewJump('r1', asOf)).toMatchObject({ id: 'r1', number: 2 });
    expect(resolveFullViewJump('new', asOf)).toBeNull();
    expect(resolveFullViewJump('r1', undefined)).toBeNull();
  });

  it('찾기 — 그려질 때까지 프레임마다 찾고, 찾으면 한 번 스크롤하고 끝, 끝까지 없으면 스크롤 없이 끝(다시 하지 않는다)', () => {
    const frames: (() => void)[] = [];
    const run = (appearAt: number | null) => {
      frames.length = 0;
      let calls = 0;
      const scrolled = vi.fn();
      const onEnd = vi.fn();
      seekAndScroll({
        find: () => (appearAt !== null && ++calls >= appearAt ? { scrollIntoView: scrolled } : null),
        requestFrame: (fn) => frames.push(fn),
        cancelFrame: noop,
        onEnd,
        maxFrames: 5,
      });
      while (frames.length) frames.shift()!();
      return { scrolled, onEnd };
    };
    const found = run(3);
    expect(found.scrolled).toHaveBeenCalledOnce();
    expect(found.onEnd).toHaveBeenCalledWith(true);
    const missing = run(null);
    expect(missing.scrolled).not.toHaveBeenCalled();
    expect(missing.onEnd).toHaveBeenCalledWith(false);
    expect(missing.onEnd).toHaveBeenCalledOnce();
    // 그만두면 다음 프레임을 거둔다
    const cancel = vi.fn();
    seekAndScroll({ find: () => null, requestFrame: () => 7, cancelFrame: cancel, onEnd: noop })();
    expect(cancel).toHaveBeenCalledWith(7);
  });

  it('이동 판정 — 시점 본문을 받는 중이면 보류, 그려진 본문에 없으면 알림, 아니면 그 본문 번호로', () => {
    const shown = [{ articles: [{ id: 'r1', number: 2 }] }];
    expect(planFullViewJump('r1', { asOfBlocked: true, shownChapters: shown })).toEqual({ kind: 'blocked' });
    // 실제로 막힌 동안에는 그려진 본문이 없다(viewPolicy 없음) — 그래도 '없음'이 아니라 보류
    expect(planFullViewJump('r1', { asOfBlocked: true, shownChapters: undefined })).toEqual({ kind: 'blocked' });
    expect(planFullViewJump('gone', { asOfBlocked: false, shownChapters: shown })).toEqual({ kind: 'missing' });
    expect(planFullViewJump('r1', { asOfBlocked: false, shownChapters: shown })).toMatchObject({ kind: 'go', target: { id: 'r1', number: 2 } });
  });

  it('페이지: 열람자는 분절 보기가 되지 않고(어느 길로 되어도 전문 보기로), 조문 선택·조문 링크·전문 보기의 목차가 같은 이동을 쓴다', () => {
    const page = src('apps/web/src/pages/PolicyDetailPage.tsx');
    expect(page).toMatch(/if \(!canUseSegmentMode && articleViewMode === 'segment'\) setArticleViewMode\('full'\);\s*\}, \[canUseSegmentMode, articleViewMode\]\);/);
    expect(page).toMatch(/const plan = planFullViewJump\(article\.id, \{ asOfBlocked, shownChapters: viewPolicy\?\.chapters \}\);/);
    // 받는 중이면 보류했다가 받은 뒤 다시(조문 링크처럼 다시 부를 길이 없을 때도)
    // 보류는 고른 규정과 함께 — 다른 규정으로 옮긴 뒤에는 앞 규정의 보류를 버린다
    expect(page).toMatch(/if \(plan\.kind === 'blocked'\) \{\s*setPendingJump\(\{ id: article\.id, policyId: id \}\);/);
    // 보류를 어떻게 할지는 lib/policyResult.pendingJumpAction(표 시험은 policyDetailResult) — 받는 중이면 기다리고, 옮겼으면 버린다
    expect(page).toMatch(/const act = pendingJumpAction\(pendingJump, \{ asOfBlocked, fullView: articleViewMode === 'full', id \}\);\s*if \(act === 'none' \|\| act === 'wait'\) return;\s*setPendingJump\(null\);\s*if \(act === 'run' && pendingJump\) jumpInFullView\(pendingJump\);/);
    expect(page).toContain("t(asOfFailed ? 'policyDetail.jump.asOfFailed' : 'policyDetail.jump.asOfBlocked')");
    // 결과는 시작한 규정에 묶어 알린다(lib/policyResult.deliverResult) — 성공은 잠깐, 실패는 남기고, 떠났으면 그 규정 이름을 붙인 화면 전체 알림
    expect(page).toContain("reportResult(id, label, exportDoneMessage('policyDetail.export.pdfDone'), 'success', 3000);");
    expect(page).toContain("reportResult(id, label, exportDoneMessage('policyDetail.export.hwpxDone'), 'success', 4000);");
    expect(page).toMatch(/finally \{\s*endRun\('pdf', id\);\s*\}/);
    expect(page).toMatch(/finally \{\s*endRun\('hwpx', id\);\s*\}/);
    expect(page).toContain('const flashToolMsg = useFlashMessage(setLawToolMsg);');
    expect(page).toContain('[asOfBlocked, asOfFailed, viewPolicy, jumpFullView, t, id]');
    expect(page).toContain('const shownPolicy = useShownPolicy(id);');
    // T-227: 글의 종류(실패는 붉은 계열)를 함께 알린다
    expect(page).toContain('const toolStatus = useToolStatus(setLawToolMsg, flashToolMsg, setLawToolKind);');
    expect(page).toContain('lawToolKind={lawToolKind}');
    expect(page).toContain('const reportResult = useReportResult(shownPolicy, toolStatus, t);');
    expect(page).toMatch(/\} catch \(err: any\) \{\s*reportResult\(id, label, exportFailedMessage\(t, 'pdf', err\?\.response\?\.status\), 'error'\);\s*\} finally \{/);
    expect(page).toMatch(/\} catch \(err: any\) \{\s*reportResult\(id, label, exportFailedMessage\(t, 'hwpx', err\?\.response\?\.status\), 'error'\);\s*\} finally \{/);
    // 지금 규정이 아니라고 결과를 버리는 꼴(7차)은 남지 않는다
    expect(page).not.toContain('shownPolicy.current');
    expect(page).toMatch(/\} catch \{\s*\/\/[^\n]*\n\s*toolStatus\.failNow\(t\('policyDetail\.export\.copyFailed'\)\);\s*\}\s*\}, \[t, toolStatus\]\);/);
    // 성공·안내 알림은 잠깐 — 전문 .txt·주소 복사·글자 크기도 같은 함수
    for (const call of [
      "toolStatus.flash(t('policyDetail.export.txtDone'), 2500);",
      "toolStatus.flash(t('policyDetail.export.copied'), 2500);",
      "toolStatus.flash(t('policyDetail.viewMenu.fontNow', { n: next }), 2500);",
      "toolStatus.show(t('policyDetail.export.pdfMaking'));",
      "toolStatus.show(t('policyDetail.export.hwpxMaking'));",
    ]) {
      expect(page, call).toContain(call);
    }
    // 알림을 무조건 지우는 곳은 규정을 옮길 때 하나뿐이다(타이머로 지우는 꼴은 어떤 모양이든 없다)
    // 도구 줄은 상태 묶음(toolStatus)으로만 쓰고, 무조건 지우는 곳은 없다 — 규정을 옮기면 화면이 새로 그려져 비는 것은
    // policyDetailAsync(11차 — 규정 id 로 key)
    expect(page).not.toMatch(/toolStatus\.clear\(\)/);
    expect(page).not.toMatch(/setLawToolMsg\(/);
    expect(page).not.toMatch(/setTimeout\([^;]*setLawToolMsg\(/);
    expect(page).toMatch(/if \(!canUseSegmentMode\) \{\s*\/\/[^\n]*\n\s*setSelectedArticle\(found\.hit\);\s*jumpInFullView\(found\.hit\);\s*return;\s*\}/);
    // 열람자의 조문 선택은 목차와 같은 길 — 강조·주소·선택 칸이 한 값(selectedArticle)
    expect(page).toMatch(/if \(!canUseSegmentMode\) \{\s*\/\/[^\n]*\n\s*setArticleViewMode\('full'\);\s*selectTocArticle\(art\);\s*return;\s*\}/);
    expect(page).toContain("if (articleViewMode === 'full') jumpInFullView(article);");
    expect(page).toContain("jump={{ value: selectedArticle?.id || '', options: flatArticlesForJump, onJump: jumpToArticle }}");
    // 훅: 끝난 요청은 다시 하지 않고, 끝까지 못 찾으면 알린다
    const hook = src('apps/web/src/components/policy-detail/useFullViewJump.ts');
    expect(hook).toContain('if (!target || target.at === done.current) return;');
    expect(hook).toMatch(/onEnd: \(found\) => \{\s*done\.current = target\.at;\s*if \(!found\) missing\.current\?\.\(\);/);
  });
});

describe('내보내기 — 막힌 이유·연결·중복 실행 (T-215 검토)', () => {
  const input = (over: Record<string, unknown> = {}) => ({
    t,
    asOfBlocked: false,
    busy: { pdf: false, hwpx: false },
    onPdf: vi.fn(),
    onHwpx: vi.fn(),
    onTxt: vi.fn(),
    onFullscreen: vi.fn(),
    onCopyUrl: vi.fn(),
    ...over,
  });

  it('시점 본문을 받지 못했으면 기다리라는 말 대신 할 일(다시 시도·현행으로)을 이유로 보인다', () => {
    const failed = exportMenu(input({ asOfBlocked: true, asOfFailed: true }));
    for (const key of ['pdf', 'hwpx', 'txt', 'fullscreen']) expect(byKey(failed, key).disabledReason, key).toBe(ko['policyDetail.export.blockedFailed']);
    const loading = exportMenu(input({ asOfBlocked: true, asOfFailed: false }));
    expect(byKey(loading, 'pdf').disabledReason).toBe(ko['asOfView.exportBlocked']);
  });

  it('항목마다 제 동작을 부른다 — PDF·한/글·전문 .txt', () => {
    const i = input();
    const items = exportMenu(i);
    byKey(items, 'pdf').onSelect!();
    expect(i.onPdf).toHaveBeenCalledOnce();
    byKey(items, 'hwpx').onSelect!();
    expect(i.onHwpx).toHaveBeenCalledOnce();
    byKey(items, 'txt').onSelect!();
    expect(i.onTxt).toHaveBeenCalledOnce();
    expect(i.onPdf).toHaveBeenCalledOnce();
  });

  it('실패 문구 — 만들다 실패(500)는 다시 해 볼 일, 거절은 상태 번호와 관리자 안내, 응답이 없으면 연결 확인(서버 까닭은 Blob 이라 읽지 않는다)', () => {
    expect(exportFailedMessage(t, 'pdf', 500)).toBe(ko['policyDetail.export.pdfFailed']);
    // 게이트웨이·시간 초과(502·504)도 서버 쪽 실패 — 다시 해 볼 일
    expect(exportFailedMessage(t, 'pdf', 504)).toBe(ko['policyDetail.export.pdfFailed']);
    expect(exportFailedMessage(t, 'hwpx', 413)).toBe(t('policyDetail.export.hwpxRejected', { status: 413 }));
    expect(exportFailedMessage(t, 'hwpx', 413)).toContain('413');
    expect(exportFailedMessage(t, 'pdf', undefined)).toBe(ko['policyDetail.export.pdfRequestFailed']);
    // 페이지는 이 문구를 결과 알림으로 보낸다(시작한 규정을 보고 있으면 도구 줄에 남기고, 떠났으면 화면 전체 알림)
    const page = src('apps/web/src/pages/PolicyDetailPage.tsx');
    expect(page).toContain("reportResult(id, label, exportFailedMessage(t, 'pdf', err?.response?.status), 'error');");
    expect(page).toContain("reportResult(id, label, exportFailedMessage(t, 'hwpx', err?.response?.status), 'error');");
  });

  it('같은 이름의 작업은 끝나기 전에 다시 시작하지 않는다 — 다른 이름은 따로', () => {
    const flight = usePolicyRunsStore.getState();
    flight.clear();
    expect(flight.start('pdf')).toBe(true);
    expect(flight.start('pdf')).toBe(false);
    expect(flight.start('hwpx')).toBe(true);
    flight.end('pdf');
    expect(flight.start('pdf')).toBe(true);
    flight.clear();
  });

  it('페이지: PDF·한/글 함수가 스스로 그 규정의 진행 중인지 보고, 끝나면(실패해도) 푼다 — 진행 표시는 지금 규정 것만', () => {
    const page = src('apps/web/src/pages/PolicyDetailPage.tsx');
    expect(page).toMatch(/const downloadPdf = useCallback\(async \(\) => \{\s*if \(!policy \|\| !id \|\| asOfBlocked \|\| !startRun\('pdf', id\)\) return;/);
    expect(page).toMatch(/const downloadHwpx = useCallback\(async \(\) => \{\s*if \(!policy \|\| !id \|\| asOfBlocked \|\| !startRun\('hwpx', id\)\) return;/);
    expect(page).toMatch(/finally \{\s*endRun\('pdf', id\);/);
    expect(page).toMatch(/finally \{\s*endRun\('hwpx', id\);/);
    expect(page).toContain('const { running: runs, start: startRun, end: endRun, targetOf: runTarget } = useRuns();');
    expect(page).toContain('const exportBusy = exportBusyFor(runs, id);');
    expect(page).not.toMatch(/isExportingPdf|isExportingHwpx|exportFlight/);
  });
});

describe('메뉴 항목 설명·접근성 (T-215 검토)', () => {
  const render = (item: MenuLeaf) => renderToStaticMarkup(createElement(DropdownMenuItem, { item, highlighted: false, itemRef: noop, onSelect: noop, onHover: noop, onFocus: noop }));
  /** 이름 계산에 드는 글 — aria-hidden 을 뺀 버튼 안 글 */
  const nameOf = (markup: string) => markup.replace(/<span[^>]*aria-hidden="true"[^>]*>[\s\S]*?<\/span>/g, '').replace(/<[^>]+>/g, '');

  it('항목 아래 안내는 이름이 아니라 설명(aria-describedby)으로 읽힌다', () => {
    const markup = render({ kind: 'action', key: 'hwpx', label: '한/글 저장', onSelect: noop, hint: '한/글 2014 이상에서 열립니다' });
    const id = markup.match(/aria-describedby="([^"]+)"/)?.[1];
    expect(id).toBeTruthy();
    expect(markup).toMatch(new RegExp(`<span id="${id}" aria-hidden="true"[^>]*>한/글 2014 이상에서 열립니다</span>`));
    expect(nameOf(markup)).toBe('한/글 저장');
  });

  it('막히면 안내 대신 이유를 설명으로, 막힌 radio 도 aria-disabled', () => {
    const action = render({ kind: 'action', key: 'pdf', label: 'PDF', onSelect: noop, hint: '안내', disabled: true, disabledReason: '이유' });
    expect(action).toContain('aria-disabled="true"');
    expect(action).toContain('>이유</span>');
    expect(action).not.toContain('>안내</span>');
    const radio = render({ kind: 'radio', key: 'tpl:', label: '자동', checked: true, onSelect: noop, disabled: true, disabledReason: '저장 중' });
    expect(radio).toContain('role="menuitemradio"');
    expect(radio).toContain('aria-disabled="true"');
    expect(radio).toMatch(/aria-describedby="[^"]+"/);
    expect(nameOf(radio)).toBe('자동');
    expect(render({ kind: 'radio', key: 'x', label: 'x', checked: false, onSelect: noop })).not.toContain('aria-describedby');
  });

  it('글자 크기 항목 이름은 기호 없이 읽힌다, 패널은 열린 채 창·폭이 바뀌어도 다시 잰다', () => {
    for (const k of ['policyDetail.viewMenu.fontSmaller', 'policyDetail.viewMenu.fontLarger']) expect(ko[k], k).not.toMatch(/[−+가]\s|^가/);
    // 다시 재는 일은 lib/usePanelFit 하나다(T-226 에서 DropdownMenu 에서 떼어 냄) — DropdownMenu 가 그것을 부른다
    expect(src('apps/web/src/components/DropdownMenu.tsx')).toContain('usePanelFit(panelRef, state.open);');
    const fit = src('apps/web/src/lib/usePanelFit.ts');
    expect(fit).toContain("window.addEventListener('resize', fit)");
    expect(fit).toContain('new ResizeObserver(fit)');
  });
});

describe('문구 키·한 정의 (T-215 검토)', () => {
  const page = src('apps/web/src/pages/PolicyDetailPage.tsx');

  it('목차 숨김 안내는 좌측 탭으로 옮긴 것을 다 적고(완료 정의 ③), 요금제 안내 항목은 묶음과 같은 이름(적용 양식)을 쓴다', () => {
    for (const w of ['연혁', '부칙', '별표', '서식']) expect(ko['policyDetail.toc.showHint'], w).toContain(w);
    expect(ko['policyDetail.viewMenu.templatePro']).toContain(ko['policyDetail.viewMenu.templateGroup']);
  });

  it('저장·상태 전환·내보내기 결과 문구를 페이지에 직접 적지 않는다', () => {
    for (const s of ["'저장했습니다.'", '비활성으로 표시했습니다', '시행중으로 되돌렸습니다', 'PDF를 내려받았습니다', '한/글 문서(.hwpx)를 내려받았습니다', '현재 페이지 주소를 복사했습니다', 'PDF를 만드는 중입니다', '전문 텍스트(.txt)를 내려받았습니다']) {
      expect(page, s).not.toContain(s);
    }
    expect(page).toContain("exportDoneMessage('policyDetail.export.pdfDone')");
    expect(page).toContain("exportDoneMessage('policyDetail.export.hwpxDone')");
  });

  it('목차 패널 id 는 한 상수, 좌측 탭은 고른 탭을 aria-pressed 로 알린다', () => {
    expect(page).toContain('id={POLICY_TOC_PANEL_ID}');
    expect(page).not.toContain('id="policy-toc-panel"');
    for (const tab of ['toc', 'history', 'appendices']) expect(page, tab).toContain(`aria-pressed={leftSidebarTab === '${tab}'}`);
  });
});
