import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import PolicyTopBar from '../apps/web/src/components/policy-detail/PolicyTopBar';
import PolicyHeaderCard from '../apps/web/src/components/policy-detail/PolicyHeaderCard';
import PolicyInfoEdit from '../apps/web/src/components/policy-detail/PolicyInfoEdit';
import PolicyToolbar from '../apps/web/src/components/policy-detail/PolicyToolbar';
import PolicyAsOfBar from '../apps/web/src/components/policy-detail/PolicyAsOfBar';
import { exportMenu, moreMenu, viewMenu } from '../apps/web/src/lib/policyToolMenus';
import { backToListLink } from '../apps/web/src/lib/policyDetailLinks';
import { messages } from '../apps/web/src/i18n/messages';
import { policyDetailMessages } from '../apps/web/src/i18n/messages.policyDetail';

/**
 * T-215 규정 상세 머리·도구 영역(SRS POLICY-13) — 위쪽 줄·머리 카드·도구 줄을 그려 본다(서버 그리기, 메뉴는 닫힌 상태).
 * 탭 멈춤 수는 완료 정의 ⑤의 규칙으로 센다: 현행 보기·시점 조회 안 함·안내 띠 없음·개정 시점이 있는 규정·메뉴 닫힘, 붙은 입력
 * (전문/분절, 시점 날짜·개정 시점)은 1, 메뉴 버튼은 각 1, 목차 토글·좌측 탭·본문 안 버튼은 세지 않는다.
 */
const ROOT = join(__dirname, '..');
const src = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');
const ko = messages.ko as Record<string, string>;
const t = (k: string, v?: Record<string, string | number>) => (ko[k] ?? k).replace(/\{(\w+)\}/g, (_, n) => String(v?.[n] ?? `{${n}}`));
const html = (el: ReactElement) => renderToStaticMarkup(createElement(MemoryRouter, null, el));
const noop = () => undefined;

/** 탭 키가 멈추는 요소 — 링크(href)·버튼·select·input. tabindex=-1·비활성은 빼다 */
function tabStops(markup: string): string[] {
  return [...markup.matchAll(/<(a|button|select|input)\b([^>]*)>/g)]
    .filter(([, tag, attrs]) => !/tabindex="-1"/.test(attrs) && !/\sdisabled=""/.test(attrs) && (tag !== 'a' || /\shref=/.test(attrs)))
    .map((m) => m[0]);
}

function shell(role: 'admin' | 'editor' | 'viewer') {
  const canEdit = role !== 'viewer';
  const top = html(createElement(PolicyTopBar, { role, title: '취업규칙', viewMode: 'full', tocVisible: true, onToggleToc: noop }));
  const infoEdit = createElement(PolicyInfoEdit, {
    isActive: true,
    onRequestToggleActive: noop,
    revisionDate: '',
    onRevisionDate: noop,
    effectiveDate: '',
    onEffectiveDate: noop,
    saving: false,
    onSave: noop,
    message: null,
    notify: { enabled: false, groupIds: [], userIds: [] },
    onNotify: noop,
    groups: [],
    users: [],
  });
  const head = html(
    createElement(PolicyHeaderCard, {
      code: 'HR-01',
      title: '취업규칙',
      isActive: true,
      canEdit,
      revisionDate: '2025-03-01',
      effectiveDate: '2025-04-01',
      filesCount: 2,
      onOpenAttachments: noop,
      infoEdit,
    }),
  );
  const tools = html(
    createElement(PolicyToolbar, {
      lawToolMsg: null,
      view: { mode: 'full', canSegment: canEdit, onChange: noop },
      jump: { value: '', options: [{ id: 'a1', label: '제1조(목적)' }], onJump: noop },
      compare: { hasDates: true, onOldNew: noop, onThreeWay: noop },
      menus: {
        exportLabel: t('policyDetail.menu.export'),
        exportItems: exportMenu({ t, asOfBlocked: false, busy: { pdf: false, hwpx: false }, onPdf: noop, onHwpx: noop, onTxt: noop, onFullscreen: noop, onCopyUrl: noop }),
        viewItems: viewMenu({
          t,
          scale: { percent: 100, canSmaller: true, canLarger: true, isDefault: true },
          onScale: noop,
          a11yOn: false,
          onToggleA11y: noop,
          templates: { feature: true, list: [], selectedId: '', onSelect: noop, onPro: noop },
          onDictionary: noop,
        }),
        moreItems: moreMenu({ t, role, canEdit, policyId: 'p1', onReasons: noop, onCrossCompare: noop }),
      },
      asOf: createElement(PolicyAsOfBar, {
        asOfDate: '',
        onPick: noop,
        onClear: noop,
        effectiveDates: ['2025-04-01'],
        today: '2026-11-19',
        info: null,
        failed: false,
        loading: false,
        onRetry: noop,
      }),
      a11yPanel: null,
    }),
  );
  return { top, head, tools };
}

