import { describe, expect, it, vi } from 'vitest';
import { exportButtonLabel, exportMenu, moreMenu, viewMenu, type ViewMenuInput } from '../apps/web/src/lib/policyToolMenus';
import { flattenMenu, selectEffect } from '../apps/web/src/lib/menuKeys';
import { roleCanOpen } from '../apps/web/src/lib/viewerAccess';
import { messages } from '../apps/web/src/i18n/messages';

/**
 * T-215 규정 상세 도구 메뉴 셋(SRS POLICY-13 ②⑥) — 역할·플랜·시점 조회·진행 상태별 항목 구성(순수 함수).
 */
const ko = messages.ko as Record<string, string>;
const t = (k: string, v?: Record<string, string | number>) => (ko[k] ?? k).replace(/\{(\w+)\}/g, (_, n) => String(v?.[n] ?? `{${n}}`));
// 메뉴 항목 — 부품(.tsx) 타입 대신 함수가 돌려주는 꼴로 본다
type MenuItem = ReturnType<typeof exportMenu>[number];
type Leaf = { kind: string; key: string };
const leaves = (items: MenuItem[]) => flattenMenu(items as unknown as (Leaf | { kind: 'group'; items: Leaf[] })[]);
const byKey = (items: MenuItem[], key: string) => leaves(items).find((i) => i.key === key)!;
const noop = () => undefined;

