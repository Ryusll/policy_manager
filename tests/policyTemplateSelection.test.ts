import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  TEMPLATE_SELECTION_INITIAL,
  isSavingTemplate,
  pickActiveTemplate,
  templateSelection,
  type TemplateSelectionAction,
  type TemplateSelectionState,
} from '../apps/web/src/components/policy-detail/useTemplateSelection';
import { flattenMenu, selectEffect } from '../apps/web/src/lib/menuKeys';
import { viewMenu } from '../apps/web/src/lib/policyToolMenus';
import { messages } from '../apps/web/src/i18n/messages';

/**
 * T-215 적용 양식(보기 설정 메뉴의 radio) — 1차 검토 #1(자동을 고르면 옛 양식으로 되돌아감)·#8(저장이 겹침)과 2차 검토 #3
 * (행동 시험) 반영. 고르기 상태는 useTemplateSelection 의 리듀서, 메뉴 항목은 policyToolMenus.viewMenu.
 */
const ko = messages.ko as Record<string, string>;
const t = (k: string, v?: Record<string, string | number>) => (ko[k] ?? k).replace(/\{(\w+)\}/g, (_, n) => String(v?.[n] ?? `{${n}}`));
const noop = () => undefined;
type Leaf = { kind: string; key: string; disabled?: boolean; disabledReason?: string; checked?: boolean };
const byKey = (items: unknown[], key: string) => flattenMenu(items as (Leaf | { kind: 'group'; items: Leaf[] })[]).find((i) => i.key === key)!;
const list = [{ id: 'a', name: '기업 양식', isDefault: true }, { id: 'b', name: '간이 양식' }];
const menu = (over: Record<string, unknown>) =>
  viewMenu({
    t,
    scale: { percent: 100, canSmaller: true, canLarger: true, isDefault: true },
    onScale: noop,
    a11yOn: false,
    onToggleA11y: noop,
    templates: { feature: true, list, selectedId: '', onSelect: vi.fn(), onPro: noop, ...over },
    onDictionary: noop,
  });
const step = (state: TemplateSelectionState, ...actions: TemplateSelectionAction[]) => actions.reduce(templateSelection, state);
const server = (value: string, policyId = 'p1'): TemplateSelectionAction => ({ type: 'server', policyId, value });
const pick = (id: string, save = true, policyId = 'p1'): TemplateSelectionAction => ({ type: 'pick', policyId, id, save });
const saved = (policyId = 'p1'): TemplateSelectionAction => ({ type: 'saved', policyId });
const failed = (policyId = 'p1'): TemplateSelectionAction => ({ type: 'failed', policyId });
const savingOf = (s: TemplateSelectionState, policyId = 'p1') => isSavingTemplate(s, policyId);

describe('적용 양식 메뉴 — 저장 중 막기와 자동 표시 (T-215)', () => {
  it('저장하는 동안 양식 항목을 모두 막고 고른 항목 아래에만 이유 — 막힌 항목은 골라도 실행되지 않는다', () => {
    const items = menu({ selectedId: 'b', saving: true });
    for (const key of ['tpl:', 'tpl:a', 'tpl:b']) {
      const it = byKey(items, key);
      expect(it.disabled, key).toBe(true);
      expect(selectEffect(it as never), key).toEqual({ run: false, close: false, focusButton: false });
    }
    expect(byKey(items, 'tpl:b').disabledReason).toBe(ko['policyDetail.viewMenu.templateSaving']);
    expect(byKey(items, 'tpl:a').disabledReason).toBeUndefined();
    const idle = menu({ selectedId: 'b' });
    expect(byKey(idle, 'tpl:a').disabled).toBeFalsy();
    expect(selectEffect(byKey(idle, 'tpl:a') as never).run).toBe(true);
  });

  it("'' 는 기본 양식(자동)에 표시 — 규정에 양식을 지정하지 않은 상태", () => {
    const items = menu({ selectedId: '' });
    expect(byKey(items, 'tpl:').checked).toBe(true);
    expect(byKey(items, 'tpl:a').checked).toBe(false);
  });
});