/** 규칙대로 센 탭 멈춤 — 위쪽 줄은 목록 링크만(목차 토글 제외), 붙은 입력은 1 */
function countStops(role: 'admin' | 'editor' | 'viewer') {
  const { top, head, tools } = shell(role);
  const topLinks = tabStops(top).filter((s) => s.startsWith('<a'));
  const toolStops = tabStops(tools);
  const viewButtons = toolStops.filter((s) => /aria-pressed=/.test(s)).length; // 전문/분절 — 붙은 입력 1
  const asOfInputs = toolStops.filter((s) => /id="policy-as-of"|aria-label="본문이 바뀐 시행일로 이동"/.test(s)).length; // 시점 날짜·개정 시점 — 1
  return topLinks.length + tabStops(head).length + toolStops.length - Math.max(0, viewButtons - 1) - Math.max(0, asOfInputs - 1);
}

describe('탭 멈춤 수 — 열람자 10개, 관리자·편집자 12개 이하 (T-215)', () => {
  it('열람자 10: 목록 링크·첨부파일·전문 보기·조문 선택·시점 조회·신구조문대비표·3단비교·메뉴 셋', () => {
    expect(countStops('viewer')).toBe(10);
  });

  it('분절 보기는 관리자·편집자만 — 열람자 도구 줄에는 전문 보기 하나', () => {
    expect(shell('viewer').tools).not.toContain(ko['policyDetail.view.segment']);
    expect(shell('viewer').tools.match(/aria-pressed=/g) ?? []).toHaveLength(1);
    expect(shell('editor').tools).toContain(ko['policyDetail.view.segment']);
  });

  it('관리자·편집자 11: 위에 규정 정보 편집 하나(전문/분절은 붙은 입력 1)', () => {
    expect(countStops('editor')).toBe(11);
    expect(countStops('admin')).toBe(11);
  });

  it('메뉴가 닫혀 있으면 메뉴 항목은 그려지지 않고, 날짜·알림 입력은 규정 정보 편집이 접혀 있어 탭에 걸리지 않는다', () => {
    const { head, tools } = shell('admin');
    expect(tools).not.toContain('role="menu"');
    expect(head).not.toContain('type="date"');
    const toggle = head.match(/<button[^>]*data-testid="policy-info-edit-toggle"[^>]*>/)?.[0] ?? '';
    expect(toggle).toContain('aria-expanded="false"');
    expect(toggle).not.toContain('aria-controls');
  });
});