const exportInput = (over: Partial<Parameters<typeof exportMenu>[0]> = {}) => ({
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

describe('내보내기 메뉴 (T-215)', () => {
  it('PDF·한/글·전문 .txt·전체화면·인쇄·주소 복사 — 고르면 닫힌다', () => {
    const items = exportMenu(exportInput());
    expect(leaves(items).map((i) => i.key)).toEqual(['pdf', 'hwpx', 'txt', 'fullscreen', 'copyUrl']);
    for (const i of leaves(items)) expect(selectEffect(i as never).close, i.key).toBe(true);
    expect((byKey(items, 'hwpx') as { hint?: string }).hint).toBe(ko['policyDetail.export.hwpxHint']);
  });

  it('시점 본문 준비 전에는 파일·전체화면을 막고 이유를 보인다 — 주소 복사는 막지 않는다', () => {
    const items = exportMenu(exportInput({ asOfBlocked: true }));
    for (const key of ['pdf', 'hwpx', 'txt', 'fullscreen']) {
      const it = byKey(items, key) as { disabled?: boolean; disabledReason?: string };
      expect(it.disabled, key).toBe(true);
      expect(it.disabledReason, key).toBe(ko['asOfView.exportBlocked']);
      expect(selectEffect(it as never).run, key).toBe(false);
    }
    expect((byKey(items, 'copyUrl') as { disabled?: boolean }).disabled).toBeFalsy();
  });

  it('만드는 중인 파일은 그 항목만 막고 버튼 글이 진행 문구가 된다 — 끝날 때까지 다시 실행되지 않는다', () => {
    const items = exportMenu(exportInput({ busy: { pdf: true, hwpx: false } }));
    const pdf = byKey(items, 'pdf') as { disabled?: boolean; label: string };
    expect(pdf.disabled).toBe(true);
    expect(pdf.label).toBe(ko['policyDetail.export.pdfBusy']);
    expect((byKey(items, 'hwpx') as { disabled?: boolean }).disabled).toBeFalsy();
    expect(exportButtonLabel(t, { pdf: true, hwpx: false })).toBe(ko['policyDetail.export.pdfBusy']);
    expect(exportButtonLabel(t, { pdf: false, hwpx: true })).toBe(ko['policyDetail.export.hwpxBusy']);
    expect(exportButtonLabel(t, { pdf: false, hwpx: false })).toBe(ko['policyDetail.menu.export']);
  });

  it('항목을 고르면 그 동작을 부른다', () => {
    const input = exportInput();
    const items = exportMenu(input);
    (byKey(items, 'fullscreen') as { onSelect: () => void }).onSelect();
    (byKey(items, 'copyUrl') as { onSelect: () => void }).onSelect();
    expect(input.onFullscreen).toHaveBeenCalledOnce();
    expect(input.onCopyUrl).toHaveBeenCalledOnce();
  });
});

const viewInput = (over: Partial<ViewMenuInput> = {}): ViewMenuInput => ({
  t,
  scale: { percent: 100, canSmaller: true, canLarger: true, isDefault: true },
  onScale: vi.fn(),
  a11yOn: false,
  onToggleA11y: vi.fn(),
  templates: { feature: true, list: [{ id: 'a', name: '기업 양식', isDefault: true }, { id: 'b', name: '간이 양식' }], selectedId: 'b', onSelect: vi.fn(), onPro: vi.fn() },
  onDictionary: noop,
  ...over,
});

describe('보기 설정 메뉴 (T-215)', () => {
  it('글자 크기 세 단계는 고른 뒤에도 열려 있다(이어서 누른다), 끝에 닿으면 그 단계만 막는다', () => {
    const items = viewMenu(viewInput({ scale: { percent: 130, canSmaller: true, canLarger: false, isDefault: false } }));
    for (const key of ['smaller', 'reset', 'larger']) expect(selectEffect(byKey(items, key) as never).close, key).toBe(false);
    expect((byKey(items, 'larger') as { disabled?: boolean }).disabled).toBe(true);
    expect((byKey(items, 'smaller') as { disabled?: boolean }).disabled).toBe(false);
    expect((byKey(items, 'reset') as { label: string }).label).toBe('130% · 기본 크기로');
    expect((viewMenu(viewInput()).find((i) => i.key === 'font') as { kind: string }).kind).toBe('group');
    // 막히지 않은 단계도 고른 뒤 열려 있다(막힌 단계는 실행되지 않아 늘 열려 있으므로 따로 본다)
    const free = viewMenu(viewInput({ scale: { percent: 110, canSmaller: true, canLarger: true, isDefault: false } }));
    for (const key of ['smaller', 'reset', 'larger']) expect(selectEffect(byKey(free, key) as never), key).toEqual({ run: true, close: false, focusButton: false });
  });

  it('음성지원·접근성은 켜짐을 알리는 항목이고 고른 뒤에도 열려 있다', () => {
    const on = byKey(viewMenu(viewInput({ a11yOn: true })), 'a11y') as { kind: string; checked: boolean };
    expect(on).toMatchObject({ kind: 'checkbox', checked: true });
    expect((byKey(viewMenu(viewInput()), 'a11y') as { checked: boolean }).checked).toBe(false);
    expect(selectEffect(on as never).close).toBe(false);
  });

  it('적용 양식은 하나 고르기 묶음 — 기본 양식(자동)과 회사 양식, 고른 것에 표시', () => {
    const items = viewMenu(viewInput());
    const group = items.find((i) => i.key === 'template') as { kind: string; items: { key: string; kind: string; checked: boolean; label: string }[] };
    expect(group.kind).toBe('group');
    expect(group.items.map((i) => [i.key, i.kind, i.checked])).toEqual([
      ['tpl:', 'radio', false],
      ['tpl:a', 'radio', false],
      ['tpl:b', 'radio', true],
    ]);
    expect(group.items[1].label).toBe('기업 양식 (기본)');
  });

  it('양식이 없으면 막힌 안내 항목, 플랜이 양식을 못 쓰면 요금제 안내 항목', () => {
    const none = viewMenu(viewInput({ templates: { ...viewInput().templates, list: [] } }));
    expect(byKey(none, 'templateNone')).toMatchObject({ kind: 'action', disabled: true });
    const input = viewInput({ templates: { ...viewInput().templates, feature: false } });
    const pro = byKey(viewMenu(input), 'templatePro') as { onSelect: () => void; disabled?: boolean };
    expect(pro.disabled).toBeFalsy();
    pro.onSelect();
    expect(input.templates.onPro).toHaveBeenCalledOnce();
  });
});

describe('더보기 메뉴 — 열람자에게 허용 밖 경로가 없다 (T-215)', () => {
  const more = (role: string, canEdit: boolean) => moreMenu({ t, role, canEdit, policyId: 'p 1', onReasons: noop, onCrossCompare: noop });

  it('관리자·편집자: 제정·개정이유·규정 간 비교·규정체계도·원문 다시 가져오기', () => {
    for (const role of ['admin', 'editor']) {
      expect(more(role, true).map((i) => i.key), role).toEqual(['reasons', 'crossCompare', 'hierarchy', 'reimport']);
    }
    expect(byKey(more('admin', true), 'reimport')).toMatchObject({ kind: 'link', to: '/policies/import?target=p%201' });
  });

  it('열람자: 규정체계도·원문 다시 가져오기가 없고, 남은 링크는 모두 열 수 있다', () => {
    const items = more('viewer', false);
    expect(items.map((i) => i.key)).toEqual(['reasons', 'crossCompare']);
    // 편집 권한이 있다고 잘못 넘어와도 열람자 판정이 거른다
    expect(more('viewer', true).map((i) => i.key)).toEqual(['reasons', 'crossCompare']);
    for (const role of ['admin', 'editor', 'viewer']) {
      for (const link of leaves(more(role, role !== 'viewer')).filter((i) => i.kind === 'link')) {
        expect(roleCanOpen(role, (link as { to: string }).to.split('?')[0]), `${role} ${link.key}`).toBe(true);
      }
    }
  });
});