describe('적용 양식 고르기 상태 (T-215)', () => {
  it("양식 A 가 지정된 규정에서 '자동'을 고르고 저장 → 다시 받은 서버 값('')으로도 '자동' 그대로(옛 양식으로 되돌아가지 않는다)", () => {
    const loaded = step(TEMPLATE_SELECTION_INITIAL, server('A'));
    expect(loaded).toMatchObject({ selected: 'A' });
    expect(savingOf(loaded)).toBe(false);
    const picking = step(loaded, pick(''));
    expect(picking).toMatchObject({ selected: '' });
    expect(savingOf(picking)).toBe(true);
    // 저장 중에 옛 값(A)으로 다시 받아도(창 포커스 등) 고른 값이 그대로
    const refetched = step(picking, server('A'));
    expect(refetched).toMatchObject({ selected: '' });
    expect(savingOf(refetched)).toBe(true);
    const done = step(picking, server(''), saved());
    expect(done).toMatchObject({ selected: '', server: '' });
    expect(savingOf(done)).toBe(false);
  });

  it('열람자가 화면에서만 바꾼 양식은 같은 서버 값을 다시 받아도 남고, 서버 값이 바뀌거나 다른 규정으로 옮기면 서버 값을 따른다', () => {
    const viewer = step(TEMPLATE_SELECTION_INITIAL, server(''), pick('B', false));
    expect(viewer).toMatchObject({ selected: 'B' });
    expect(savingOf(viewer)).toBe(false);
    expect(step(viewer, server(''))).toMatchObject({ selected: 'B' });
    expect(step(viewer, server('A'))).toMatchObject({ selected: 'A' });
    expect(step(viewer, server('', 'p2'))).toMatchObject({ selected: '', policyId: 'p2' });
  });

  it('저장하는 동안 다른 양식은 고르지 않고, 저장이 실패하면 서버 값으로 되돌린다', () => {
    const saving = step(TEMPLATE_SELECTION_INITIAL, server('A'), pick('B'));
    const again = step(saving, pick('C'));
    expect(again).toMatchObject({ selected: 'B' });
    expect(savingOf(again)).toBe(true);
    const fail = step(saving, failed());
    expect(fail).toMatchObject({ selected: 'A' });
    expect(savingOf(fail)).toBe(false);
    // 저장 중에 다른 값이 와도(다른 사람이 바꿈) 저장이 끝날 때까지는 막혀 있다 — 풀린 듯 보이는데 고른 것이 버려지지 않게
    const otherValue = step(saving, server('C'));
    expect(otherValue).toMatchObject({ selected: 'C' });
    expect(step(otherValue, pick('D'))).toMatchObject({ selected: 'C' });
    expect(savingOf(step(otherValue, saved()))).toBe(false);
  });

  it('저장 중 표시는 저장하는 규정에 묶인다 — 다른 규정으로 옮기면 그 규정의 메뉴는 막히지 않고, 앞 규정의 저장이 끝나도 지금 고른 값은 그대로 (8차 검토)', () => {
    const p1Saving = step(TEMPLATE_SELECTION_INITIAL, server('A', 'p1'), pick('B', true, 'p1'));
    // p2 로 옮김 — p2 는 저장 중이 아니고 고를 수 있다
    const onP2 = step(p1Saving, server('X', 'p2'));
    expect(savingOf(onP2, 'p2')).toBe(false);
    const p2Saving = step(onP2, pick('Y', true, 'p2'));
    expect(p2Saving).toMatchObject({ selected: 'Y' });
    expect(savingOf(p2Saving, 'p2')).toBe(true);
    // p1 의 저장이 실패해도 p2 의 고른 값·저장 중 표시는 그대로
    const p1Failed = step(p2Saving, failed('p1'));
    expect(p1Failed).toMatchObject({ selected: 'Y' });
    expect(savingOf(p1Failed, 'p2')).toBe(true);
    expect(savingOf(p1Failed, 'p1')).toBe(false);
    // p1 의 저장이 끝나기 전에 p1 로 돌아오면 p1 은 여전히 저장 중이라 다른 양식을 고르지 않는다
    const backToP1 = step(p2Saving, server('A', 'p1'));
    expect(savingOf(backToP1, 'p1')).toBe(true);
    expect(step(backToP1, pick('C', true, 'p1'))).toMatchObject({ selected: 'A' });
    // p2 의 저장 완료는 p1 의 저장 중 표시를 끄지 않는다
    expect(savingOf(step(backToP1, saved('p2')), 'p1')).toBe(true);
  });

  it('훅: 저장은 규정마다 한 번에 하나, 메뉴의 저장 중 표시는 지금 규정 것만', () => {
    const hook = readFileSync(join(__dirname, '..', 'apps/web/src/components/policy-detail/useTemplateSelection.ts'), 'utf8');
    // 진행은 규정 상세의 다른 작업과 같은 화면 밖 저장소(useRuns, 'template') — 새로 그린 화면도 저장 중을 안다(12차)
    expect(hook).toContain("if (!start('template', pid, templateId)) return;");
    expect(hook).toContain("end('template', pid);");
    expect(hook).toContain("const saving = isSavingTemplate(state, policyId ?? '') || isRunning(running, 'template', policyId);");
    for (const a of ["dispatch({ type: 'pick', policyId: pid, id: templateId, save: true });", "dispatch({ type: 'saved', policyId: pid });", "dispatch({ type: 'failed', policyId: pid });"]) {
      expect(hook, a).toContain(a);
    }
  });

  it('입힐 양식 — 고른 양식, 자동이거나 목록에 없으면 회사 기본 양식', () => {
    expect(pickActiveTemplate(list, 'b')?.id).toBe('b');
    expect(pickActiveTemplate(list, '')?.id).toBe('a');
    expect(pickActiveTemplate(list, 'gone')?.id).toBe('a');
    expect(pickActiveTemplate([], 'b')).toBeNull();
  });

  it('페이지는 이 훅으로 고르고 저장한다 — 옛 동기화(고른 값이 비면 서버 값을 다시 고르기)가 남지 않는다', () => {
    const page = readFileSync(join(__dirname, '..', 'apps/web/src/pages/PolicyDetailPage.tsx'), 'utf8');
    expect(page).toContain('const templateSel = useTemplateSelection({');
    expect(page).toContain("serverValue: policy ? (policy.templateId ?? '') : null,");
    expect(page).toContain('onSelect: (tid) => void templateSel.change(tid),');
    expect(page).not.toMatch(/setSelectedTemplateId|if \(!policy \|\| selectedTemplateId\) return;/);
  });
});