describe('위쪽 줄·머리 카드 (T-215)', () => {
  it('목록 링크는 하나 — 열람자는 통합검색, 관리자·편집자는 규정 목록', () => {
    expect(backToListLink('viewer')).toEqual({ to: '/search', labelKey: 'layout.nav.search' });
    expect(backToListLink('editor')).toEqual({ to: '/policies', labelKey: 'layout.nav.policies' });
    const viewer = shell('viewer').top;
    expect([...viewer.matchAll(/<a\b[^>]*href="([^"]+)"/g)].map((m) => m[1])).toEqual(['/search']);
    expect(viewer).toContain(ko['layout.nav.search']);
    expect([...shell('admin').top.matchAll(/<a\b[^>]*href="([^"]+)"/g)].map((m) => m[1])).toEqual(['/policies']);
  });

  it('목차 토글은 목차가 보일 때만 aria-controls 를 단다(숨기면 패널이 없다), 숨긴 때는 연혁·부칙 탭으로 가는 길을 보이는 글로 알린다', () => {
    const hidden = html(createElement(PolicyTopBar, { role: 'admin', title: 'x', viewMode: 'full', tocVisible: false, onToggleToc: noop }));
    expect(hidden).not.toContain('aria-controls');
    // 터치 화면에서도 보이게 title 이 아니라 버튼 아래 글 — 버튼 설명(aria-describedby)으로도 잇는다
    const hint = hidden.match(/<p id="([^"]+)"[^>]*>([^<]+)<\/p>/);
    expect(hint?.[2]).toBe(ko['policyDetail.toc.showHint']);
    expect(hidden).toMatch(new RegExp(`<button[^>]*aria-describedby="${hint?.[1]}"`));
    const shown = shell('admin').top;
    expect(shown).toContain('aria-controls="policy-toc-panel"');
    expect(shown).not.toContain(ko['policyDetail.toc.showHint']);
    expect(shown).not.toContain('aria-describedby');
  });

  it('현재 위치(nav)에 목록 링크와 규정 제목(aria-current)이 함께 있다', () => {
    const nav = shell('editor').top.match(/<nav\b[\s\S]*?<\/nav>/)?.[0] ?? '';
    expect(nav).toContain('data-testid="policy-back-link"');
    expect(nav).toMatch(/aria-current="page"[^>]*>취업규칙</);
  });

  it('저장된 개정일·시행일 글줄은 모든 역할에게, 관리자·편집자는 그 아래 규정 정보 편집(접힘) — 상태 전환·날짜 입력·알림은 그 안에', () => {
    for (const role of ['viewer', 'editor', 'admin'] as const) {
      expect(shell(role).head, role).toMatch(/개정일 2025[.\-년 ]+0?3[.\-월 ]+0?1/);
    }
    const viewer = shell('viewer').head;
    expect(viewer).not.toContain(ko['policyDetail.info.toggle']);
    const admin = shell('admin').head;
    expect(admin).toContain(ko['policyDetail.info.toggle']);
    expect(admin).not.toContain(ko['policyDetail.status.makeInactive']);
    // 결과 알림 영역은 문구가 없어도 늘 있다(문구와 함께 생기는 영역은 화면 읽기 프로그램이 놓친다)
    expect(admin).toMatch(/<span class="[^"]*sr-only[^"]*" role="status"><\/span>/);
  });

  it('저장·상태 전환 결과 문구는 접힌 채로도 보인다', () => {
    const edit = html(
      createElement(PolicyInfoEdit, {
        isActive: false,
        onRequestToggleActive: noop,
        revisionDate: '',
        onRevisionDate: noop,
        effectiveDate: '',
        onEffectiveDate: noop,
        saving: false,
        onSave: noop,
        message: '저장했습니다.',
        notify: { enabled: false, groupIds: [], userIds: [] },
        onNotify: noop,
        groups: [],
        users: [],
      }),
    );
    expect(edit).toMatch(/role="status"[^>]*>저장했습니다\./);
  });
});

describe('도구 줄 — 중복 정리와 결과 알림 (T-215)', () => {
  it('도구 줄에 전체화면·연혁·부칙·파일별 내려받기 버튼이 없고(메뉴·좌측 탭·첨부파일 창으로), 메뉴 버튼 셋은 메뉴를 연다', () => {
    const { tools } = shell('admin');
    for (const word of ['전체화면', '연혁', '부칙·별표·서식', '표준국어대사전', '주소 복사', '규정체계도']) expect(tools, word).not.toContain(word);
    for (const id of ['policy-menu-export', 'policy-menu-view', 'policy-menu-more']) {
      expect(tools).toMatch(new RegExp(`<button[^>]*id="${id}"[^>]*aria-haspopup="menu"`));
    }
  });

  it('결과 알림은 상태 영역(role=status)에 — 화면 읽기 프로그램도 읽는다', () => {
    const tools = html(
      createElement(PolicyToolbar, {
        lawToolMsg: 'PDF 를 저장했습니다.',
        view: { mode: 'full', canSegment: false, onChange: noop },
        jump: { value: '', options: [], onJump: noop },
        compare: { hasDates: false, onOldNew: noop, onThreeWay: noop },
        menus: { exportLabel: 'x', exportItems: [], viewItems: [], moreItems: [] },
        asOf: null,
        a11yPanel: null,
      }),
    );
    expect(tools).toMatch(/role="status"[^>]*>PDF 를 저장했습니다\./);
    // 개정 시점이 없으면 신구조문대비표는 막고 이유를 붙인다
    expect(tools).toMatch(/disabled=""[^>]*title="시행일이 기록된 개정이 없어/);
  });

  it('규정 상세 페이지 — 옛 도구·중복이 남지 않고 파일별 내려받기는 첨부파일 창에 있다', () => {
    const page = src('apps/web/src/pages/PolicyDetailPage.tsx');
    // 전체화면 창을 여는 곳은 내보내기 메뉴의 한 함수뿐(머리 카드 '전체화면 전문'과 도구 줄 '전체화면·인쇄'가 하나로)
    expect(page.match(/setShowFullTextModal\(true\)/g) ?? []).toHaveLength(1);
    expect(page).not.toContain('규정 목록으로');
    expect(page).not.toMatch(/setLeftSidebarTab\('history'\);\s*setTocOpen\(true\);/);
    expect(page).not.toContain("openPolicyFile(f, 'download')");
    expect(page).toContain("onClick={() => void openPolicyFile(file, 'download')}");
    expect(page).toContain('<PolicyToolbar');
    expect(page).toContain('<PolicyHeaderCard');
    expect(page).toContain('<PolicyTopBar');
  });
});

describe('구조·문구 (T-215)', () => {
  it('새 파일은 300줄 이하', () => {
    for (const f of ['PolicyTopBar', 'PolicyHeaderCard', 'PolicyInfoEdit', 'PolicyToolbar', 'PolicyAsOfBar']) {
      const n = src(`apps/web/src/components/policy-detail/${f}.tsx`).split('\n').length;
      expect(n, f).toBeLessThanOrEqual(300);
    }
    for (const f of [
      'apps/web/src/lib/policyToolMenus.ts',
      'apps/web/src/components/policy-detail/useFullViewJump.ts',
      'apps/web/src/components/policy-detail/useTemplateSelection.ts',
      'apps/web/src/stores/policyRunsStore.ts',
    ]) {
      expect(src(f).split('\n').length, f).toBeLessThanOrEqual(300);
    }
  });

  it('화면별 문구 파일의 키는 ko·en 짝이 맞고, messages.ts 가 뒤에서 덮지 않는다', () => {
    expect(Object.keys(policyDetailMessages.en).sort()).toEqual(Object.keys(policyDetailMessages.ko).sort());
    for (const [k, v] of Object.entries(policyDetailMessages.ko)) expect(messages.ko[k], k).toBe(v);
    for (const [k, v] of Object.entries(policyDetailMessages.en)) expect(messages.en[k], k).toBe(v);
  });

  it('새 부품에 한국어 문구를 직접 적지 않는다(주석 밖)', () => {
    for (const f of ['PolicyTopBar', 'PolicyHeaderCard', 'PolicyInfoEdit', 'PolicyToolbar', 'PolicyAsOfBar']) {
      const code = src(`apps/web/src/components/policy-detail/${f}.tsx`)
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/.*$/gm, '')
        .replace(/\{\/\*[\s\S]*?\*\/\}/g, '');
      expect(code, f).not.toMatch(/[가-힣]/);
    }
  });
});
